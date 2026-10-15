import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api";
import { AuthError, clientIp } from "@/lib/authz";
import { renderEmail } from "@/lib/email-template";
import { sendMail } from "@/lib/mail";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Contact = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  company: z.string().trim().max(100).optional().default(""),
  topic: z.enum(["Question", "Bug report", "Feature request", "Security", "Other"]),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(4000),
  website: z.string().max(0).optional(), // honeypot: real people leave it empty
});

/**
 * Contact form: emails the team address (CONTACT_EMAIL) and sends the sender a
 * confirmation. Rate limited per IP and per sender.
 */
export async function POST(req: NextRequest) {
  try {
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new AuthError(415, "JSON required");
    const ip = (await clientIp()) ?? "local";
    const b = Contact.parse(await req.json());
    if (!rateLimit(`contact-ip:${ip}`, 5, 60 * 60_000).ok || !rateLimit(`contact:${b.email}`, 3, 60 * 60_000).ok) {
      throw new AuthError(429, "Too many messages. Please try again later.");
    }
    const to = process.env.CONTACT_EMAIL?.trim();
    if (!to) throw new AuthError(503, "The contact address is not configured on this installation (CONTACT_EMAIL).");

    const team = renderEmail({
      preheader: `${b.topic} from ${b.name}`,
      eyebrow: "Contact form",
      status: { label: b.topic, tone: b.topic === "Bug report" || b.topic === "Security" ? "warn" : "neutral" },
      title: `New message from ${b.name}`,
      paragraphs: b.message.split(/\n{2,}/),
      facts: [["Name", b.name], ["Email", b.email], ["Company", b.company || "—"], ["Topic", b.topic]],
      footnote: "Reply directly to this person's email address.",
    });
    await sendMail({ to, subject: `RetrainWise contact · ${b.topic} · ${b.name}`, text: team.text, html: team.html });

    const confirm = renderEmail({
      preheader: "We received your message.",
      eyebrow: "Contact",
      title: "We received your message",
      paragraphs: [`Thanks, ${b.name.split(" ")[0]}. Your message reached the RetrainWise team and we will reply to ${b.email}.`, "For reference, here is what you sent:"],
      facts: [["Topic", b.topic], ["Message", b.message.length > 600 ? `${b.message.slice(0, 600)}…` : b.message]],
      footnote: "You received this because someone used this address on the RetrainWise contact form. If it was not you, ignore this email.",
    });
    await sendMail({ to: b.email, subject: "We received your message · RetrainWise", text: confirm.text, html: confirm.html }).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
