import "server-only";

import { layout, sendMail } from "./mail";
import { can, type Permission } from "./permissions";
import { prisma } from "./prisma";

type Kind = "approval" | "decision" | "job" | "outcome" | "team";

const PREF: Record<Kind, "notifyApprovals" | "notifyDecisions" | "notifyJobs" | null> = {
  approval: "notifyApprovals",
  decision: "notifyDecisions",
  job: "notifyJobs",
  outcome: "notifyDecisions",
  team: null,
};

/**
 * Create in-app notifications for workspace members who hold `permission`
 * (or for explicit user ids), honouring each user's preferences. Approval
 * requests are also emailed to users who opted in.
 */
export async function notify(opts: {
  workspaceId: string;
  kind: Kind;
  title: string;
  body?: string;
  href?: string;
  permission?: Permission;
  userIds?: string[];
  excludeUserId?: string;
  dedupeKey?: string;
}) {
  try {
    const members = await prisma.membership.findMany({ where: { workspaceId: opts.workspaceId }, include: { user: true } });
    const pref = PREF[opts.kind];
    const targets = members.filter(
      (m) =>
        (opts.userIds ? opts.userIds.includes(m.userId) : opts.permission ? can(m.role as never, opts.permission) : true) &&
        m.userId !== opts.excludeUserId &&
        (!pref || m.user[pref]),
    );
    for (const m of targets) {
      await prisma.notification.upsert({
        where: { userId_dedupeKey: { userId: m.userId, dedupeKey: opts.dedupeKey ?? `${opts.kind}:${Date.now()}:${Math.random()}` } },
        create: {
          workspaceId: opts.workspaceId,
          userId: m.userId,
          kind: opts.kind,
          title: opts.title,
          body: opts.body ?? "",
          href: opts.href,
          dedupeKey: opts.dedupeKey ?? null,
        },
        update: {},
      });
      if (opts.kind === "approval" && m.user.emailApprovals) {
        const base = process.env.AUTH_URL || "http://localhost:3000";
        const { text, html } = layout(opts.title, [opts.body ?? ""], opts.href ? { label: "Review in RetrainWise", url: `${base}${opts.href}` } : undefined);
        await sendMail({ to: m.user.email, subject: `RetrainWise: ${opts.title}`, text, html }).catch((err) =>
          console.error("[retrainwise notify] email failed", err),
        );
      }
    }
  } catch (err) {
    console.error("[retrainwise notify] failed", err);
  }
}
