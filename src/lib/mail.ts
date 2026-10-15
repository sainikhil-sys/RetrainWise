import "server-only";

import { renderEmail, type EmailContent } from "./email-template";
import { prisma } from "./prisma";

export type Mail = { to: string; subject: string; text: string; html: string; url?: string; code?: string };

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST || process.env.AUTH_RESEND_KEY);
}

/** Sender address, normalised. Placeholders and malformed values fall back to Resend's test sender. */
export function mailFrom() {
  let from = process.env.EMAIL_FROM?.trim().replace(/^["']|["']$/g, "");
  if (from && from.includes("<") && !from.includes(">")) from += ">"; // common typo: missing closing bracket
  const valid = !!from && /^([^<>]*<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/.test(from);
  if (!valid || /your-domain\.com|example\.com/i.test(from!)) return RESEND_TEST_SENDER;
  return from!;
}

const RESEND_TEST_SENDER = "RetrainWise <onboarding@resend.dev>";

async function toOutbox(mail: Mail, reason?: string) {
  await prisma.devEmail.create({ data: { to: mail.to, subject: mail.subject, text: mail.text, url: mail.url } });
  if (mail.code) console.log(`
[retrainwise mail] sign-in code for ${mail.to}: ${mail.code}`);
  console.log(
    `
[retrainwise mail] ${reason ? `NOT SENT (${reason}); ` : ""}to ${mail.to}: ${mail.subject}${mail.url ? `
  ${mail.url}` : ""}
  (development outbox: http://localhost:3000/dev/mailbox)
`,
  );
  return { delivered: "dev-outbox" as const };
}

/** SMTP (for example Gmail with an app password): delivers to any address without a verified domain. */
async function sendSmtp(mail: Mail) {
  const nodemailer = await import("nodemailer");
  const port = Number(process.env.SMTP_PORT) || 587;
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  });
  const configured = process.env.EMAIL_FROM?.trim();
  // Gmail and most providers only allow sending as the authenticated account.
  const from = configured && !/resend\.dev|your-domain\.com/i.test(configured) ? mailFrom() : `RetrainWise <${process.env.SMTP_USER}>`;
  await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html });
}

async function sendResend(mail: Mail, from: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html }),
  });
  if (res.ok) return null;
  return `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
}

/**
 * Deliver an email: SMTP when SMTP_HOST is set, otherwise Resend. If Resend
 * rejects an unverified sender domain, it is retried once from Resend's test
 * sender (which reaches the Resend account owner's address). In development any
 * failure falls back to the local outbox (/dev/mailbox) so you are never locked
 * out; production reports the failure instead of pretending an email was sent.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: "smtp" | "resend" | "dev-outbox" }> {
  const production = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  if (process.env.SMTP_HOST) {
    try {
      await sendSmtp(mail);
      return { delivered: "smtp" };
    } catch (err) {
      errors.push(`SMTP: ${(err as Error).message.slice(0, 300)}`);
    }
  }
  if (process.env.AUTH_RESEND_KEY) {
    const from = mailFrom();
    let error = await sendResend(mail, from);
    if (error && /not verified/i.test(error) && from !== RESEND_TEST_SENDER) {
      const retry = await sendResend(mail, RESEND_TEST_SENDER);
      if (!retry) {
        console.warn(`[retrainwise mail] ${error}. Sent from ${RESEND_TEST_SENDER} instead; verify your domain at https://resend.com/domains.`);
        return { delivered: "resend" };
      }
      error = `${error}; retry from ${RESEND_TEST_SENDER}: ${retry}`;
    }
    if (!error) return { delivered: "resend" };
    errors.push(error);
  }
  if (production) throw new Error(errors.join(" | ") || "Email is not configured. Set SMTP_HOST or AUTH_RESEND_KEY.");
  return toOutbox(mail, errors.join(" | ") || undefined);
}

/** Short transactional email (invitations, approval requests) in the shared design. */
export function layout(title: string, paragraphs: string[], action?: { label: string; url: string }, extra?: Partial<EmailContent>) {
  return renderEmail({ preheader: paragraphs[0] ?? title, title, paragraphs, cta: action, ...extra });
}

/** Sign-in code email: the code is large and easy to read, and never a link. */
export function codeEmail(code: string, minutes: number) {
  return renderEmail({
    preheader: `${code} is your sign-in code. It expires in ${minutes} minutes.`,
    eyebrow: "Sign-in verification",
    title: "Your sign-in code",
    paragraphs: ["Enter this code on the RetrainWise sign-in page to verify your email and continue."],
    code,
    facts: [
      ["Expires", `in ${minutes} minutes`],
      ["Use", "once, on the device where you requested it"],
    ],
    footnote: "If you did not try to sign in, ignore this email: nobody can sign in without the code. RetrainWise will never ask you for this code by phone or chat.",
  });
}
