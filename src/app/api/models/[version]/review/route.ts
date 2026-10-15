import { z } from "zod";

import { body, reasonText, route } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { notify } from "@/lib/notify";
import { can } from "@/lib/permissions";
import { reportFor, ver } from "@/lib/report";

export const dynamic = "force-dynamic";

const Review = z.object({ action: z.enum(["request", "reject"]), reason: reasonText });

/** Request promotion of a candidate (operator) or reject it (approver). */
export const POST = route<{ version: string }>(
  async (req, { version }, ctx) => {
    const v = z.coerce.number().int().positive().parse(version);
    const b = await body(req, Review);
    if (b.action === "reject" && !can(ctx.role, "model.promote")) throw new AuthError(403, "Only approvers and admins can reject candidates.");
    if (b.action === "request" && !can(ctx.role, "action.request")) throw new AuthError(403, "Your role cannot request promotions.");
    const r = await ctx.engine.call("review_candidate", { version: v, action: b.action, actor: ctx.user.email, role: ctx.role, reason: b.reason }, { dedupeKey: `review:${v}` });
    if (b.action === "request") {
      await notify({
        workspaceId: ctx.workspace.id,
        kind: "approval",
        permission: "model.promote",
        excludeUserId: ctx.user.id,
        title: `Promotion requested for model v${String(v).padStart(3, "0")}`,
        body: `${ctx.user.email} asked for this validated candidate to be promoted.${b.reason ? ` ${b.reason}` : ""}`,
        href: `/models/${v}`,
        dedupeKey: `promotion-request:${v}`,
      });
    }
    reportFor(ctx, {
      kind: b.action === "request" ? "promotion_requested" : "candidate_rejected",
      title: b.action === "request" ? `Promotion requested for ${ver(v)}` : `Candidate ${ver(v)} rejected`,
      summary: b.action === "request" ? "Approvers were notified. Production changes only after one of them promotes it." : "The candidate can no longer be promoted. Its metrics and logs stay in the history.",
      status: b.action === "request" ? { label: "Awaiting approval", tone: "warn" } : { label: "Rejected", tone: "bad" },
      facts: [["Version", ver(v)], ["Note", b.reason || "—"]],
      href: `/models/${v}`,
    });
    return r;
  },
  { permission: "action.request" },
);
