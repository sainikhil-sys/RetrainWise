import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => ctx.engine.call("experiment_sets", {}, { timeoutMs: 120_000 }));
