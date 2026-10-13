import { prefixSchema, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const GET = route<{ prefix: string }>(async (_req, { prefix }) =>
  engineCall("experiment_results", { prefix: prefixSchema.parse(prefix) }, { timeoutMs: 180_000 }),
);
