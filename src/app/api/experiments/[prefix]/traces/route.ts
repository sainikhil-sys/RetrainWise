import { z } from "zod";

import { prefixSchema, route } from "@/lib/api";

export const dynamic = "force-dynamic";

const Query = z.object({ dataset: z.string().max(40).optional(), regime: z.string().max(20).optional(), seed: z.coerce.number().int().min(0).optional() });

export const GET = route<{ prefix: string }>(async (req, { prefix }, ctx) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return ctx.engine.call("experiment_traces", { prefix: prefixSchema.parse(prefix), ...q }, { timeoutMs: 180_000 });
});
