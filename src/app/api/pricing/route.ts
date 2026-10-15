import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** The assumed pricing snapshot used by the simulated cost model. */
export const GET = route(async (_req, _p, ctx) => ctx.engine.call("pricing", {}, { timeoutMs: 60_000 }));
