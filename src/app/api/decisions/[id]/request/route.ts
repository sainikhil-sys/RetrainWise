import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { ACTION_LABELS } from "@/lib/catalog";
import { notify } from "@/lib/notify";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

const RequestBody = z.object({
  action: z.enum(["defer", "partial", "full"]),
  rationale: z.string().trim().min(3, "Explain why in a few words").max(1000),
});

/** An operator requests an action; an approver reviews it. Nothing is executed here. */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const decisionId = ident.parse(id);
    const b = await body(req, RequestBody);
    const r = await ctx.engine.call<{ request_id: number }>(
      "create_request",
      { decision_id: decisionId, action: b.action, rationale: b.rationale, actor: ctx.user.email },
      { dedupeKey: `request:${decisionId}` },
    );
    await notify({
      workspaceId: ctx.workspace.id,
      kind: "approval",
      permission: "action.approve",
      excludeUserId: ctx.user.id,
      title: `Approval requested: ${ACTION_LABELS[b.action]}`,
      body: `${ctx.user.email} requested this for decision ${decisionId}: ${b.rationale}`,
      href: "/lifecycle",
      dedupeKey: `request:${r.request_id}`,
    });
    reportFor(ctx, {
      kind: "approval_requested",
      title: `Approval requested: ${ACTION_LABELS[b.action]}`,
      summary: "Approvers in this workspace were notified. Nothing changes in production until one of them accepts.",
      status: { label: "Awaiting approval", tone: "warn" },
      facts: [["Decision", decisionId], ["Request", `#${r.request_id}`], ["Action", ACTION_LABELS[b.action]], ["Rationale", b.rationale]],
      href: "/decisions",
    });
    return r;
  },
  { permission: "action.request" },
);
