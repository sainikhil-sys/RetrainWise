import "server-only";

import { prisma } from "./prisma";
import { pct, reportWork, ver } from "./report";
import type { JobRow } from "./types";

const DONE = new Set(["completed", "failed", "cancelled", "interrupted"]);

/**
 * Send one completion report per finished job to the person who requested it.
 * Called wherever jobs are read (jobs API, job detail, Models and Experiments
 * pages), so the report goes out as soon as anyone sees the job finish.
 * Deduplicated by job id and status.
 */
export async function reportFinishedJobs(workspaceId: string, jobs: JobRow[]) {
  const finished = jobs.filter((j) => DONE.has(j.status) && j.payload?.requested_by && j.finished && Date.now() - Date.parse(j.finished) < 24 * 3600_000);
  if (!finished.length) return;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
  for (const j of finished) {
    const email = String(j.payload.requested_by);
    const training = j.kind === "training";
    const ok = j.status === "completed";
    const m = j.result?.evaluation?.metrics;
    const parent = j.result?.evaluation?.parent;
    const facts: [string, string][] = training
      ? ok
        ? [
            ["Job", j.id],
            ["Candidate", ver(j.result?.version)],
            ["Accuracy", pct(m?.accuracy)],
            ["Macro F1", pct(m?.f1)],
            ["Error rate", pct(m?.error_rate)],
            ["Change vs production", parent?.comparable ? `${parent.accuracy_change >= 0 ? "+" : "−"}${Math.abs(parent.accuracy_change * 100).toFixed(2)} pts accuracy` : "not directly comparable"],
            ["Validation gate", j.result?.gate ? (j.result.gate.passed ? "passed" : "not passed") : "—"],
            ["Duration", j.result?.evaluation ? `${j.result.evaluation.total_seconds.toFixed(1)} s` : "—"],
          ]
        : [["Job", j.id], ["Status", j.status], ["Reason", (j.error ?? j.message ?? "—").split("\n")[0].slice(0, 300)]]
      : ok
        ? [["Job", j.id], ["Replays", String(j.result?.runs ?? "—")], ["Wall time", j.result?.wall_seconds != null ? `${Math.round(j.result.wall_seconds)} s` : "—"], ["Datasets", (j.payload.datasets ?? []).join(", ")]]
        : [["Job", j.id], ["Status", j.status], ["Reason", (j.error ?? j.message ?? "—").split("\n")[0].slice(0, 300)]];
    reportWork(
      { email, workspaceId, workspaceName: ws?.name },
      {
        kind: training ? `training_${j.status}` : `benchmark_${j.status}`,
        title: training
          ? ok
            ? `Training finished: candidate ${ver(j.result?.version)} is ready for review`
            : `Training job ${j.status}`
          : ok
            ? "Benchmark finished"
            : `Benchmark ${j.status}`,
        summary: training
          ? ok
            ? "The model was trained on earlier rows and validated on withheld, later rows. It is a candidate: production changes only after an approver promotes it."
            : "No candidate was registered and production is unchanged. The worker log has the details."
          : ok
            ? "All replays finished. Compare accuracy against total cost per dataset and price regime in Experiments."
            : "The benchmark stopped early. Results already written are kept.",
        status: ok ? { label: "Completed", tone: "ok" } : { label: j.status, tone: j.status === "failed" ? "bad" : "warn" },
        facts,
        href: training ? (ok && j.result?.version ? `/models/${j.result.version}` : "/models") : "/experiments",
        ctaLabel: training && ok ? "Review the candidate" : "Open in RetrainWise",
        dedupeKey: `job:${j.id}:${j.status}`,
      },
    );
  }
}
