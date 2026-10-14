import { Chart } from "@/components/charts";
import { SERIES } from "@/lib/palette";
import { ActionForm, Submit } from "@/components/client";
import { Alert, Badge, DataTable, Header, Json } from "@/components/ui";
import { WhatIf } from "@/components/whatif";
import { requireUser } from "@/lib/auth/session";
import { cellText, decisionTone, money, num, version } from "@/lib/format";
import { lifecycle } from "@/lib/lifecycle";
import type { Evidence } from "@/lib/ml/models";
import { evaluateAction } from "../actions";

export default async function DecisionPage() {
  await requireUser();
  const life = lifecycle();
  const cfg = life.settings();
  const run = life.activeRun();
  const header = <Header title="Decision analysis" subtitle="Shadow-evaluate update candidates, price them, and rank defer / partial / full." />;
  if (!run) return <>{header}<Alert>Start a run in <strong>Data and simulation</strong> first.</Alert></>;
  const tel = life.telemetry(run.id);
  const last = tel.at(-1);
  const d = life.latestDecision(run.id);
  const acts = d ? d.ranked.filter((r) => r.action !== "defer") : [];
  return (
    <>
      {header}
      {last?.evaluation_suggested ? <Alert>Monitoring suggests an evaluation: {last.trigger_reasons.join("; ")}</Alert> : null}
      <ActionForm action={evaluateAction} className="row">
        <Submit disabled={!tel.length} pendingText="Training full and partial candidates and scoring them on a chronological hold-out…">
          ⚖ Evaluate update options
        </Submit>
        <span className="muted">Evaluation is charged once per (stream position, model, settings); repeated clicks reuse the
          stored decision. Candidates are trained only on rows before the hold-out.</span>
      </ActionForm>
      {!tel.length ? <p className="muted">Process at least one batch first.</p> : null}
      {!d ? <Alert>No decision for this run yet.</Alert> : (
        <>
          <h2 className="row">Recommendation: {d.ranked[0].label} <Badge tone={decisionTone(d.status)}>{d.status}</Badge></h2>
          <p className="muted">Decision <code>{d.id}</code> · row {d.position.toLocaleString("en-US")} · model {version(d.version)} ·
            triggers: {d.trigger_reasons.join("; ")}</p>
          {d.evaluation.charged ? (
            <p className="muted">Shadow evaluation overhead charged: {money(d.evaluation.cost?.total)} · plan:{" "}
              {String(d.evaluation.plan?.window_basis ?? "")}, hold-out rows {cellText(d.evaluation.plan?.holdout_interval)}</p>
          ) : <Alert tone="warn">No candidates evaluated: {d.evaluation.note}. Conservative default is to defer.</Alert>}
          <pre>{d.justification}</pre>
          <DataTable rows={d.ranked.map((r) => ({ rank: r.rank, action: r.label, feasible: r.feasible ? "✔" : "✖",
            "total cost": money(r.total_cost), "expected error reduction": num(r.expected_reduction, 4),
            "expected benefit": money(r.benefit), "benefit 95% low": money(r.benefit_ci[0]),
            "benefit 95% high": money(r.benefit_ci[1]), "net expected value": money(r.net_value),
            "P(net > 0)": num(r.prob_positive, 2) }))} />
          <div className="grid two" style={{ marginTop: 14 }}>
            <Chart title="Itemised simulated cost per action" x="action" money data={acts.map((r) => ({ action: r.label, ...r.costs }))}
              series={[
                { key: "compute", name: "compute", color: SERIES.blue, kind: "bar", stack: "c" },
                { key: "engineering", name: "engineering", color: SERIES.orange, kind: "bar", stack: "c" },
                { key: "validation", name: "validation", color: SERIES.aqua, kind: "bar", stack: "c" },
                { key: "deployment_risk", name: "deployment risk", color: SERIES.yellow, kind: "bar", stack: "c" },
              ]} />
            <Chart title="Benefit (95% interval) vs cost" x="action" money data={acts.map((r) => ({ action: r.label,
              benefit: r.benefit, ci: [r.benefit - r.benefit_ci[0], r.benefit_ci[1] - r.benefit], cost: r.total_cost }))}
              series={[
                { key: "benefit", name: "Expected benefit", color: SERIES.green, kind: "bar", errorKey: "ci" },
                { key: "cost", name: "Total cost", color: SERIES.red, kind: "bar" },
              ]} />
          </div>
          <h2>Guardrails</h2>
          <DataTable rows={d.ranked.flatMap((r) => r.guardrails.map((g) => ({ action: r.label, guardrail: g.name,
            result: g.passed ? "✔ pass" : "✖ fail", detail: g.detail })))} />
          <h2>Evidence</h2>
          <DataTable rows={acts.map((r) => {
            const ev = r.evidence as Evidence;
            return { action: r.label, compatible: ev.compatible, n: ev.n, train_rows: ev.train_rows,
              incumbent_error: ev.incumbent_error, candidate_error: ev.candidate_error, reduction: ev.reduction,
              reduction_ci: ev.reduction_ci?.map((v) => Number(v.toFixed(4))), incumbent_f1: ev.incumbent_f1,
              candidate_f1: ev.candidate_f1, fit_seconds: ev.fit_seconds, reason: ev.reason };
          })} />
          <h2>Sensitivity to assumptions</h2>
          <DataTable rows={d.sensitivity.map((s) => ({ scenario: s.scenario, recommended: s.recommended,
            net_partial: money(s.net_partial), net_full: money(s.net_full) }))} />
          <details>
            <summary>What-if explorer (informational — does not change stored decisions)</summary>
            <WhatIf decisionId={d.id} regime={cfg.regime} />
          </details>
          <details>
            <summary>Assumptions</summary>
            <ul>{d.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
          <details>
            <summary>Full decision record (JSON)</summary>
            <Json value={d} />
          </details>
        </>
      )}
    </>
  );
}
