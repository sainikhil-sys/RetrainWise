import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { REGIMES } from "@/lib/catalog";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

const WhatIf = z.object({
  errorValueMultiplier: z.number().min(0.05).max(20),
  horizonMultiplier: z.number().min(0.05).max(20),
  regime: z.enum(REGIMES),
});

/** Re-rank stored evidence under different assumptions. Informational: nothing is saved. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const decisionId = ident.parse(id);
  const b = await body(req, WhatIf);
  return engineCall(
    "what_if",
    { decision_id: decisionId, error_value_multiplier: b.errorValueMultiplier, horizon_multiplier: b.horizonMultiplier, regime: b.regime },
    { timeoutMs: 60_000 },
  );
});
