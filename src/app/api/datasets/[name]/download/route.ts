import { z } from "zod";

import { route } from "@/lib/api";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Explicit download from the original source; writes a cache file and a provenance record. */
export const POST = route<{ name: string }>(async (_req, { name }) => {
  const dataset = z.enum(["electricity", "airlines", "covertype"]).parse(name);
  return engine().isolatedCall("download_dataset", { name: dataset }, `download:${dataset}`, 900_000);
});
