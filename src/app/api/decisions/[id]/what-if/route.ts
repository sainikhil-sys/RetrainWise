import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { REGIMES } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const WhatIf = z.object({
  errorValueMultiplier: z.number().min(0.05).max(20),
  horizonMultiplier: z.number().min(0.05).max(20),
  regime: z.enum(REGIMES),
});

/** Re-rank stored evidence under other assumptions. Read-only. */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const decisionId = ident.parse(id);
    const b = await body(req, WhatIf);
    return ctx.engine.call(
      "what_if",
      { decision_id: decisionId, error_value_multiplier: b.errorValueMultiplier, horizon_multiplier: b.horizonMultiplier, regime: b.regime },
      { timeoutMs: 60_000 },
    );
  },
  { limit: { max: 240, windowMs: 60_000 } },
);
