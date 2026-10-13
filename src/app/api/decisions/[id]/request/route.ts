import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { ACTION_LABELS } from "@/lib/catalog";
import { notify } from "@/lib/notify";

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
    return r;
  },
  { permission: "action.request" },
);
