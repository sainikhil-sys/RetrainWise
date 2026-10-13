import { prefixSchema, route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route<{ prefix: string }>(async (_req, { prefix }, ctx) =>
  ctx.engine.call("experiment_results", { prefix: prefixSchema.parse(prefix) }, { timeoutMs: 180_000 }),
);
