import { Activity, AlertTriangle, Eye, Radar, Tags } from "lucide-react";
import type { Metadata } from "next";

import { C } from "@/lib/palette";
import Link from "next/link";

import { ErrorTraceChart, MetricsChart, PsiHeatmap, SimpleBars, StalenessChart } from "@/components/charts";
import { Tabs } from "@/components/client";
import { ReferenceWindow } from "@/components/reference-window";
import { StalenessPanel, classificationTone } from "@/components/staleness";
import { ProcessBatches } from "@/components/run-controls";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Explainer, KV, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { fixed, num, pct, signed, statusTone } from "@/lib/format";
import { getActiveRun, getLabelSummary, getProbes, getSettings, getTelemetry } from "@/lib/queries";
import { errorSeries, metricSeries, psiMatrix, stalenessSeries, versionChanges } from "@/lib/series";

export const metadata: Metadata = { title: "Monitoring" };
export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
  const [settings, run] = await Promise.all([getSettings(), getActiveRun()]);
  const header = (
    <PageHeader
      eyebrow="Monitoring"
      title="Is the model still doing its job?"
      description="Prequential performance on revealed labels, label-based drift detectors (ADWIN, DDM), input drift (PSI), probe-model results with difference-in-differences staleness, label availability, uncertainty and staleness."
      actions={run ? <ProcessBatches runId={run.id} position={run.position} nRows={run.n_rows} batchSize={settings.batch_size} compact /> : undefined}
    />
  );
  if (!run) {
    return (
      <>
        {header}
        <EmptyState icon={Activity} title="No active run" action={<Link href="/data" className="text-sm font-medium text-teal-300 hover:underline">Start a run in Data & simulation →</Link>}>
          Monitoring begins once a stream is running and its first batch has been processed.
        </EmptyState>
      </>
    );
  }
  const [tel, labels, probes] = await Promise.all([getTelemetry(run.id), getLabelSummary(run.id), getProbes(run.id)]);
  if (!tel.length) {
    return (
      <>
        {header}
        <EmptyState icon={Activity} title="No batches processed yet" action={<ProcessBatches runId={run.id} position={run.position} nRows={run.n_rows} batchSize={settings.batch_size} compact />}>
          Process a batch to start collecting monitoring evidence.
        </EmptyState>
      </>
    );
  }
  const last = tel[tel.length - 1];
  const psi = psiMatrix(tel);
  const adwinCount = tel.filter((t) => t.adwin_error_increase).length;
  const ddmDrift = tel.filter((t) => t.ddm_status === "drift").length;
  const ddmWarn = tel.filter((t) => t.ddm_status === "warning").length;
  const ciWidth = last.rolling_error_ci ? last.rolling_error_ci[1] - last.rolling_error_ci[0] : null;
  const latestPsi = Object.entries(last.psi ?? {})
    .filter(([, v]) => v != null)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 15)
    .map(([feature, value]) => ({ feature, psi: Number((value as number).toFixed(4)) }));

  return (
    <>
      {header}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(last.status)} dot>
          {last.status}
        </Badge>
        <Badge tone={last.covariate_signal ? "warn" : "good"}>{last.covariate_signal ? "covariate (input) shift" : "no input shift"}</Badge>
        <Badge tone={last.predictive_signal ? "bad" : "good"}>{last.predictive_signal ? "predictive degradation" : "no predictive degradation"}</Badge>
        {last.sustained_degradation && <Badge tone="bad">sustained: CI above reference + margin</Badge>}
        {last.staleness?.available && <Badge tone={classificationTone(last.staleness.classification)}>probe: {last.staleness.classification}</Badge>}
        <span className="text-xs text-slate-500">as of batch {last.batch_index}, row {num(last.end_row)}</span>
      </div>

      {run.active_version !== last.version && (
        <Alert tone="accent" title={`Model v${String(run.active_version).padStart(3, "0")} became active after the latest batch`} className="mb-4">
          The figures below describe v{String(last.version).padStart(3, "0")} up to row {num(last.end_row)}. Monitors were reset for the new model; process the next batch to start measuring it.
        </Alert>
      )}

      <Alert tone="info" title="Feature drift alone does not prove concept drift" className="mb-6">
        PSI shows that the <em>inputs</em> P(X) moved away from the training data. That may or may not hurt accuracy — the synthetic stream even contains a deliberate covariate-only shift that changes no labels. Only label-based evidence (ADWIN or DDM on prediction errors, or a rolling-error interval that sits above the reference) shows that the model got worse — and only the probe comparison shows whether a refreshed model would actually do better (avoidable staleness) or the task simply got harder for every model.
      </Alert>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Rolling error" value={pct(last.rolling_error)} sub={<>reference {pct(last.reference_error)} · {signed(last.degradation != null ? last.degradation * 100 : null, 1)} pts</>} tone={last.predictive_signal ? "bad" : "neutral"} info="Error over the rolling window of revealed labels." />
        <StatCard label="Uncertainty (95% CI)" value={ciWidth != null ? `±${pct(ciWidth / 2)}` : "—"} sub={last.rolling_error_ci ? `${pct(last.rolling_error_ci[0])} – ${pct(last.rolling_error_ci[1])} from ${num(last.rolling_n)} labels` : "not enough labels"} info="Wilson score interval for the rolling error. Fewer labels → wider interval → weaker evidence." />
        <StatCard label="Detector alarms" value={`${adwinCount} / ${ddmDrift}`} sub={`ADWIN error increases / DDM drifts in this run · ${ddmWarn} DDM warnings`} tone={last.adwin_error_increase || last.ddm_status === "drift" ? "bad" : "neutral"} info="ADWIN detects a statistically significant increase of the error rate within its adaptive window. DDM tracks the error rate and its standard deviation (warning / drift levels)." />
        <StatCard label="Staleness" value={`${run.batch_index - run.last_update_batch} batches`} sub={`${num(run.monitor.predictions_since_update)} predictions since update · learning debt $${fixed(run.monitor.learning_debt * settings.error_value, 2)}`} info="Batches since the active model was trained or updated, and the accumulated cost of excess errors since then (simulated $)." />
      </div>

      <Tabs
        tabs={[
          {
            id: "performance",
            label: "Performance",
            content: (
              <div className="grid gap-6">
                <Card>
                  <CardHeader title="Rolling error with Wilson 95% interval" icon={Activity} description={`Window of ${num(settings.rolling_window)} labels. The shaded band is the uncertainty of the rolling estimate.`} />
                  <CardBody>
                    <ErrorTraceChart data={errorSeries(tel)} versionChanges={versionChanges(tel)} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Accuracy, precision, recall and F1 per batch" icon={Eye} description="Macro-averaged over classes, computed only on labels revealed in each batch (with a label delay these belong to earlier predictions)." />
                  <CardBody>
                    <MetricsChart data={metricSeries(tel)} />
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "probe",
            label: "Probe & DiD staleness",
            badge: last.staleness?.available && last.staleness.classification === "avoidable staleness" ? <Badge tone="bad">!</Badge> : undefined,
            content: <StalenessPanel probes={probes} tel={tel} settings={settings} activeVersion={run.active_version} monitoringSpent={run.monitoring_spent} />,
          },
          {
            id: "detectors",
            label: "Detectors & staleness",
            content: (
              <div className="grid gap-6">
                <Card>
                  <CardHeader title="Learning debt and detector alarms" icon={AlertTriangle} description="Bars: accumulated excess errors × error value since the last update (resets on promotion). Markers: ADWIN error-rate increases and DDM states." />
                  <CardBody>
                    <StalenessChart data={stalenessSeries(tel)} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Per-batch detector log" description="Most recent first. 'Change row' is ADWIN's estimate of where the error rate changed; full retraining can train on rows after it." />
                  <CardBody>
                    <Table caption="Detector log">
                      <thead>
                        <tr>
                          <Th>Batch</Th>
                          <Th align="right">Row</Th>
                          <Th align="right">Model</Th>
                          <Th align="right">Age</Th>
                          <Th align="center">ADWIN</Th>
                          <Th align="center">DDM</Th>
                          <Th align="right">Change row</Th>
                          <Th align="right">Degradation</Th>
                          <Th align="right">Learning debt</Th>
                          <Th>Evaluation trigger</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {tel
                          .slice(-25)
                          .reverse()
                          .map((t) => (
                            <tr key={t.batch_index}>
                              <Td>{t.batch_index}</Td>
                              <Td align="right">{num(t.end_row)}</Td>
                              <Td align="right">v{String(t.version).padStart(3, "0")}</Td>
                              <Td align="right">{t.model_age_batches}</Td>
                              <Td align="center">{t.adwin_error_increase ? <Badge tone="bad">alarm</Badge> : <span className="text-slate-600">—</span>}</Td>
                              <Td align="center">
                                <Badge tone={t.ddm_status === "drift" ? "bad" : t.ddm_status === "warning" ? "warn" : "neutral"}>{t.ddm_status}</Badge>
                              </Td>
                              <Td align="right">{t.change_row != null ? num(t.change_row) : "—"}</Td>
                              <Td align="right">{signed(t.degradation != null ? t.degradation * 100 : null, 1)} pts</Td>
                              <Td align="right">{fixed(t.learning_debt, 1)}</Td>
                              <Td className="max-w-80 whitespace-normal text-xs">{t.evaluation_suggested ? <span className="text-amber-200">{t.trigger_reasons.join("; ")}</span> : <span className="text-slate-500">{t.trigger_reasons.join("; ") || "—"}</span>}</Td>
                            </tr>
                          ))}
                      </tbody>
                    </Table>
                  </CardBody>
                </Card>
              </div>
            ),
          },
          {
            id: "psi",
            label: "Feature drift (PSI)",
            badge: last.shifted_features.length ? <Badge tone="warn">{last.shifted_features.length}</Badge> : undefined,
            content: (
              <div className="grid gap-6">
                <Card>
                  <CardHeader
                    title="PSI per feature and batch"
                    icon={Radar}
                    description={`Each cell compares one batch with the active model's training bins. Red = above the threshold (${settings.psi_threshold}).`}
                    info="A feature is flagged as shifted only when PSI exceeds the threshold AND three times the sampling-noise floor (k−1)(1/n+1/m), so small batches do not raise false alarms."
                  />
                  <CardBody>
                    <PsiHeatmap features={psi.features} batches={psi.batches} values={psi.values} threshold={settings.psi_threshold} />
                  </CardBody>
                </Card>
                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <CardHeader title="Latest batch: most shifted features" />
                    <CardBody>
                      <SimpleBars data={latestPsi} xKey="feature" bars={[{ key: "psi", name: "PSI", color: C.amber }]} layout="vertical" height={Math.max(200, latestPsi.length * 26)} label="PSI per feature in the latest batch" />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Input quality in the latest batch" />
                    <CardBody>
                      <KV
                        className="sm:grid-cols-1"
                        items={[
                          ["Shifted features", last.shifted_features.length ? last.shifted_features.join(", ") : "none"],
                          ["PSI reliable (enough rows)", last.psi_reliable ? "yes" : "no — batch too small"],
                          ["Unseen categories", pct(last.unseen_category_rate, 2)],
                          ["Schema issues", Object.keys(last.schema_issues ?? {}).length ? JSON.stringify(last.schema_issues) : "none"],
                          ["Inference time", `${fixed(last.inference_ms, 1)} ms for ${num(last.predicted)} rows`],
                        ]}
                      />
                    </CardBody>
                  </Card>
                </div>
              </div>
            ),
          },
          {
            id: "labels",
            label: "Labels & reference",
            content: (
              <div className="grid gap-6">
                <div className="grid gap-6 lg:grid-cols-3">
                  <Card className="lg:col-span-2">
                    <CardHeader title="Label availability per batch" icon={Tags} description={`Delay ${settings.label_delay_batches} batch(es) · ${pct(settings.label_fraction, 0)} of predictions ever receive a label (configurable in Settings).`} />
                    <CardBody>
                      <SimpleBars
                        data={tel.map((t) => ({ batch: t.batch_index, revealed: t.labels_revealed, pending: t.labels_pending }))}
                        xKey="batch"
                        bars={[
                          { key: "revealed", name: "Labels revealed", color: C.teal },
                          { key: "pending", name: "Labels pending", color: C.amber },
                        ]}
                        label="Labels revealed and pending per batch"
                      />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Label totals" />
                    <CardBody>
                      <KV
                        className="sm:grid-cols-1"
                        items={[
                          ["Predictions made", num(labels.predicted)],
                          ["Will receive a label", num(labels.available)],
                          ["Revealed so far", num(labels.revealed)],
                          ["Pending (delayed)", num(labels.available - labels.revealed)],
                          ["Never labelled", num(labels.predicted - labels.available)],
                          ["Labels since last update", num(run.monitor.labels_since_update)],
                          ["Needed before evaluation", num(settings.min_evidence)],
                        ]}
                      />
                    </CardBody>
                  </Card>
                </div>
                <Card>
                  <CardHeader title="Reference window of the active model" description="What the active model was trained on. Drift statistics are always measured against this window." />
                  <CardBody>{run.active_version != null && <ReferenceWindow version={run.active_version} latestPsi={last.psi ?? {}} />}</CardBody>
                </Card>
              </div>
            ),
          },
        ]}
      />

      <div className="mt-6">
        <Explainer title="How to read these signals">
          <p>
            <strong className="text-slate-200">Covariate shift</strong> (PSI) means new inputs look different from training data. <strong className="text-slate-200">Predictive degradation</strong> means the model makes more mistakes, measured on revealed labels.
          </p>
          <p>Both together are the strongest case for an update. PSI without degradation is a reason to watch, not to retrain. Degradation with few labels is uncertain — the interval tells you how uncertain.</p>
          <p>Monitoring never changes the model. It only suggests a shadow evaluation when the evidence is worth paying for; see Decision analysis.</p>
        </Explainer>
      </div>
    </>
  );
}
