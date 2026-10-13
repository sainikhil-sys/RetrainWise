import { z } from "zod";

import { route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Reference window of a registered model: training interval and fixed PSI bins. */
export const GET = route<{ version: string }>(async (_req, { version }) => {
  const v = z.coerce.number().int().positive().parse(version);
  return engineCall("reference_window", { version: v }, { timeoutMs: 60_000 });
});
