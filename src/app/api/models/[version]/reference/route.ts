import { z } from "zod";

import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Reference window of a registered model: training interval and fixed PSI bins. */
export const GET = route<{ version: string }>(async (_req, { version }, ctx) => {
  const v = z.coerce.number().int().positive().parse(version);
  return ctx.engine.call("reference_window", { version: v }, { timeoutMs: 60_000 });
});
