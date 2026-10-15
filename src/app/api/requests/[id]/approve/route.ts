import { z } from "zod";

import { body, route } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { notify } from "@/lib/notify";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Approve an operator's or the agent's request: executes it with full validation. */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const requestId = z.coerce.number().int().positive().parse(id);
    await body(req, z.object({ approved: z.literal(true, { message: "Confirm the approval to continue" }) }));
    const db = await getDb(ctx.workspace.id);
    const r = db.prepare("SELECT decision_id, action, prepared_by, status FROM execution_requests WHERE id=?").get(requestId) as
      | { decision_id: string; action: string; prepared_by: string; status: string }
      | undefined;
    if (!r) throw new AuthError(404, "Unknown request");
    if (r.status !== "awaiting_approval") throw new AuthError(409, `Request is ${r.status}`);
    if (ctx.workspace.requireSeparateApprover && r.prepared_by === ctx.user.email) {
      throw new AuthError(403, "This workspace requires a different person to approve your own request.");
    }
    const result = await ctx.engine.call<{ status: string; outcome: string }>(
      "execute",
      { decision_id: r.decision_id, action: r.action, approver: ctx.user.email, approved: true, request_id: requestId },
      { timeoutMs: 600_000, dedupeKey: `execute:${r.decision_id}` },
    );
    await notify({
      workspaceId: ctx.workspace.id,
      kind: "outcome",
      title: `Request #${requestId}: ${result.status}`,
      body: result.outcome,
      href: "/lifecycle",
      dedupeKey: `request-outcome:${requestId}`,
    });
    reportFor(ctx, {
      kind: "request_approved",
      title: `Request #${requestId} approved: ${result.status}`,
      summary: result.outcome,
      status: { label: result.status, tone: result.status === "promoted" || result.status === "deferred" ? "ok" : "bad" },
      facts: [["Request", `#${requestId}`], ["Decision", r.decision_id], ["Action", r.action], ["Requested by", r.prepared_by]],
      href: "/lifecycle",
    });
    return result;
  },
  { permission: "action.approve" },
);
