import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { ACTION_LABELS } from "@/lib/catalog";
import { getDb } from "@/lib/db";
import { notify } from "@/lib/notify";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

const Execute = z.object({
  action: z.enum(["defer", "partial", "full"]),
  approved: z.literal(true, { message: "Confirm the approval to continue" }),
  requestId: z.number().int().positive().optional(),
});

/**
 * Approve and carry out one action. The engine re-checks guardrails, verifies
 * the candidate checksum, re-runs chronological validation and only then
 * promotes. A decision can be approved once (UNIQUE in SQLite).
 */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const decisionId = ident.parse(id);
    const b = await body(req, Execute);
    let requester: string | null = null;
    if (b.requestId) {
      const db = await getDb(ctx.workspace.id);
      const row = db.prepare("SELECT prepared_by FROM execution_requests WHERE id=? AND decision_id=?").get(b.requestId, decisionId) as
        | { prepared_by: string }
        | undefined;
      if (!row) throw new AuthError(404, "Request not found for this decision");
      requester = row.prepared_by;
    }
    if (ctx.workspace.requireSeparateApprover && b.action !== "defer") {
      if (!requester) throw new AuthError(403, "This workspace requires an update to be requested by someone else before it is approved.");
      if (requester === ctx.user.email) throw new AuthError(403, "This workspace requires a different person to approve your own request.");
    }
    const result = await ctx.engine.call<{ status: string; outcome: string }>(
      "execute",
      { decision_id: decisionId, action: b.action, approver: ctx.user.email, approved: true, request_id: b.requestId ?? null },
      { timeoutMs: 600_000, dedupeKey: `execute:${decisionId}` },
    );
    await notify({
      workspaceId: ctx.workspace.id,
      kind: "outcome",
      title: `${ACTION_LABELS[b.action]}: ${result.status}`,
      body: result.outcome,
      href: "/lifecycle",
      dedupeKey: `outcome:${decisionId}`,
    });
    reportFor(ctx, {
      kind: "decision_executed",
      title: `${ACTION_LABELS[b.action]}: ${result.status}`,
      summary: result.outcome,
      status: { label: result.status, tone: result.status === "promoted" || result.status === "deferred" ? "ok" : result.status === "rejected" || result.status === "failed" ? "bad" : "neutral" },
      facts: [["Decision", decisionId], ["Action", ACTION_LABELS[b.action]], ["Approved by", ctx.user.email]],
      href: "/lifecycle",
      ctaLabel: "Open Model lifecycle",
    });
    return result;
  },
  { permission: "action.approve" },
);
