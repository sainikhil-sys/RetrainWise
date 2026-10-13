import { BarChart3, FlaskConical, ListTodo } from "lucide-react";
import type { Metadata } from "next";

import { ExperimentForm, JobsPanel, ResultsViewer } from "@/components/experiments";
import { Limitations } from "@/components/limitations";
import { Card, CardBody, CardHeader, Explainer, PageHeader } from "@/components/ui";
import { POLICIES, POLICY_COLORS, POLICY_HELP, POLICY_LABELS, type DatasetName } from "@/lib/catalog";
import { engineCall } from "@/lib/engine";
import { getJobs } from "@/lib/queries";

export const metadata: Metadata = { title: "Experiments" };
export const dynamic = "force-dynamic";

type Sets = { sets: { prefix: string; runs: number; datasets: string[]; regimes: string[]; seeds: number[]; size: string | null }[] };

export default async function ExperimentsPage() {
  const [jobs, catalog, sets] = await Promise.all([
    getJobs(8),
    engineCall<{ datasets: { name: DatasetName; cached: boolean }[] }>("datasets", {}, { timeoutMs: 180_000 }),
    engineCall<Sets>("experiment_sets", {}, { timeoutMs: 180_000 }),
  ]);
  const cached = catalog.datasets.filter((d) => d.cached).map((d) => d.name);
  return (
    <>
      <PageHeader
        eyebrow="Experiments"
        title="Benchmark RetrainWise against other policies"
        description="Reproducible replays on identical streams, label masks and cost traces. Jobs run in a separate Python worker process; progress, cancellation and failures are stored in SQLite, and results are written to CSV/JSON files."
      />

      <div className="mb-6 grid gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader title="New benchmark" icon={FlaskConical} />
          <CardBody>
            <ExperimentForm cached={cached} />
          </CardBody>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader title="Jobs" icon={ListTodo} description="Updates live while a job runs." />
          <CardBody>
            <JobsPanel initial={jobs} />
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Results" icon={BarChart3} description="Saved comparisons, including the submitted results (results_*: 216 standard-size runs; results_full_*: complete datasets)." />
        <CardBody>
          <ResultsViewer sets={sets.sets} />
        </CardBody>
      </Card>

      <div className="mb-6">
        <Limitations />
      </div>

      <Explainer title="The six policies">
        <ul className="space-y-2">
          {POLICIES.map((p) => (
            <li key={p} className="flex gap-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: POLICY_COLORS[p] }} aria-hidden />
              <span>
                <strong className="text-slate-200">{POLICY_LABELS[p]}.</strong> {POLICY_HELP[p]}
              </span>
            </li>
          ))}
        </ul>
        <p>Accuracy scores every prediction offline; online policies only ever use labels that have been revealed. Costs are simulated USD.</p>
      </Explainer>
    </>
  );
}
