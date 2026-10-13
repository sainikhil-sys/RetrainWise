import { z } from "zod";

import { body, ident, route } from "@/lib/api";

export const dynamic = "force-dynamic";

const Batches = z.object({ expectedPosition: z.number().int().min(0), count: z.number().int().min(1).max(50).default(1) });

/** Process the next batch(es). Keyed by stream position: a duplicate click is a no-op. */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const runId = ident.parse(id);
    const { expectedPosition, count } = await body(req, Batches);
    return ctx.engine.call(
      "process_batches",
      { run_id: runId, expected_position: expectedPosition, count, actor: ctx.user.email },
      { timeoutMs: 900_000, dedupeKey: `batches:${runId}` },
    );
  },
  { permission: "stream.operate", limit: { max: 120, windowMs: 60_000 } },
);
