import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => ctx.engine.call("datasets", {}, { timeoutMs: 120_000 }));
