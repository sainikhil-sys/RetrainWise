import { z } from "zod";

import { body, route, sizeEnum } from "@/lib/api";
import { DATASETS, POLICIES, REGIMES } from "@/lib/catalog";
import { engineCall } from "@/lib/engine";
import { getJobs } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ jobs: await getJobs(12) }));

const Submit = z
  .object({
    datasets: z.array(z.enum(DATASETS)).min(1, "choose at least one dataset"),
    policies: z.array(z.enum(POLICIES)).min(1, "choose at least one policy"),
    regimes: z.array(z.enum(REGIMES)).min(1, "choose at least one cost regime"),
    seeds: z.array(z.number().int().min(0).max(2 ** 31)).min(1, "enter at least one seed").max(10, "at most 10 seeds"),
    size: sizeEnum,
  })
  .refine((v) => new Set(v.seeds).size === v.seeds.length, { message: "seeds must be distinct", path: ["seeds"] })
  .refine((v) => v.datasets.length * v.policies.length * v.regimes.length * v.seeds.length <= 400, {
    message: "at most 400 runs per job",
    path: ["seeds"],
  });

/** Queue a benchmark job. It runs in a separate worker process with progress in SQLite. */
export const POST = route(async (req) => {
  const b = await body(req, Submit);
  return engineCall("submit_job", b, { timeoutMs: 120_000, dedupeKey: "submit_job" });
});
