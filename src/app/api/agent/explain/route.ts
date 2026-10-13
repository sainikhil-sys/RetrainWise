import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { engine, engineCall } from "@/lib/engine";
import { getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Explain = z.object({
  decisionId: ident,
  mode: z.enum(["deterministic", "ollama"]),
  model: z.string().regex(/^[A-Za-z0-9._:/-]{1,80}$/).optional(),
});

/**
 * Generate and store an explanation. The agent reads telemetry, registry, pricing
 * and evaluations through bounded read-only tools; every tool call is recorded.
 * Ollama runs in a separate process so a slow local model cannot block the engine.
 */
export const POST = route(async (req) => {
  const b = await body(req, Explain);
  const args = { decision_id: b.decisionId, mode: b.mode, model: b.model };
  if (b.mode === "ollama") {
    const settings = await getSettings();
    return engine().isolatedCall("explain", args, `explain:${b.decisionId}`, (settings.agent_timeout_seconds + 90) * 1000);
  }
  return engineCall("explain", args, { timeoutMs: 120_000, dedupeKey: `explain:${b.decisionId}` });
});
