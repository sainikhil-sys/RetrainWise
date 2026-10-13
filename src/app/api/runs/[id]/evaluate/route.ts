import { ident, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Shadow-evaluate full and incremental candidates and rank all actions (charged once per state). */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const runId = ident.parse(id);
  return engineCall("evaluate", { run_id: runId }, { timeoutMs: 600_000, dedupeKey: `evaluate:${runId}` });
});
