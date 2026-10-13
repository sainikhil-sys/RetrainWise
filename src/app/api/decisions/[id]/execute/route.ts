import { z } from "zod";

import { actorName, body, ident, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

const Execute = z.object({
  action: z.enum(["defer", "partial", "full"]),
  approver: actorName,
  approved: z.literal(true, { message: "Tick the approval box to confirm" }),
  requestId: z.number().int().positive().optional(),
});

/**
 * Approve and carry out one action. The engine re-checks guardrails, verifies the
 * candidate artifact checksum, re-runs the chronological validation gate and only
 * then promotes. A decision can be approved at most once (UNIQUE in SQLite).
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const decisionId = ident.parse(id);
  const b = await body(req, Execute);
  return engineCall(
    "execute",
    { decision_id: decisionId, action: b.action, approver: b.approver, approved: true, request_id: b.requestId ?? null },
    { timeoutMs: 600_000, dedupeKey: `execute:${decisionId}` },
  );
});
