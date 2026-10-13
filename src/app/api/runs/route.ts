import { z } from "zod";

import { actorName, body, route, sizeEnum } from "@/lib/api";
import { DATASETS } from "@/lib/catalog";
import { engineCall } from "@/lib/engine";
import { listRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ runs: await listRuns(50) }));

const StartRun = z.object({
  dataset: z.enum(DATASETS),
  size: sizeEnum,
  seed: z.number().int().min(0).max(2_147_483_647),
  actor: actorName.optional(),
});

/** Start a new stream replay: loads data in source order and trains the initial model. */
export const POST = route(async (req) => {
  const args = await body(req, StartRun);
  return engineCall("start_run", args, { timeoutMs: 600_000, dedupeKey: "start_run" });
});
