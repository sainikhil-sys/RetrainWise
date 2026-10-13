import { z } from "zod";

import { body, route, sizeEnum } from "@/lib/api";
import { DATASETS, REGIMES } from "@/lib/catalog";
import { listRuns } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => ({ runs: await listRuns(ctx.workspace.id, 50) }));

const StartRun = z.object({
  dataset: z.enum(DATASETS),
  size: sizeEnum,
  seed: z.number().int().min(0).max(2_147_483_647),
  regime: z.enum(REGIMES).optional(),
});

/** Start a monitored run: loads data in source order and trains the initial model. */
export const POST = route(
  async (req, _p, ctx) => {
    const args = await body(req, StartRun);
    return ctx.engine.call("start_run", { ...args, actor: ctx.user.email }, { timeoutMs: 600_000, dedupeKey: "start_run" });
  },
  { permission: "stream.operate" },
);
