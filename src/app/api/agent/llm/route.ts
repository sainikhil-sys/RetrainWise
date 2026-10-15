import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Open-source model providers: Ollama status, OpenAI-compatible endpoint status, catalog and presets. Never returns the API key. */
export const GET = route(async (_req, _p, ctx) => ctx.engine.call("llm_status", {}, { timeoutMs: 45_000 }));
