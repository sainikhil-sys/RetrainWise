import type { Metadata } from "next";

import { Reveal } from "@/components/motion";
import { Explainer, PageHeader, Section } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { POLICIES, POLICY_HELP, POLICY_LABELS, type DatasetName } from "@/lib/catalog";
import { wsEngine } from "@/lib/engine";
import { can } from "@/lib/permissions";
import { getJobsByKind } from "@/lib/queries";
import { BenchmarkForm, BenchmarkJobs, ResultsViewer } from "./_components/benchmark";
import { reportFinishedJobs } from "@/lib/report-jobs";

export const metadata: Metadata = { title: "Experiments" };
export const dynamic = "force-dynamic";

type Sets = { sets: { prefix: string; reference: boolean; runs: number; datasets: string[]; regimes: string[]; seeds: number[]; size: string | null }[] };

export default async function ExperimentsPage() {
  const ctx = await requirePage("/experiments");
  const ws = ctx.workspace.id;
  const engine = wsEngine(ws);
  const canRun = can(ctx.role, "experiments.run");
  const [jobs, catalog, sets] = await Promise.all([
    getJobsByKind(ws, "benchmark", 8),
    engine.call<{ datasets: { name: DatasetName; cached: boolean }[] }>("datasets", {}, { timeoutMs: 180_000 }),
    engine.call<Sets>("experiment_sets", {}, { timeoutMs: 180_000 }),
  ]);
  void reportFinishedJobs(ws, jobs).catch(() => undefined);
  const cached = catalog.datasets.filter((d) => d.cached).map((d) => d.name);

  return (
    <Reveal>
      <PageHeader
        title="Experiments"
        description="Replay the same streams under every policy, with identical label masks and cost traces, and compare accuracy against total cost. Benchmarks run in a separate worker process."
      />

      <div className="grid gap-x-12 lg:grid-cols-[1.25fr_1fr]">
        <Section title="New benchmark" flush>
          {canRun ? <BenchmarkForm cached={cached} /> : <p className="text-[13px] text-muted-foreground">Running benchmarks requires the Operator role. You can still read every result set below.</p>}
        </Section>
        <Section title="Jobs" flush>
          <BenchmarkJobs jobs={jobs} canCancel={canRun} />
        </Section>
      </div>

      <Section title="Results" description="Saved comparisons from this workspace, plus the reference result sets shipped with the project (results_* and results_v2_*).">
        <ResultsViewer sets={sets.sets} />
      </Section>

      <Section title="Limitations">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li>Costs are simulated from an assumed price snapshot; error value and horizon are assumptions. Rankings change under other assumptions.</li>
          <li>RetrainWise does not win everywhere. When a model ages quickly and retraining is cheap, aggressive schedules (calendar or drift-triggered) can have a lower total cost. Electricity under cheap and balanced pricing is such a case in the reference results.</li>
          <li>The probe adds monitoring cost. When staleness is rare, that cost may not pay for itself.</li>
          <li>The hindsight oracle uses future labels and is only an upper reference.</li>
        </ul>
      </Section>

      <div className="mt-8">
        <Explainer title="The six policies">
          <ul className="space-y-2">
            {POLICIES.map((p) => (
              <li key={p}>
                <span className="font-medium text-foreground">{POLICY_LABELS[p]}.</span> {POLICY_HELP[p]}
              </li>
            ))}
          </ul>
          <p className="mt-2">Accuracy scores every prediction offline; online policies only use labels that have been revealed.</p>
        </Explainer>
      </div>
    </Reveal>
  );
}
