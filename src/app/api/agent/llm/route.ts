import { route } from "@/lib/api";
import { keyForEndpoint } from "@/lib/provider-keys";
import { getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Open-source model providers: Ollama status, the saved OpenAI-compatible
 * endpoint (checked with the workspace's saved key if there is one), catalog
 * and presets. Never returns a key.
 */
export const GET = route(async (_req, _p, ctx) => {
  const settings = await getSettings(ctx.workspace.id);
  const saved = await keyForEndpoint(ctx.workspace.id, settings.llm_base_url);
  const r = await ctx.engine.call<Record<string, unknown> & { openai: Record<string, unknown> }>(
    "llm_status",
    saved ? { api_key: saved.key } : {},
    { timeoutMs: 45_000 },
  );
  return { ...r, openai: { ...r.openai, key_source: saved ? "workspace" : r.openai.key_configured ? "environment" : null } };
});
