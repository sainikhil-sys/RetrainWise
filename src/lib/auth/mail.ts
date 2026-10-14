/**
 * SMTP delivery for verification and reset codes.
 *
 * Settings come from environment variables (Next.js loads `.env` / `.env.local`
 * automatically; the CLI in scripts/mail.ts loads `.env` itself). Every send
 * failure is raised as `MailError` with a plain-language reason (wrong
 * port/security mode, rejected login, refused recipient, ...) instead of being
 * swallowed, so "the email never arrived" always has a visible cause.
 */
import nodemailer from "nodemailer";
import { log } from "../db";

export class MailError extends Error {}
export class MailNotConfigured extends MailError {}

export type Security = "starttls" | "ssl" | "none";

export interface MailSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  sender: string;
  security: Security;
  timeoutSeconds: number;
  devCodes: boolean;
}

export function mailSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): MailSettings {
  const host = (env.SMTP_HOST || "").trim();
  let port = Number.parseInt(env.SMTP_PORT || "", 10);
  if (!Number.isFinite(port)) port = 0;
  let security = (env.SMTP_SECURITY || "").trim().toLowerCase() as Security;
  if (!["starttls", "ssl", "none"].includes(security)) security = port === 465 ? "ssl" : "starttls";
  port = port || (security === "ssl" ? 465 : 587);
  const user = (env.SMTP_USER || "").trim();
  let password = env.SMTP_PASSWORD || "";
  if (/gmail|googlemail/.test(host)) password = password.replace(/\s+/g, ""); // App Passwords are shown in 4 groups
  const timeout = Number.parseFloat(env.SMTP_TIMEOUT || "20");
  return {
    host, port, user, password, sender: (env.SMTP_FROM || "").trim() || user, security,
    timeoutSeconds: Number.isFinite(timeout) && timeout > 0 ? timeout : 20,
    devCodes: ["1", "true", "yes"].includes((env.AUTH_DEV_CODES || "").trim().toLowerCase()),
  };
}

export function isConfigured(cfg: MailSettings): boolean {
  return Boolean(cfg.host && cfg.sender);
}

export function senderAddress(sender: string): string {
  const m = sender.match(/<([^>]+)>/);
  return (m ? m[1] : sender).trim();
}

/** Configuration mistakes that are known to make mail silently fail. */
export function mailProblems(cfg: MailSettings): string[] {
  const out: string[] = [];
  const addr = senderAddress(cfg.sender).toLowerCase();
  if (!cfg.host) out.push("SMTP_HOST is not set.");
  if (!cfg.sender) out.push("SMTP_FROM (or SMTP_USER) is not set, so there is no sender address.");
  else if (!addr.includes("@")) out.push(`SMTP_FROM ${JSON.stringify(cfg.sender)} is not an email address.`);
  if (cfg.host && !cfg.user && cfg.security !== "none") out.push("SMTP_USER is empty; almost every provider requires a login.");
  if (cfg.user && !cfg.password) out.push("SMTP_PASSWORD is empty.");
  if (cfg.port === 465 && cfg.security === "starttls") out.push("Port 465 needs SMTP_SECURITY=ssl (STARTTLS uses port 587).");
  if (cfg.port === 587 && cfg.security === "ssl") out.push("Port 587 needs SMTP_SECURITY=starttls (implicit SSL uses port 465).");
  if (cfg.host.includes("gmail") && cfg.password && cfg.password.length !== 16) {
    out.push("Gmail needs a 16-character App Password (Google Account > Security > 2-Step Verification > App " +
      "passwords), not your normal password.");
  }
  if (/gmail|office365|outlook/.test(cfg.host) && cfg.user && addr && addr !== cfg.user.toLowerCase()) {
    out.push("SMTP_FROM differs from SMTP_USER; Gmail/Outlook rewrite or reject mail sent from an address you have " +
      "not verified with them.");
  }
  return out;
}

export function describeMail(cfg: MailSettings): string {
  if (!isConfigured(cfg)) return "not configured";
  return `${cfg.host}:${cfg.port} (${cfg.security}) as ${cfg.user || "anonymous"}, from ${cfg.sender}`;
}

interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
  response?: string;
  rejected?: string[];
  command?: string;
}

/** Turn a nodemailer / socket error into an actionable sentence. */
export function explainMailError(exc: unknown, cfg: MailSettings): string {
  const e = exc as SmtpError;
  const msg = String(e?.message || exc);
  const code = e?.code || "";
  if (code === "EAUTH") {
    const hint = cfg.host.includes("gmail") ? " Gmail requires 2-Step Verification and an App Password."
      : /office365|outlook/.test(cfg.host) ? " Outlook/Office 365 needs SMTP AUTH enabled for the mailbox." : "";
    return `The SMTP server rejected the username/password (${e.responseCode ?? "auth failed"}).${hint}`;
  }
  if (code === "EENVELOPE") {
    if (e.command === "MAIL FROM" || /sender/i.test(msg)) {
      return `The server refused the sender address ${JSON.stringify(cfg.sender)}: ${e.response || msg}.`;
    }
    return `The server refused the recipient (${(e.rejected || []).join(", ") || e.response || msg}).`;
  }
  if (/wrong version number|ssl3_get_record|tls|certificate|handshake/i.test(msg) && code !== "ETIMEDOUT") {
    return `TLS handshake failed on port ${cfg.port} (${msg}). Use SMTP_SECURITY=ssl with port 465 or ` +
      "SMTP_SECURITY=starttls with port 587.";
  }
  if (code === "ETIMEDOUT" || /timeout|timed out/i.test(msg)) {
    return `Timed out connecting to ${cfg.host}:${cfg.port}. The port may be blocked by a firewall or need a ` +
      "different security mode.";
  }
  if (code === "EDNS" || /ENOTFOUND|EAI_AGAIN/.test(msg)) return `Cannot resolve SMTP host ${JSON.stringify(cfg.host)}; check SMTP_HOST.`;
  if (/ECONNREFUSED/.test(msg)) return `Connection refused by ${cfg.host}:${cfg.port}; check SMTP_PORT.`;
  if (/ECONNRESET|closed|Greeting never received/i.test(msg)) {
    return `The server closed the connection (${msg}). This usually means a port/security mismatch (465 = ssl, 587 = starttls).`;
  }
  if (e?.responseCode) return `SMTP error ${e.responseCode}: ${e.response || msg}`;
  return `${e?.name || "Error"}: ${msg}`;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type Sender = (mail: OutgoingMail, cfg: MailSettings) => Promise<void>;

/** Hand one message to the SMTP server or throw `MailError` explaining why not. */
export const sendEmail: Sender = async (mail, cfg) => {
  if (!isConfigured(cfg)) {
    throw new MailNotConfigured(`Email is not configured: ${mailProblems(cfg).join(" ")} Copy .env.example to .env ` +
      "and fill in your SMTP settings.");
  }
  const timeout = cfg.timeoutSeconds * 1000;
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.security === "ssl", requireTLS: cfg.security === "starttls",
    ignoreTLS: cfg.security === "none", auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: timeout, greetingTimeout: timeout, socketTimeout: timeout,
  });
  const addr = senderAddress(cfg.sender);
  const name = cfg.sender.includes("<") ? cfg.sender.slice(0, cfg.sender.indexOf("<")).trim().replace(/^"|"$/g, "") : "";
  try {
    const info = await transport.sendMail({ from: { name: name || "RetrainWise", address: addr }, to: mail.to,
      subject: mail.subject, text: mail.text, html: mail.html });
    if (info.rejected?.length) {
      throw Object.assign(new Error("recipient rejected"), { code: "EENVELOPE", rejected: info.rejected.map(String) });
    }
  } catch (exc) {
    const reason = explainMailError(exc, cfg);
    log("mail_failed", { to: mail.to, subject: mail.subject, reason });
    throw new MailError(reason);
  } finally {
    transport.close();
  }
  log("mail_sent", { to: mail.to, subject: mail.subject });
};
