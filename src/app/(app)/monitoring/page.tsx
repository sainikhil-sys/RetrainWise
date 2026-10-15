import { Pulse } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { EvaluateButton, ProcessBatchButton, StartDemoButton } from "@/components/actions";
import { ChartLegend, LineChartMono, PsiHeatmap } from "@/components/charts";
import { Reveal } from "@/components/motion";
import { Callout, DataTable, EmptyState, Explainer, KV, MetricStrip, NextStep, PageHeader, Section, SimLabel, Status, Tag, type Tone } from "@/components/rw";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePage } from "@/lib/authz";
import { money, num, pct, signed } from "@/lib/format";
import { chartAnnotations, stateSentence, v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getLabelSummary, getProbes, getRegistry, getSettings, getTelemetry, listDecisions } from "@/lib/queries";
import { errorSeries, metricSeries, probeSeries, psiMatrix, renewalSeries } from "@/lib/series";

export const metadata: Metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

function classTone(label: string | null | undefined): Tone {
  if (label === "avoidable staleness") return "bad";
  if (label === "task harder for all models") return "warn";
  if (label === "no material staleness") return "ok";
  return "neutral";
}
const pts = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${signed(x * 100, d)} pts`);

export default async function MonitoringPage() {
  const ctx = await requirePage("/monitoring");
  const ws = ctx.workspace.id;
  const [settings, run] = await Promise.all([getSettings(ws), getActiveRun(ws)]);
  const canOperate = can(ctx.role, "stream.operate");

  if (!run) {
    return (
      <Reveal>
        <PageHeader title="Monitoring" description="Prediction quality, feature drift and counterfactual staleness for the monitored model." />
        <EmptyState
          icon={Pulse}
          title="No model is being monitored"
          action={canOperate ? <StartDemoButton regime={ctx.workspace.defaultRegime} /> : undefined}
          className="py-16"
        >
          Start a stream in Data &amp; streams. Monitoring fills in as batches are predicted and labels arrive.
        </EmptyState>
      </Reveal>
    );
  }

  const [tel, probes, registry, decisions, labels] = await Promise.all([
    getTelemetry(ws, run.id),
    getProbes(ws, run.id),
    getRegistry(ws, run.id),
    listDecisions(ws, run.id, 50),
    getLabelSummary(ws, run.id),
  ]);
  const last = tel.at(-1);
  const st = last?.staleness;
  const renewal = last?.renewal;
  const psi = psiMatrix(tel);
  const probeData = probeSeries(probes.slice().sort((a, b) => a.batch_index - b.batch_index || a.id - b.id));
  const estimates = probes.filter((p) => p.phase === "estimate");
  const monitoringSpent = last?.monitoring_spent ?? probes.reduce((s, p) => s + p.cost, 0);
  const covariateOnly = last && last.covariate_signal && !last.predictive_signal;
  const recentProbes = probes.slice().reverse().slice(0, 25);

  return (
    <Reveal>
      <PageHeader
        title="Monitoring"
        description={stateSentence(run, tel)}
        actions={
          canOperate && run.position < run.n_rows ? (
            <>
              <ProcessBatchButton runId={run.id} position={run.position} variant="secondary" />
              <EvaluateButton runId={run.id} variant="secondary" />
            </>
          ) : undefined
        }
      />

      {!last ? (
        <EmptyState title="No batches yet" action={canOperate && <ProcessBatchButton runId={run.id} position={run.position} />}>
          Process the first batch: the model predicts it, labels are revealed after the configured delay, and the monitors update.
        </EmptyState>
      ) : (
        <>
          <MetricStrip
            items={[
              {
                label: "Rolling error",
                value: pct(last.rolling_error),
                sub: `${pts(last.degradation)} vs reference ${pct(last.reference_error)}`,
                tone: last.predictive_signal ? "bad" : undefined,
                info: `Error over the last ${num(settings.rolling_window)} labelled predictions, measured before each batch's labels were seen.`,
              },
              {
                label: "Avoidable staleness",
                value: st?.available ? pts(st.did) : "—",
                sub: st?.available ? st.classification : `building baseline · ${st?.baseline_probes ?? 0}/${settings.probe_baseline_probes} probes`,
                tone: st?.available ? classTone(st.classification) : undefined,
                info: "Difference-in-differences: (deployed − probe error now) − (deployed − probe error at deployment). The part of the error a refreshed model could remove.",
              },
              {
                label: "Max PSI",
                value: last.max_psi != null ? last.max_psi.toFixed(3) : "—",
                sub: last.max_psi_feature ? `${last.max_psi_feature} · ${last.shifted_features.length} feature${last.shifted_features.length === 1 ? "" : "s"} over ${settings.psi_threshold}` : "no feature distribution data",
                tone: last.covariate_signal ? "warn" : undefined,
                info: "Population stability index between the reference window and the latest batch. It measures input change, not accuracy.",
              },
              {
                label: "Probe spend",
                value: money(monitoringSpent),
                sub: (
                  <>
                    {probes.length} probe{probes.length === 1 ? "" : "s"} · budget {money(settings.monitoring_budget, 0)} · <SimLabel />
                  </>
                ),
                tone: monitoringSpent > settings.monitoring_budget * 0.85 ? "bad" : undefined,
              },
            ]}
          />

          {covariateOnly && (
            <Callout tone="warn" title="Feature distribution changed, but predictive degradation is not confirmed" className="mt-8">
              PSI is above the threshold on {last.shifted_features.join(", ") || last.max_psi_feature}, while labelled error is within its interval. Process more batches before acting on drift alone.
            </Callout>
          )}

          <Section
            title="Prediction quality"
            description="Every batch is predicted before its labels are revealed. Lines mark model changes, drift alarms and decisions."
            action={<ChartLegend items={[{ label: "Rolling error", tone: "primary" }, { label: "Batch error", tone: "tertiary" }, { label: "Reference", tone: "secondary", dashed: true }, { label: "95% interval", tone: "tertiary", band: true }]} />}
          >
            <Tabs defaultValue="error">
              <TabsList>
                <TabsTrigger value="error">Error</TabsTrigger>
                <TabsTrigger value="metrics">Accuracy, precision, recall, F1</TabsTrigger>
              </TabsList>
              <TabsContent value="error" className="pt-4">
                <LineChartMono
                  label="Rolling error, batch error and reference error over the stream"
                  data={errorSeries(tel)}
                  xKey="row"
                  xLabel="row"
                  xFormat="thousands"
                  yFormat="pct"
                  height={320}
                  band={{ key: "ci", name: "95% interval" }}
                  series={[
                    { key: "batchError", name: "Batch error", tone: "tertiary", width: 1 },
                    { key: "reference", name: "Reference", tone: "secondary", dashed: true, step: true },
                    { key: "rolling", name: "Rolling error", tone: "primary", width: 2 },
                  ]}
                  annotations={chartAnnotations(tel, registry, decisions)}
                />
              </TabsContent>
              <TabsContent value="metrics" className="pt-4">
                <LineChartMono
                  label="Per-batch accuracy, precision, recall and macro F1"
                  data={metricSeries(tel)}
                  xKey="row"
                  xLabel="row"
                  xFormat="thousands"
                  yFormat="pct"
                  height={320}
                  series={[
                    { key: "accuracy", name: "Accuracy", tone: "primary", width: 2 },
                    { key: "precision", name: "Precision", tone: "secondary" },
                    { key: "recall", name: "Recall", tone: "secondary", dashed: true },
                    { key: "f1", name: "Macro F1", tone: "quaternary" },
                  ]}
                />
              </TabsContent>
            </Tabs>
            <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
              {[
                ["Model", v(run.active_version)],
                ["Model age", `${last.model_age_batches} batches`],
                ["Labels", labels ? `${num(labels.revealed)} revealed · ${num(labels.available - labels.revealed)} pending` : "—"],
                ["Inference", `${last.inference_ms.toFixed(1)} ms per batch`],
                ["Unseen categories", last.unseen_category_rate != null ? pct(last.unseen_category_rate) : "—"],
              ].map(([k, val]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="tabular font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section
            title="Counterfactual staleness"
            description="A cheap probe model is trained on recent labelled rows (cross-fitted) and scored on the same rows as the deployed model. Its change separates avoidable staleness from a task that got harder for every model."
          >
            {!probes.length ? (
              <EmptyState title="No probes yet">
                The first probe runs once {settings.probe_min_labels} new labels have arrived. The deployment-time gap between the deployed model and the probe is measured on the model&apos;s chronological hold-out.
              </EmptyState>
            ) : (
              <>
                <div className="grid gap-x-12 gap-y-8 lg:grid-cols-2">
                  <div>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-[13.5px] font-medium">Deployed vs fresh probe</h3>
                      <ChartLegend items={[{ label: "Deployed", tone: "primary" }, { label: "Probe", tone: "secondary", dashed: true }]} />
                    </div>
                    <LineChartMono
                      label="Deployed model error and probe model error at each probe"
                      data={probeData}
                      xKey="batch"
                      xLabel="batch"
                      yFormat="pct"
                      height={240}
                      series={[
                        { key: "deployed", name: "Deployed", tone: "primary", dots: true },
                        { key: "probe", name: "Probe", tone: "secondary", dashed: true, dots: true },
                      ]}
                    />
                  </div>
                  <div>
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h3 className="text-[13.5px] font-medium">Difference-in-differences</h3>
                      <ChartLegend items={[{ label: "Avoidable staleness", tone: "primary" }, { label: "Task hardness", tone: "secondary", dashed: true }, { label: "95% CI", tone: "tertiary", band: true }]} />
                    </div>
                    {estimates.length ? (
                      <LineChartMono
                        label="Avoidable staleness estimate with 95% interval and task-hardness shift"
                        data={probeData}
                        xKey="batch"
                        xLabel="batch"
                        yFormat="pts"
                        height={240}
                        band={{ key: "band", name: "95% CI" }}
                        hLines={[{ y: 0, label: "no staleness" }]}
                        series={[
                          { key: "did", name: "Avoidable staleness", tone: "primary", dots: true, width: 2 },
                          { key: "hardness", name: "Task hardness", tone: "secondary", dashed: true },
                        ]}
                      />
                    ) : (
                      <p className="flex h-[240px] items-center justify-center rounded-md border border-dashed border-border text-[13px] text-muted-foreground">Estimates start after the baseline is measured.</p>
                    )}
                  </div>
                </div>

                {st?.available && st.classification === "task harder for all models" && (
                  <Callout tone="warn" title="The task got harder, but the model is not avoidably stale" className="mt-6">
                    The deployed model and a freshly trained probe got worse by a similar amount. Retraining is unlikely to recover this error.
                  </Callout>
                )}
                {st?.baseline && (
                  <p className="mt-4 text-[12px] text-muted-foreground">
                    Baseline gap for {v(run.active_version)}: {pts(st.baseline.gap)} on {num(st.baseline.n)} labels, from {st.baseline.source ?? "post-deployment probes"}. Positive baseline gaps are capped at zero.
                  </p>
                )}

                <div className="mt-8">
                  <DataTable
                    caption="Probe log"
                    rows={recentProbes}
                    rowKey={(p) => p.id}
                    columns={[
                      { key: "b", header: "Batch", cell: (p) => <span className="font-mono">{p.batch_index}</span> },
                      { key: "v", header: "Model", cell: (p) => v(p.version) },
                      { key: "ph", header: "Phase", cell: (p) => <Tag>{p.phase}</Tag> },
                      { key: "n", header: "Labels", align: "right", cell: (p) => num(p.n) },
                      { key: "d", header: "Deployed", align: "right", cell: (p) => pct(p.deployed_error) },
                      { key: "p", header: "Probe", align: "right", cell: (p) => pct(p.probe_error) },
                      { key: "did", header: "DiD", align: "right", cell: (p) => pts(p.did) },
                      { key: "c", header: "Verdict", cell: (p) => (p.classification ? <Status tone={classTone(p.classification)}>{p.classification}</Status> : <span className="text-muted-foreground">baseline</span>) },
                      { key: "cost", header: "Cost", align: "right", mobile: false, cell: (p) => money(p.cost, 4) },
                      { key: "why", header: "Why it ran", mobile: false, cell: (p) => <span className="text-[12px] text-ink-2">{p.reason}</span> },
                    ]}
                  />
                  <p className="mt-2 text-[11.5px] text-muted-foreground">
                    {settings.probe_mode === "adaptive"
                      ? `Adaptive scheduling: a probe runs when its expected value of information exceeds its cost, between ${settings.probe_min_interval} and ${settings.probe_max_interval} batches apart, within the monitoring budget.`
                      : `Fixed scheduling: one probe every ${settings.probe_every} batch(es).`}{" "}
                    <SimLabel>Probe costs are simulated</SimLabel>
                  </p>
                </div>
              </>
            )}
          </Section>

          <Section title="Feature drift" description={`Population stability index per feature and batch. Cells above ${settings.psi_threshold} are marked. Drift in inputs does not by itself mean the model got worse.`}>
            {psi.features.length ? (
              <PsiHeatmap features={psi.features.slice(0, 16)} batches={psi.batches} values={psi.values.slice(0, 16)} threshold={settings.psi_threshold} />
            ) : (
              <p className="text-[13px] text-muted-foreground">No PSI data yet.</p>
            )}
            {psi.features.length > 16 && <p className="mt-2 text-[12px] text-muted-foreground">Showing the 16 most-drifted of {psi.features.length} features.</p>}
          </Section>

          <div className="grid gap-x-12 lg:grid-cols-2">
            <Section title="Drift detectors">
              <KV
                items={[
                  ["Status", <Status key="s" tone={last.predictive_signal ? "bad" : last.covariate_signal ? "warn" : "ok"}>{last.status}</Status>],
                  ["ADWIN", last.adwin_error_increase ? <Status key="a" tone="bad">error increase detected</Status> : `${last.adwin_detections} detection${last.adwin_detections === 1 ? "" : "s"} this run`],
                  ["DDM", <Status key="d" tone={last.ddm_status === "drift" ? "bad" : last.ddm_status === "warning" ? "warn" : "ok"}>{last.ddm_status}</Status>],
                  ["Sustained degradation", last.sustained_degradation ? "yes" : "no"],
                  ["Learning debt", `${money(last.learning_debt_cost)} · ${num(last.learning_debt)} excess errors`],
                  ["Evaluation suggested", last.evaluation_suggested ? last.trigger_reasons.join("; ") || "yes" : "no"],
                ]}
              />
              {last.evaluation_suggested && canOperate && (
                <div className="mt-4">
                  <EvaluateButton runId={run.id} variant="secondary" />
                </div>
              )}
            </Section>

            <Section title="Renewal rule" action={<SimLabel />}>
              {renewal?.available ? (
                <>
                  <div className="flex items-center gap-3">
                    <span className="font-serif text-[26px] leading-tight">{renewal.due ? "Update due" : "Not yet due"}</span>
                    <Status tone={renewal.due ? "bad" : "ok"}>{renewal.due ? "marginal ≥ average" : "marginal < average"}</Status>
                  </div>
                  <KV
                    className="mt-3"
                    items={[
                      ["Marginal cost of continuing", `${money(renewal.marginal, 5)} per prediction`],
                      ["Running average cycle cost", `${money(renewal.average, 5)} per prediction`],
                      ["Renewal cost", money(renewal.renewal_cost)],
                      ["Cycle length", `${num(renewal.cycle_predictions)} predictions`],
                    ]}
                  />
                  <div className="mt-4">
                    <LineChartMono
                      label="Marginal versus average cost per prediction over the stream"
                      data={renewalSeries(tel)}
                      xKey="batch"
                      xLabel="batch"
                      yFormat="money"
                      height={180}
                      series={[
                        { key: "marginal", name: "Marginal", tone: "primary" },
                        { key: "average", name: "Average", tone: "secondary", dashed: true },
                      ]}
                    />
                  </div>
                </>
              ) : (
                <p className="text-[13px] text-muted-foreground">{renewal && !renewal.available && renewal.reason ? renewal.reason : "Needs an avoidable-staleness estimate."}</p>
              )}
              <Explainer>
                End a model cycle when the avoidable error cost of continuing reaches the running average cost of the cycle, renewal included. Early in a cycle the average is dominated by the renewal cost, so updates are rarely due. Rapidly ageing models with cheap retraining favour more aggressive schedules.
              </Explainer>
            </Section>
          </div>

          <div className="pt-10">
            <NextStep
              title={last.evaluation_suggested ? "Evaluate update options" : "Process the next batch to refresh evidence"}
              action={canOperate ? last.evaluation_suggested ? <EvaluateButton runId={run.id} /> : run.position < run.n_rows ? <ProcessBatchButton runId={run.id} position={run.position} /> : undefined : undefined}
            >
              {last.evaluation_suggested
                ? "The monitors flagged enough evidence to compare keeping the model with a partial update and a full retrain."
                : "Monitors and the staleness estimate update as new labels arrive."}
            </NextStep>
          </div>
        </>
      )}
    </Reveal>
  );
}
