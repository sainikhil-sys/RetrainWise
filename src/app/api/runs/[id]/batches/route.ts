import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

const Batches = z.object({
  expectedPosition: z.number().int().min(0),
  count: z.number().int().min(1).max(50).default(1),
});

/**
 * Process the next batch(es): predict first, reveal due labels, update monitors.
 * `expectedPosition` makes the request idempotent: a duplicate click is a no-op.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const runId = ident.parse(id);
  const { expectedPosition, count } = await body(req, Batches);
  return engineCall(
    "process_batches",
    { run_id: runId, expected_position: expectedPosition, count },
    { timeoutMs: 900_000, dedupeKey: `batches:${runId}` },
  );
});
