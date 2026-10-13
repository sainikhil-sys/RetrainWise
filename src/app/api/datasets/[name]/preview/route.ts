import { z } from "zod";

import { route, sizeEnum } from "@/lib/api";
import { DATASETS } from "@/lib/catalog";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

const Query = z.object({
  size: sizeEnum.default("standard"),
  seed: z.coerce.number().int().min(0).max(2_147_483_647).default(42),
});

/** Schema, first rows and class balance read from the real cached file (or the generated stream). */
export const GET = route<{ name: string }>(async (req, { name }) => {
  const dataset = z.enum(DATASETS).parse(name);
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  return engineCall("dataset_preview", { name: dataset, size: q.size, seed: q.seed }, { timeoutMs: 180_000 });
});
