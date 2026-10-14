import { Chart } from "@/components/charts";
import { SERIES } from "@/lib/palette";
import { ActionForm, Submit } from "@/components/client";
import { ProcessControls } from "@/components/controls";
import { Badge, DataTable, Header, Metric } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { decisionTone, int, money, num, pct, statusTone, version } from "@/lib/format";
import { lifecycle } from "@/lib/lifecycle";
import { startDemoAction } from "./actions";

export default async function Overview() {
  await requireUser();
  const life = lifecycle();
  const cfg = life.settings();
  const run = life.activeRun();
  if (!run) {
    return (
      <>
        <Header title="Overview" subtitle="Model health, spending and the latest recommendation for the active stream." />
        <div className="hero">
          <h2>Update only when the evidence pays for it</h2>
          <p>RetrainWise monitors a deployed model, estimates how much accuracy an update would recover, prices the action,
            and recommends full retraining, a partial update or deferring — with approval, validation and an audit trail.</p>
          <ActionForm action={startDemoAction}>
            <Submit pendingText="Generating the synthetic stream and training the initial model…">
              🚀 Start offline demo (synthetic drift stream)
            </Submit>
          </ActionForm>
        </div>
      </>
    );
  }
  const tel = life.telemetry(run.id);
  const last = tel.at(-1);
  const labels = life.labelSummary(run.id);
  const d = life.latestDecision(run.id);
  const changes = tel.filter((t, i) => i > 0 && t.version !== tel[i - 1].version).map((t) => t.start_row as number);
  const events = life.db.all("SELECT created, kind, actor, payload FROM events ORDER BY id DESC LIMIT 10");
  return (
    <>
      <Header title="Overview" subtitle="Model health, spending and the latest recommendation for the active stream." />
      <div className="grid metrics">
        <Metric label="Active model" value={version(run.active_version)} sub={last ? `age ${last.model_age_batches} batches` : undefined} />
        <Metric label="Rolling error" value={pct(last?.rolling_error)}
          sub={typeof last?.degradation === "number" ? `${(100 * last.degradation).toFixed(1)} pts vs reference` : undefined} />
        <Metric label="Learning debt" value={money(last?.learning_debt_cost)}
          sub={last ? `${int(last.learning_debt)} excess errors` : undefined} />
        <Metric label="Modeled spend" value={money(run.spent)} sub={`of ${money(cfg.budget)} budget`} />
        <Metric label="Max PSI" value={num(last?.max_psi)} sub={last?.max_psi_feature ?? undefined} />
        <Metric label="Labels revealed" value={int(labels.revealed)} sub={`${int(labels.available - labels.revealed)} pending`} />
      </div>
      <div className="grid split" style={{ marginTop: 14 }}>
        <div>
          {tel.length ? (
            <Chart title="Observed error (dashed green = model version change)" x="end_row"
              data={tel.map((t) => ({ end_row: t.end_row, batch_error: t.batch_error, rolling_error: t.rolling_error,
                reference_error: t.reference_error }))} verticalLines={changes}
              series={[
                { key: "batch_error", name: "Batch error (revealed labels)", color: SERIES.blue },
                { key: "rolling_error", name: "Rolling error", color: SERIES.orange },
                { key: "reference_error", name: "Reference error", color: SERIES.grey, dashed: true },
              ]} />
          ) : <div className="alert info">Process a batch to start collecting monitoring evidence.</div>}
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Monitoring status</h3>
          {last ? (
            <>
              <div><Badge tone={statusTone(last.status)}>{last.status}</Badge></div>
              {last.evaluation_suggested ? <p><strong>Evaluation suggested:</strong> {last.trigger_reasons.join("; ")}</p>
                : <p className="muted">No evaluation trigger: {last.trigger_reasons?.length ? last.trigger_reasons.join("; ")
                  : "signals below thresholds"}</p>}
            </>
          ) : <p className="muted">No batches yet.</p>}
          <h3 style={{ margin: "8px 0 0" }}>Latest recommendation</h3>
          {d ? (
            <>
              <div className="row"><strong>{d.ranked[0].label}</strong> · net {money(d.ranked[0].net_value)}
                <Badge tone={decisionTone(d.status)}>{d.status}</Badge></div>
              <p className="muted">Decision <code>{d.id}</code> at row {int(d.position)} · {d.outcome ?? ""}</p>
            </>
          ) : <p className="muted">No decision yet — evaluate options in Decision analysis.</p>}
          <ProcessControls run={run} />
        </div>
      </div>
      <h2>Recent activity</h2>
      <DataTable rows={events} />
    </>
  );
}
