import {
  Activity,
  ArrowRight,
  Boxes,
  Clock,
  Gauge,
  Layers,
  ListChecks,
  Microscope,
  ScanSearch,
  ShieldCheck,
  Tags,
  Target,
  TrendingDown,
  Wallet,
} from "lucide-react";
import Link from "next/link";

import { ActivityList } from "@/components/activity";
import { Limitations } from "@/components/limitations";
import { classificationTone } from "@/components/staleness";
import { ErrorTraceChart } from "@/components/charts";
import { EvaluateButton, ProcessBatches, StartDemoButton } from "@/components/run-controls";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, ProgressBar, SimLabel, StatCard, cn } from "@/components/ui";
import { ACTION_LABELS } from "@/lib/catalog";
import { decisionTone, fixed, money, num, pct, signed, statusTone, version } from "@/lib/format";
import { getActiveRun, getEvents, getLabelSummary, getLatestDecision, getRegistry, getSettings, getTelemetry } from "@/lib/queries";
import { errorSeries, versionChanges } from "@/lib/series";

export const dynamic = "force-dynamic";

function Lifecycle({ step }: { step: number }) {
  const steps = [
    { label: "Monitor & probe", help: "Predict first, reveal labels, update detectors; probe a fresh model when worth it" },
    { label: "Evaluate", help: "Train candidates on past rows, score on a chronological hold-out" },
    { label: "Decide", help: "Rank defer / incremental / full by net expected value" },
    { label: "Approve", help: "A person approves; guardrails are re-checked" },
    { label: "Validate & promote", help: "Gate passes → new version; fails → candidate rejected" },
  ];
  return (
    <ol className="grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Decision workflow">
      {steps.map((s, i) => {
        const state = i < step ? "done" : i === step ? "current" : "todo";
        return (
          <li
            key={s.label}
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "rounded-xl border px-3 py-2.5",
              state === "done" && "border-teal-400/20 bg-teal-400/[0.04]",
              state === "current" && "border-teal-400/60 bg-teal-400/10 shadow-[0_0_0_3px_rgba(45,212,191,0.08)]",
              state === "todo" && "border-slate-800 bg-slate-900/30",
            )}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
                  state === "done" ? "bg-teal-400 text-navy-950" : state === "current" ? "bg-teal-400/20 text-teal-200 ring-1 ring-teal-400" : "bg-slate-800 text-slate-400",
                )}
              >
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className={state === "todo" ? "text-slate-400" : "text-slate-100"}>{s.label}</span>
            </div>
            <p className="mt-1 text-xs leading-snug text-slate-500">{s.help}</p>
          </li>
        );
      })}
    </ol>
  );
}

export default async function OverviewPage() {
  const [settings, run] = await Promise.all([getSettings(), getActiveRun()]);

  if (!run) {
    const events = await getEvents({ limit: 6 });
    return (
      <>
        <PageHeader eyebrow="Overview" title="Update a model only when the evidence pays for it" description="RetrainWise watches a deployed classifier on a data stream, estimates how much accuracy an update would recover, prices the action, and recommends a full retrain, an incremental update or deferring — with human approval, chronological validation and a full audit trail." />
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardBody className="p-6 sm:p-8">
              <EmptyState icon={Activity} title="No stream is running yet" action={<div className="flex flex-wrap justify-center gap-3"><StartDemoButton seed={settings.seed} /><Link href="/data" className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium text-slate-300 ring-1 ring-inset ring-slate-700 hover:bg-slate-800">Choose a dataset <ArrowRight className="h-4 w-4" /></Link></div>}>
                The offline demo replays a synthetic stream with known drift points (no download needed). Real datasets — Electricity, Airlines and Covertype — can be downloaded in Data & simulation.
              </EmptyState>
              <div className="mt-8">
                <Lifecycle step={-1} />
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="What is real, what is simulated" icon={ShieldCheck} />
            <CardBody className="space-y-3 text-sm text-slate-300">
              <p><span className="font-medium text-emerald-300">Real:</span> model training (scikit-learn SGD with genuine partial_fit), predictions, metrics, PSI, ADWIN and DDM statistics, chronological validation, the model registry and the SQLite audit log.</p>
              <p><span className="font-medium text-amber-300">Simulated / assumed:</span> dollar prices (an assumed pricing snapshot, not billing data), engineer hours, incident risk, and “deployment”, which is a local registry swap.</p>
              {events.length > 0 && <p className="text-xs text-slate-500">Earlier runs and decisions remain in the audit log.</p>}
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  const [tel, labels, decision, registry, events] = await Promise.all([
    getTelemetry(run.id),
    getLabelSummary(run.id),
    getLatestDecision(run.id),
    getRegistry(run.id),
    getEvents({ limit: 12 }),
  ]);
  const last = tel.at(-1);
  const active = registry.find((m) => m.version === run.active_version);
  const budgetUsed = settings.budget > 0 ? run.spent / settings.budget : 0;
  const top = decision?.ranked?.[0];
  const step = !last ? 0 : !decision || decision.status !== "pending" ? (last.evaluation_suggested ? 1 : 0) : 3;
  const rollingAcc = last?.rolling_error != null ? 1 - last.rolling_error : null;
  const now = Date.now();

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Model health at a glance"
        description={
          <>
            Run <span className="font-mono text-slate-300">{run.id}</span> replays <span className="text-slate-200">{run.dataset}</span> ({run.size_label}, {num(run.n_rows)} rows, seed {run.seed}).{" "}
            {run.dataset === "synthetic" && <SimLabel kind="synthetic" className="ml-1 align-middle" />}
          </>
        }
        actions={<ProcessBatches runId={run.id} position={run.position} nRows={run.n_rows} batchSize={settings.batch_size} compact />}
      />

      <div className="mb-6">
        <Lifecycle step={step} />
      </div>

      {last && run.active_version !== last.version && (
        <Alert tone="accent" title={`${version(run.active_version)} is now active`} className="mb-6">
          It was promoted (or restored) after the latest batch, so the error and drift figures below still describe {version(last.version)}. Process the next batch to start measuring the new model.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active model" icon={Boxes} value={version(run.active_version)} sub={active ? `${active.action === "initial" ? "initial model" : active.action === "partial" ? "incremental update" : "full retrain"} · trained on ${num(active.n_train)} rows` : undefined} info="The model version currently making predictions. Versions change only through an approved (or bounded-autonomy) action that passes validation, or a rollback." tone="accent" />
        <StatCard label="Accuracy" icon={Target} value={pct(rollingAcc)} sub={last ? <>last batch {pct(last.batch_accuracy)} · macro F1 {fixed(last.batch_f1, 3)}</> : "process a batch to measure"} info="Rolling accuracy over the most recent labelled predictions (1 − rolling error). The last-batch value uses only the labels revealed in that batch." />
        <StatCard
          label="Rolling error"
          icon={TrendingDown}
          value={pct(last?.rolling_error)}
          tone={last?.degradation != null && last.degradation > settings.degradation_margin ? "bad" : "neutral"}
          sub={last ? <>{signed(last.degradation != null ? last.degradation * 100 : null, 1)} pts vs reference {pct(last.reference_error)} · 95% CI {last.rolling_error_ci ? `${pct(last.rolling_error_ci[0])}–${pct(last.rolling_error_ci[1])}` : "—"}</> : "—"}
          info={`Error over the last ${num(settings.rolling_window)} labelled predictions with a Wilson 95% interval. The reference is the model's error on its own validation data.`}
        />
        <StatCard label="PSI drift (max)" icon={ScanSearch} value={fixed(last?.max_psi, 3)} tone={last?.max_psi != null && last.max_psi >= settings.psi_threshold ? "warn" : "neutral"} sub={last?.max_psi_feature ? `on “${last.max_psi_feature}” · threshold ${settings.psi_threshold}` : "—"} info="Population Stability Index of the latest batch against the active model's training distribution. High PSI means the inputs changed — not necessarily that the model got worse." />
        <StatCard label="Model age" icon={Clock} value={`${run.batch_index - run.last_update_batch} batches`} sub={`${num(run.monitor.predictions_since_update)} predictions · ${num(run.monitor.labels_since_update)} labels since last update`} info="Staleness: how long the active model has been serving since it was trained or last updated." />
        <StatCard label="Labeled samples" icon={Tags} value={num(labels.revealed)} sub={`${num(labels.available - labels.revealed)} pending · ${num(labels.predicted - labels.available)} never labelled · delay ${settings.label_delay_batches} batch(es)`} info="True labels arrive after a delay and only for a share of predictions (Settings). Only revealed labels are used by monitors, evaluation and retraining." />
        <StatCard
          label="Spending"
          icon={Wallet}
          value={money(run.spent)}
          sub={<>of {money(settings.budget, 0)} budget · evaluations {money(run.evaluation_spent)} · probes {money(run.monitoring_spent)}</>}
          footer={<ProgressBar value={budgetUsed} showValue={false} tone={budgetUsed > 0.85 ? "bad" : budgetUsed > 0.6 ? "warn" : "accent"} className="w-24" />}
          simulated
          info="Cumulative simulated spend of this run: update actions plus shadow-evaluation overhead. Priced from assumed rates."
        />
        <StatCard
          label="Counterfactual staleness"
          icon={Microscope}
          value={last?.staleness?.available ? `${signed((last.staleness.did ?? 0) * 100, 1)} pts` : "—"}
          tone={last?.staleness?.available ? classificationTone(last.staleness.classification) : "neutral"}
          sub={
            last?.staleness?.available && last.staleness.ci ? (
              <>
                avoidable error (probe DiD), 95% CI {signed(last.staleness.ci[0] * 100, 1)} to {signed(last.staleness.ci[1] * 100, 1)} pts · {last.staleness.classification}
              </>
            ) : (
              `baseline probes ${last?.staleness?.baseline_probes ?? 0}/${settings.probe_baseline_probes} for ${version(run.active_version)}`
            )
          }
          info="Difference-in-differences between the deployed model and a fresh probe model on the same new labels: the part of the error a refreshed model could remove, separated from the task simply getting harder."
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Observed error over the stream" icon={Gauge} description="Batch error on revealed labels, rolling error with its 95% interval, and the reference. Dashed teal lines mark model version changes." info="Prequential evaluation: each batch is predicted before its labels are seen, so these are honest out-of-sample errors." />
          <CardBody>
            {tel.length ? (
              <ErrorTraceChart data={errorSeries(tel)} versionChanges={versionChanges(tel)} />
            ) : (
              <EmptyState icon={Gauge} title="No batches processed yet" action={<ProcessBatches runId={run.id} position={run.position} nRows={run.n_rows} batchSize={settings.batch_size} compact />}>
                Each batch is predicted by the active model first; labels that are due are then revealed and fed to the monitors.
              </EmptyState>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Monitoring status" icon={Activity} />
            <CardBody className="space-y-3">
              {last ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={statusTone(last.status)} dot>
                      {last.status}
                    </Badge>
                    {last.adwin_error_increase && <Badge tone="bad">ADWIN alarm</Badge>}
                    {last.ddm_status !== "stable" && <Badge tone={last.ddm_status === "drift" ? "bad" : "warn"}>DDM {last.ddm_status}</Badge>}
                  </div>
                  {last.evaluation_suggested ? (
                    <Alert tone="warn" title="Evaluation suggested">
                      {last.trigger_reasons.join("; ")}.
                    </Alert>
                  ) : (
                    <p className="text-sm text-slate-400">No evaluation trigger yet: {last.trigger_reasons.length ? last.trigger_reasons.join("; ") : "signals below thresholds"}.</p>
                  )}
                  <EvaluateButton runId={run.id} label="Evaluate update options" />
                </>
              ) : (
                <p className="text-sm text-slate-400">Monitoring starts with the first processed batch.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Latest recommendation" icon={ListChecks} action={decision && <Link href="/decisions" className="text-xs font-medium text-teal-300 hover:underline">Details →</Link>} />
            <CardBody>
              {decision && top ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-slate-50">{ACTION_LABELS[decision.recommended]}</span>
                    <Badge tone={decisionTone(decision.status)}>{decision.status}</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {decision.ranked
                      .slice()
                      .sort((a, b) => ["defer", "partial", "full"].indexOf(a.action) - ["defer", "partial", "full"].indexOf(b.action))
                      .map((r) => (
                        <div key={r.action} className={cn("rounded-lg border px-2 py-2", r.action === decision.recommended ? "border-teal-400/50 bg-teal-400/10" : "border-slate-800")}>
                          <div className="text-slate-400">{r.action === "partial" ? "Incremental" : r.action === "full" ? "Full" : "Defer"}</div>
                          <div className={cn("mt-0.5 font-semibold tabular", r.net_value > 0 ? "text-emerald-300" : r.net_value < 0 ? "text-rose-300" : "text-slate-200")}>{money(r.net_value, 0)}</div>
                          <div className="text-[10px] text-slate-500">{r.feasible ? "feasible" : "blocked"}</div>
                        </div>
                      ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Decision <span className="font-mono">{decision.id}</span> at row {num(decision.position)} · {decision.outcome ?? "awaiting approval"} · net values are simulated USD
                  </p>
                  {decision.status === "pending" && (
                    <Link href="/lifecycle" className="inline-flex items-center gap-1 text-sm font-medium text-teal-300 hover:underline">
                      Review and approve <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No decision yet. Evaluate update options once monitoring has gathered enough labels (minimum {settings.min_evidence}).</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" icon={Layers} description="Every action is written to the SQLite audit log." action={<Link href="/agent#audit" className="text-xs font-medium text-teal-300 hover:underline">Full audit log →</Link>} />
          <CardBody>{events.length ? <ActivityList events={events} now={now} /> : <p className="text-sm text-slate-400">No activity yet.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Stream progress" icon={Activity} />
          <CardBody className="space-y-4">
            <ProgressBar value={run.position / run.n_rows} label={`Row ${num(run.position)} of ${num(run.n_rows)}`} />
            <ProgressBar value={labels.predicted ? labels.revealed / labels.predicted : 0} label="Labels revealed / predictions" tone="info" />
            <ProgressBar value={budgetUsed} label={`Budget used (${money(run.spent)} of ${money(settings.budget, 0)}, simulated)`} tone={budgetUsed > 0.85 ? "bad" : "warn"} />
            <div className="text-xs text-slate-500">
              Batch {run.batch_index} · batch size {settings.batch_size} · {run.autonomous_actions} autonomous action(s) · {registry.filter((m) => m.status !== "rejected").length} registered version(s), {registry.filter((m) => m.status === "rejected").length} rejected candidate(s)
            </div>
          </CardBody>
        </Card>
      </div>
      <div className="mt-6">
        <Limitations compact />
      </div>
    </>
  );
}
