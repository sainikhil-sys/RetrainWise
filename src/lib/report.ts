import "server-only";

import { renderEmail, type EmailFact, type EmailTone } from "./email-template";
import { sendMail } from "./mail";
import { prisma } from "./prisma";

export type WorkReport = {
  /** Machine kind, e.g. "run_started", "training_completed". */
  kind: string;
  /** Subject and heading, e.g. "Monitored stream started". */
  title: string;
  summary: string;
  facts?: EmailFact[];
  status?: { label: string; tone: EmailTone };
  /** In-app path for the call to action, e.g. "/decisions". */
  href?: string;
  ctaLabel?: string;
  /** Send at most once per key (job completion is observed repeatedly). */
  dedupeKey?: string;
};

type Who = { userId?: string | null; email: string; workspaceId?: string | null; workspaceName?: string | null };

function appUrl() {
  return (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

async function deliver(who: Who, r: WorkReport) {
  const user = who.userId
    ? await prisma.user.findUnique({ where: { id: who.userId } })
    : await prisma.user.findUnique({ where: { email: who.email.toLowerCase() } });
  if (!user || !user.emailReports) return;
  const key = r.dedupeKey ?? `${r.kind}:${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  if (r.dedupeKey && (await prisma.emailReport.findUnique({ where: { dedupeKey: key } }))) return;
  // Reserve the key first so concurrent observers cannot both send.
  try {
    await prisma.emailReport.create({ data: { userId: user.id, workspaceId: who.workspaceId ?? null, kind: r.kind, dedupeKey: key, subject: r.title, delivered: "pending" } });
  } catch {
    return; // another request already claimed this report
  }
  const when = new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const { html, text } = renderEmail({
    preheader: r.summary,
    eyebrow: "Work report",
    status: r.status,
    title: r.title,
    context: who.workspaceName ?? undefined,
    paragraphs: [r.summary],
    facts: [...(r.facts ?? []), ["Performed by", user.email], ["Time", when]],
    cta: r.href ? { label: r.ctaLabel ?? "Open in RetrainWise", url: `${appUrl()}${r.href}` } : undefined,
    footnote: "You receive a short report after each action in RetrainWise. Turn these off under Profile → Notifications. Simulated costs are labelled as such in the app.",
  });
  try {
    const sent = await sendMail({ to: user.email, subject: `RetrainWise · ${r.title}`, text, html });
    await prisma.emailReport.update({ where: { dedupeKey: key }, data: { delivered: sent.delivered } });
  } catch (err) {
    await prisma.emailReport.update({ where: { dedupeKey: key }, data: { delivered: "failed" } }).catch(() => undefined);
    console.error("[retrainwise report] email failed", err);
  }
}

/**
 * Email a work report to the person who did something. Fire-and-forget: the
 * action's response never waits for, or fails because of, the email.
 */
export function reportWork(who: Who, r: WorkReport) {
  void deliver(who, r).catch((err) => console.error("[retrainwise report] failed", err));
}

/** Convenience for API routes that have a request context. */
export function reportFor(ctx: { user: { id: string; email: string }; workspace: { id: string; name: string } }, r: WorkReport) {
  reportWork({ userId: ctx.user.id, email: ctx.user.email, workspaceId: ctx.workspace.id, workspaceName: ctx.workspace.name }, r);
}

export const pct = (x: unknown, d = 2) => (typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "—");
export const usd = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? `$${x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—");
export const ver = (n: unknown) => (typeof n === "number" ? `v${String(n).padStart(3, "0")}` : "—");
