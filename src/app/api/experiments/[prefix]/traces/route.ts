import { z } from "zod";

import { prefixSchema, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

const Query = z.object({
  dataset: z.string().max(40).optional(),
  regime: z.string().max(20).optional(),
  seed: z.coerce.number().int().min(0).optional(),
});

/** Per-batch error traces of every policy for one (dataset, regime, seed) cell. */
export const GET = route<{ prefix: string }>(async (req, { prefix }) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return engineCall("experiment_traces", { prefix: prefixSchema.parse(prefix), ...q }, { timeoutMs: 180_000 });
});
