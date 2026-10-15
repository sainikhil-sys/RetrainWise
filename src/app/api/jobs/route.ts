import { z } from "zod";

import { body, route, sizeEnum } from "@/lib/api";
import { DATASETS, POLICIES, REGIMES } from "@/lib/catalog";
import { notify } from "@/lib/notify";
import { getJobs } from "@/lib/queries";
import { reportFor } from "@/lib/report";
import { reportFinishedJobs } from "@/lib/report-jobs";

export const dynamic = "force-dynamic";

/** Recent jobs. Finished jobs produce a one-time notification for the requester. */
export const GET = route(async (req, _p, ctx) => {
  const kind = req.nextUrl.searchParams.get("kind");
  const jobs = (await getJobs(ctx.workspace.id, 25)).filter((j) => !kind || j.kind === kind);
  for (const j of jobs.slice(0, 5)) {
    if (["completed", "failed", "cancelled"].includes(j.status) && j.finished && Date.now() - Date.parse(j.finished) < 3_600_000) {
      const training = j.kind === "training";
      await notify({
        workspaceId: ctx.workspace.id,
        kind: "job",
        title: `${training ? "Training" : "Benchmark"} job ${j.id} ${j.status}`,
        body: training && j.result?.version ? `Candidate v${String(j.result.version).padStart(3, "0")} is ready for validation and review.` : j.error?.split("\n")[0] ?? "",
        href: training ? "/models" : "/experiments",
        dedupeKey: `job:${j.id}:${j.status}`,
      });
    }
  }
  void reportFinishedJobs(ctx.workspace.id, jobs).catch(() => undefined);
  return { jobs };
});

const Submit = z
  .object({
    datasets: z.array(z.enum(DATASETS)).min(1, "choose at least one dataset"),
    policies: z.array(z.enum(POLICIES)).min(1, "choose at least one policy"),
    regimes: z.array(z.enum(REGIMES)).min(1, "choose at least one cost regime"),
    seeds: z.array(z.number().int().min(0).max(2 ** 31)).min(1, "enter at least one seed").max(10, "at most 10 seeds"),
    size: sizeEnum,
  })
  .refine((v) => new Set(v.seeds).size === v.seeds.length, { message: "seeds must be distinct", path: ["seeds"] })
  .refine((v) => v.datasets.length * v.policies.length * v.regimes.length * v.seeds.length <= 400, { message: "at most 400 runs per job", path: ["seeds"] });

/** Queue a benchmark job (worker process; progress in SQLite). */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, Submit);
    const r = await ctx.engine.call<{ job_id: string; created: boolean }>("submit_job", { ...b, actor: ctx.user.email }, { timeoutMs: 120_000, dedupeKey: "submit_job" });
    if (r.created) {
      const runs = b.datasets.length * b.policies.length * b.regimes.length * b.seeds.length;
      reportFor(ctx, {
        kind: "benchmark_queued",
        title: "Benchmark queued",
        summary: `${runs} replays will run in a separate worker. You will get a report with the results when it finishes.`,
        status: { label: "Queued", tone: "neutral" },
        facts: [["Job", r.job_id], ["Datasets", b.datasets.join(", ")], ["Policies", String(b.policies.length)], ["Cost regimes", b.regimes.join(", ")], ["Seeds", b.seeds.join(", ")], ["Sample", b.size]],
        href: "/experiments",
      });
    }
    return r;
  },
  { permission: "experiments.run", limit: { max: 10, windowMs: 60_000 } },
);
