import "server-only";

import { prisma } from "./prisma";

export type Mail = { to: string; subject: string; text: string; html: string; url?: string };

export function mailConfigured() {
  return Boolean(process.env.AUTH_RESEND_KEY);
}

/**
 * Send an email through Resend. Without AUTH_RESEND_KEY, development builds
 * store the message in the local outbox (/dev/mailbox) so magic links still
 * work offline; production refuses to pretend an email was sent.
 */
export async function sendMail(mail: Mail): Promise<{ delivered: "resend" | "dev-outbox" }> {
  const key = process.env.AUTH_RESEND_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "RetrainWise <onboarding@resend.dev>",
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });
    if (!res.ok) throw new Error(`Email provider error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { delivered: "resend" };
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Email is not configured. Set AUTH_RESEND_KEY and EMAIL_FROM.");
  }
  await prisma.devEmail.create({ data: { to: mail.to, subject: mail.subject, text: mail.text, url: mail.url } });
  console.log(`\n[retrainwise mail] to ${mail.to}: ${mail.subject}${mail.url ? `\n  ${mail.url}` : ""}\n  (development outbox: http://localhost:3000/dev/mailbox)\n`);
  return { delivered: "dev-outbox" };
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plain, readable transactional email layout. */
export function layout(title: string, paragraphs: string[], action?: { label: string; url: string }) {
  const text = [title, "", ...paragraphs, ...(action ? ["", `${action.label}: ${action.url}`] : [])].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#fafaf9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#0a0a0a">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e7e7e5;border-radius:8px">
<tr><td style="padding:28px 32px 8px;font-family:Georgia,serif;font-size:22px">RetrainWise</td></tr>
<tr><td style="padding:8px 32px 0;font-size:17px;font-weight:600">${escape(title)}</td></tr>
${paragraphs.map((p) => `<tr><td style="padding:10px 32px 0;font-size:14px;line-height:1.6;color:#3f3f3f">${escape(p)}</td></tr>`).join("")}
${action ? `<tr><td style="padding:22px 32px 6px"><a href="${escape(action.url)}" style="display:inline-block;background:#0a0a0a;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-size:14px">${escape(action.label)}</a></td></tr>
<tr><td style="padding:6px 32px 0;font-size:12px;color:#8a8a87;word-break:break-all">${escape(action.url)}</td></tr>` : ""}
<tr><td style="padding:24px 32px 28px;font-size:12px;color:#8a8a87">If you did not expect this email, you can ignore it.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
