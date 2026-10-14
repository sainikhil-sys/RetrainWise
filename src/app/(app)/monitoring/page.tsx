import { Chart } from "@/components/charts";
import { SERIES } from "@/lib/palette";
import { QuerySelect, Tabs } from "@/components/client";
import { ProcessControls } from "@/components/controls";
import { Alert, Badge, DataTable, Header } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { cellText, pct, statusTone, version } from "@/lib/format";
import { lifecycle, type Telemetry } from "@/lib/lifecycle";

function heatColor(v: number | null, max: number): string {
  if (v === null || !Number.isFinite(v)) return "transparent";
  const t = Math.min(1, v / max);
  // light blue -> deep blue
  const from = [240, 246, 254];
  const to = [13, 54, 107];
  const c = from.map((f, i) => Math.round(f + (to[i] - f) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function PsiHeatmap({ tel, threshold }: { tel: Telemetry[]; threshold: number }) {
  const features = Object.keys(tel.at(-1)?.psi || {});
  const values = tel.flatMap((t) => Object.values(t.psi || {}) as (number | null)[]).filter((v): v is number => v !== null);
  const max = Math.max(0.5, ...values);
  return (
    <div className="card">
      <div style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: 8 }}>
        PSI per feature vs the active model&apos;s fixed training bins (threshold {threshold}, scale 0 – {max.toFixed(2)})
      </div>
      <div className="heatmap" style={{ gridTemplateColumns: `max-content repeat(${tel.length}, minmax(10px, 1fr))` }}>
        {features.map((f) => [
          <div key={`l-${f}`} className="rowlabel">{f}</div>,
          ...tel.map((t) => {
            const v = t.psi?.[f] ?? null;
            return <div key={`${f}-${t.batch_index}`} className="cell" style={{ background: heatColor(v, max) }}
              title={`row ${t.end_row} · ${f}: PSI ${v === null ? "—" : v.toFixed(3)}`} />;
          }),
        ])}
      </div>
      <p className="muted">Hover a cell for its value. Columns are batches in stream order.</p>
    </div>
  );
}

export default async function Monitoring({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const life = lifecycle();
  const cfg = life.settings();
  const run = life.activeRun();
  const header = <Header title="Monitoring" subtitle="Prequential performance, label-based detectors, covariate drift and label availability." />;
  if (!run) return <>{header}<Alert>Start a run in <strong>Data and simulation</strong> first. The synthetic stream works fully offline.</Alert></>;
  const tel = life.telemetry(run.id);
  if (!tel.length) return <>{header}<Alert>No batches processed yet.</Alert><ProcessControls run={run} /></>;
  const last = tel.at(-1)!;
  const perf = tel.map((t) => ({ end_row: t.end_row, batch_accuracy: t.batch_accuracy, batch_f1: t.batch_f1,
    batch_precision: t.batch_precision, batch_recall: t.batch_recall }));
  const rolling = tel.map((t) => ({ end_row: t.end_row, ci: t.rolling_error_ci, rolling_error: t.rolling_error,
    reference_error: t.reference_error }));
  const labelRows = tel.map((t) => ({ end_row: t.end_row, labels_revealed: t.labels_revealed, labels_pending: t.labels_pending }));
  const debtTop = Math.max(1, ...tel.map((t) => t.learning_debt_cost || 0));
  const detectorRows = tel.map((t) => ({
    end_row: t.end_row, learning_debt_cost: t.learning_debt_cost,
    adwin: t.adwin_error_increase ? debtTop * 1.08 : null,
    ddm_drift: t.ddm_status === "drift" ? debtTop * 1.16 : null,
    ddm_warning: t.ddm_status === "warning" ? debtTop * 1.16 : null,
  }));
  const model = life.model(run.active_version);
  const params = await searchParams;
  const features = Object.keys(model.psi_reference);
  const feature = features.includes(params.feature) ? params.feature : features[0];
  const spec = model.psi_reference[feature];
  const binLabels = spec.kind === "numeric"
    ? [`≤ ${spec.edges[0].toPrecision(4)}`, ...spec.edges.slice(1).map((b, i) => `(${spec.edges[i].toPrecision(4)}, ${b.toPrecision(4)}]`),
      `> ${spec.edges.at(-1)!.toPrecision(4)}`, "missing"]
    : [...spec.values, "other/unseen", "missing"];
  return (
    <>
      {header}
      <div className="row">
        <Badge tone={statusTone(last.status)}>{last.status}</Badge>
        {last.covariate_signal ? <Badge tone="warn">covariate signal</Badge> : <Badge tone="good">no covariate signal</Badge>}
        {last.predictive_signal ? <Badge tone="bad">predictive signal</Badge> : <Badge tone="good">no predictive signal</Badge>}
      </div>
      <p className="muted">PSI shows that P(X) moved; it is not proof of concept drift. Predictive degradation needs label
        evidence: ADWIN/DDM on prediction errors or a rolling error whose 95% CI sits above the reference.</p>
      <Tabs labels={["Performance", "Detectors & staleness", "Feature drift (PSI)", "Labels & reference"]}>
        <div className="stack">
          <Chart title="Metrics on labels revealed in each batch" data={perf} x="end_row" series={[
            { key: "batch_accuracy", name: "Accuracy", color: SERIES.blue },
            { key: "batch_f1", name: "Macro F1", color: SERIES.aqua },
            { key: "batch_precision", name: "Macro precision", color: SERIES.violet },
            { key: "batch_recall", name: "Macro recall", color: SERIES.orange },
          ]} />
          <Chart title={`Rolling error (window ${cfg.rolling_window}) with Wilson 95% interval`} data={rolling} x="end_row" series={[
            { key: "ci", name: "95% CI", color: SERIES.orange, kind: "band" },
            { key: "rolling_error", name: "Rolling error", color: SERIES.orange },
            { key: "reference_error", name: "Reference error", color: SERIES.grey, dashed: true },
          ]} />
        </div>
        <div className="stack">
          <Chart title="Accumulated staleness (excess errors × error value) and detector alarms" data={detectorRows} x="end_row"
            money series={[
              { key: "learning_debt_cost", name: "Learning debt ($)", color: SERIES.blue, kind: "bar" },
              { key: "adwin", name: "ADWIN error increase", color: SERIES.red, kind: "scatter", shape: "triangle" },
              { key: "ddm_drift", name: "DDM drift", color: SERIES.violet, kind: "scatter", shape: "cross" },
              { key: "ddm_warning", name: "DDM warning", color: SERIES.yellow, kind: "scatter", shape: "circle" },
            ]} />
          <DataTable rows={[...tel].reverse().map((t) => ({ batch: t.batch_index, end_row: t.end_row, version: version(t.version),
            model_age_batches: t.model_age_batches, predictions_since_update: t.predictions_since_update,
            labels_since_update: t.labels_since_update, adwin_increase: t.adwin_error_increase, ddm: t.ddm_status,
            change_row: t.change_row, degradation: t.degradation, learning_debt: t.learning_debt,
            evaluation_suggested: t.evaluation_suggested }))} />
        </div>
        <div className="stack">
          <PsiHeatmap tel={tel} threshold={cfg.psi_threshold} />
          <p className="muted">Shifted features are flagged only when PSI exceeds the threshold <em>and</em> three times the
            sampling-noise floor (k-1)(1/n+1/m), so small batches do not raise false alarms.</p>
          <p>Unseen categories in the latest batch: {pct(last.unseen_category_rate)} · Schema issues:{" "}
            {cellText(last.schema_issues)}</p>
        </div>
        <div className="stack">
          <Chart title="Label availability" data={labelRows} x="end_row" height={260} series={[
            { key: "labels_revealed", name: "Labels revealed", color: SERIES.aqua, kind: "bar" },
            { key: "labels_pending", name: "Labels pending", color: SERIES.yellow, kind: "bar" },
          ]} />
          <p><strong>Reference window</strong> — active model {version(run.active_version)} trained on rows{" "}
            {model.train_start.toLocaleString("en-US")}–{model.train_end.toLocaleString("en-US")} (learned up to row{" "}
            {model.trained_until.toLocaleString("en-US")}; {model.n_train.toLocaleString("en-US")} rows). PSI bins are fixed
            from that window.</p>
          <div style={{ maxWidth: 360 }}>
            <QuerySelect name="feature" label="Inspect reference bins" value={feature} options={features.map((f) => [f, f])} />
          </div>
          <DataTable rows={binLabels.map((bin, i) => ({ bin, "reference count": spec.counts[i] }))} />
        </div>
      </Tabs>
      <div style={{ marginTop: 14 }}><ProcessControls run={run} /></div>
    </>
  );
}
