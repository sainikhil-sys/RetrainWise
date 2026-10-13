import { Calculator, CheckCircle2, ClipboardList, Microscope, Percent, RefreshCcw, Scale, ShieldCheck, SlidersHorizontal, XCircle } from "lucide-react";
import type { Metadata } from "next";

import { C } from "@/lib/palette";
import Link from "next/link";

import { BenefitCostChart, SimpleBars } from "@/components/charts";
import { EvaluateButton } from "@/components/run-controls";
import { classificationTone } from "@/components/staleness";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Explainer, KV, PageHeader, SimLabel, Table, Td, Th, cn } from "@/components/ui";
import { WhatIf } from "@/components/what-if";
import { ACTION_LABELS, ACTION_SHORT } from "@/lib/catalog";
import { decisionTone, fixed, money, num, pct, signed, version, when } from "@/lib/format";
import { getActiveRun, getLatestDecision, getSettings, getTelemetry, listDecisions } from "@/lib/queries";
import type { RankedAction } from "@/lib/types";

export const metadata: Metadata = { title: "Decision analysis" };
export const dynamic = "force-dynamic";

function Formula({ r, horizon, errorValue, factor, avoidable }: { r: RankedAction; horizon: number; errorValue: number; factor: number; avoidable: number }) {
  const ev = r.evidence;
  const available = !!ev.compatible;
  return (
    <div className={cn("rounded-xl border p-4", r.feasible ? "border-teal-400/40 bg-teal-400/[0.04]" : "border-slate-800 bg-slate-900/30")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-slate-100">{ACTION_LABELS[r.action]}</span>
        <Badge tone={r.feasible ? "good" : "bad"}>{r.feasible ? "feasible" : "blocked"}</Badge>
      </div>
      {available ? (
        <div className="space-y-3 font-mono text-[12.5px] leading-relaxed text-slate-300">
          <div>
            <div className="mb-0.5 font-sans text-xs uppercase tracking-wider text-slate-500">Estimated avoidable error reduction</div>
            {r.basis === "avoidable" ? (
              <>
                {signed(avoidable, 4)} <span className="text-slate-500">(probe DiD avoidable error)</span> × {(r.recovery_ratio ?? 0).toFixed(2)} <span className="text-slate-500">(learned recovery ratio)</span> = <span className="text-slate-100">{signed(r.expected_reduction, 4)}</span>
              </>
            ) : (
              <>
                {signed(ev.reduction, 4)} <span className="text-slate-500">(hold-out, no probe estimate yet)</span> × {factor.toFixed(2)} <span className="text-slate-500">(realisation)</span> = <span className="text-slate-100">{signed(r.expected_reduction, 4)}</span>
              </>
            )}
          </div>
          <div>
            <div className="mb-0.5 font-sans text-xs uppercase tracking-wider text-slate-500">Expected benefit</div>
            {signed(r.expected_reduction, 4)} × {num(horizon)} predictions × {money(errorValue)} = <span className="text-emerald-300">{money(r.benefit)}</span>
            <div className="text-slate-500">95% range {money(r.benefit_ci[0])} to {money(r.benefit_ci[1])}</div>
          </div>
          <div>
            <div className="mb-0.5 font-sans text-xs uppercase tracking-wider text-slate-500">Total action cost</div>
            {money(r.costs.compute)} compute + {money(r.costs.engineering)} engineering + {money(r.costs.validation)} validation + {money(r.costs.deployment_risk)} deployment risk + {money(r.costs.probe ?? 0)} probe evaluation = <span className="text-rose-300">{money(r.total_cost)}</span>
          </div>
          <div className="border-t border-slate-800 pt-2">
            <div className="mb-0.5 font-sans text-xs uppercase tracking-wider text-slate-500">Net expected value</div>
            {money(r.benefit)} − {money(r.total_cost)} = <span className={cn("text-base font-semibold", r.net_value > 0 ? "text-emerald-300" : "text-rose-300")}>{money(r.net_value)}</span>
            <span className="ml-2 font-sans text-xs text-slate-400">P(net &gt; 0) = {r.prob_positive == null ? "—" : r.prob_positive.toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          No candidate was evaluated: {ev.reason ?? "not evaluated"}. Its cost would be {money(r.total_cost)}, so its net value is {money(r.net_value)}.
        </p>
      )}
    </div>
  );
}

export default async function DecisionsPage() {
  const [settings, run] = await Promise.all([getSettings(), getActiveRun()]);
  if (!run) {
    return (
      <>
        <PageHeader eyebrow="Decision analysis" title="Should we update the model?" description="Shadow-evaluate update candidates, price them and rank full retraining, an incremental update or deferring." />
        <EmptyState icon={Scale} title="No active run" action={<Link href="/data" className="text-sm font-medium text-teal-300 hover:underline">Start a run →</Link>}>
          Decisions are made for the active stream.
        </EmptyState>
      </>
    );
  }
  const [tel, d, history] = await Promise.all([getTelemetry(run.id), getLatestDecision(run.id), listDecisions(run.id, 12)]);
  const last = tel.at(-1);

  const header = (
    <PageHeader
      eyebrow="Decision analysis"
      title="Should we update the model?"
      description="RetrainWise combines the probe model's estimate of avoidable staleness with candidates trained on past labelled rows only and scored on the newest labelled rows (a chronological hold-out). It prices keeping the model, a partial update and a full retrain, and ranks them by net expected value under hard guardrails, including the renewal rule."
      actions={<EvaluateButton runId={run.id} disabled={!tel.length} />}
    />
  );

  const trigger = last?.evaluation_suggested ? (
    <Alert tone="warn" title="Monitoring suggests an evaluation" className="mb-6">
      {last.trigger_reasons.join("; ")}.
    </Alert>
  ) : last ? (
    <Alert tone="neutral" className="mb-6">
      No automatic trigger right now ({last.trigger_reasons.join("; ") || "signals below thresholds"}). You can still evaluate manually; the overhead is charged once per stream position, model and settings.
    </Alert>
  ) : null;

  if (!d) {
    return (
      <>
        {header}
        {trigger}
        <EmptyState icon={Scale} title="No decision for this run yet">
          {tel.length ? `Click “Evaluate update options”. Candidates need at least ${settings.min_evidence} new labels since the last update (currently ${num(run.monitor.labels_since_update)}).` : "Process some batches first so monitoring can collect labels."}
        </EmptyState>
      </>
    );
  }

  const factor = d.context.realization?.factor ?? settings.realization_prior;
  const avoid = d.context.avoidable && d.context.avoidable.available ? d.context.avoidable : null;
  const renewal = d.context.renewal?.available ? d.context.renewal : null;
  const recovery = d.context.recovery;
  const updates = d.ranked.filter((r) => r.action !== "defer");
  const sorted = d.ranked.slice().sort((a, b) => a.rank - b.rank);
  const top = sorted[0];
  const stale = d.status === "stale";

  return (
    <>
      {header}
      {trigger}

      <Card className="mb-6 overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-3">
          <div className="border-b border-slate-800 bg-gradient-to-br from-teal-400/10 to-transparent p-6 lg:border-b-0 lg:border-r">
            <div className="text-xs font-semibold uppercase tracking-wider text-teal-300/80">Recommendation</div>
            <div className="mt-2 text-2xl font-semibold text-slate-50">{ACTION_LABELS[d.recommended]}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={decisionTone(d.status)}>{d.status}</Badge>
              <Badge tone="neutral">net {money(top.net_value)}</Badge>
              <SimLabel />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-400">
              Decision <span className="font-mono text-slate-300">{d.id}</span> · {when(d.created)} · row {num(d.position)} · model v{String(d.version).padStart(3, "0")} · requested by {d.requested_by}
            </p>
            {d.outcome && <p className="mt-2 text-sm text-slate-300">Outcome: {d.outcome}</p>}
            {d.status === "pending" && (
              <Link href="/lifecycle" className="mt-4 inline-flex h-9 items-center rounded-lg bg-teal-400 px-4 text-sm font-medium text-navy-950 hover:bg-teal-300">
                Review & approve in Model lifecycle →
              </Link>
            )}
            {stale && <p className="mt-3 text-xs text-amber-300">This decision is stale (the stream, model or settings changed). Evaluate again for a fresh one.</p>}
          </div>
          <div className="p-6 lg:col-span-2">
            <div className="text-sm font-medium text-slate-200">Why</div>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-300">{d.justification}</pre>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              <span>Triggers: {d.trigger_reasons.join("; ")}</span>
              {d.evaluation.charged && d.evaluation.cost ? (
                <span>
                  Shadow evaluation overhead: {money(d.evaluation.cost.total)} (already spent) · {d.evaluation.plan?.window_basis} · hold-out rows {d.evaluation.plan?.holdout_interval?.map((v) => num(v)).join("–")}
                </span>
              ) : (
                <span className="text-amber-300">No candidates trained: {d.evaluation.note}. The conservative default is to defer.</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Estimated avoidable error" icon={Microscope} info="Probe-model difference-in-differences: how much of the current error a refreshed model could remove, after subtracting the shift that affects every model." />
          <CardBody className="space-y-3">
            {avoid ? (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular text-slate-50">{signed(avoid.did * 100, 1)} pts</span>
                  <Badge tone={classificationTone(avoid.classification)}>{avoid.classification}</Badge>
                </div>
                <KV
                  className="sm:grid-cols-1"
                  items={[
                    ["95% interval", `${signed(avoid.ci[0] * 100, 1)} to ${signed(avoid.ci[1] * 100, 1)} pts`],
                    ["Gap now (deployed − probe)", `${signed(avoid.gap * 100, 1)} pts on ${num(avoid.n)} labels`],
                    ["Gap at deployment (baseline)", `${signed(avoid.baseline_gap * 100, 1)} pts`],
                    ["Task-hardness shift", `${signed(avoid.task_hardness * 100, 1)} pts`],
                    ["Deployed error change", `${signed(avoid.deployed_change * 100, 1)} pts`],
                  ]}
                />
              </>
            ) : (
              <p className="text-sm text-slate-400">No difference-in-differences estimate for model {version(d.version)} yet (baseline probes still being collected). Benefits use the hold-out comparison instead.</p>
            )}
            {d.probe_history && d.probe_history.length > 0 && (
              <p className="text-xs text-slate-500">
                Probe evidence: {d.probe_history.length} recent probe(s) of this version —{" "}
                {d.probe_history
                  .slice(0, 4)
                  .map((p) => `batch ${p.batch_index}: ${p.phase === "baseline" ? "baseline" : `DiD ${signed((p.did ?? 0) * 100, 1)} pts`}`)
                  .join(" · ")}
                . <Link href="/monitoring" className="text-teal-300 hover:underline">All probes →</Link>
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Renewal rule" icon={RefreshCcw} info="Treat each deployed model as a renewal cycle: act when the marginal avoidable-error cost of continuing reaches the running average cost of the cycle (renewal cost + avoidable cost so far, per prediction)." />
          <CardBody className="space-y-3">
            {renewal ? (
              <>
                <Badge tone={renewal.due ? "bad" : "good"} dot>
                  {renewal.due ? "Update due: marginal ≥ average" : "Not yet due: marginal < average"}
                </Badge>
                <KV
                  className="sm:grid-cols-1"
                  items={[
                    ["Marginal avoidable cost", `${money(renewal.marginal, 4)} / prediction`],
                    ["Running cycle average", `${money(renewal.average, 4)} / prediction`],
                    ["Renewal cost (cheapest update)", money(renewal.renewal_cost)],
                    ["Avoidable cost so far", money(renewal.cycle_avoidable_cost)],
                    ["Predictions in this cycle", num(renewal.cycle_predictions)],
                  ]}
                />
              </>
            ) : (
              <p className="text-sm text-slate-400">Not applied: it needs a difference-in-differences estimate for the current model version.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recovery-ratio assumptions" icon={Percent} info="Share of the avoidable error each action actually removed in past post-update measurements, shrunk toward a prior. Partial updates are cheaper but usually recover less." />
          <CardBody className="space-y-3">
            {(["partial", "full"] as const).map((a) => {
              const r = recovery?.[a];
              return (
                <div key={a} className="rounded-lg border border-slate-800 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-200">{ACTION_LABELS[a]}</span>
                    <span className="text-lg font-semibold tabular text-teal-200">{r ? r.ratio.toFixed(2) : "—"}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {r ? `${r.observations} measured update(s) blended with prior ${(r.prior ?? (a === "full" ? settings.full_recovery_prior : settings.partial_recovery_prior)).toFixed(2)} (weight ${settings.recovery_prior_weight})` : "not recorded for this decision"}
                    {r?.ratios && r.ratios.length > 0 && ` · observed: ${r.ratios.map((x) => x.toFixed(2)).join(", ")}`}
                  </p>
                </div>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="How the numbers are computed"
          icon={Calculator}
          description="Expected benefit = estimated avoidable error reduction × prediction horizon × value of avoiding one error. Total action cost = compute + engineering + validation + expected deployment-risk cost + probe evaluation cost. Net expected value = expected benefit − total action cost."
          action={<SimLabel kind="assumed" />}
        />
        <CardBody className="grid gap-4 lg:grid-cols-2">
          {updates.map((r) => (
            <Formula key={r.action} r={r} horizon={d.context.horizon} errorValue={settings.error_value} factor={factor} avoidable={avoid?.available ? avoid.rate : 0} />
          ))}
          <p className="text-xs leading-relaxed text-slate-500 lg:col-span-2">
            {avoid
              ? "With probe evidence, each action is credited with its learned share (recovery ratio) of the avoidable error. The hold-out comparison is still required not to contradict it, and the validation gate re-checks the candidate before promotion."
              : `No probe estimate yet for this model version, so the hold-out reduction is scaled by the realisation factor (${factor.toFixed(2)}).`}{" "}
            The probe line is one post-update verification probe. Keeping the existing model is the reference action with zero incremental cost and benefit. Compute price multiplier at decision time: ×{fixed(d.context.price_multiplier, 2)}.
          </p>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Ranked actions" icon={ClipboardList} description="Feasible actions rank above blocked ones, then by net expected value." action={<SimLabel />} />
        <CardBody>
          <Table caption="Ranked actions">
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Action</Th>
                <Th align="center">Feasible</Th>
                <Th align="right">Avoidable Δ error</Th>
                <Th align="right">Recovery</Th>
                <Th align="right">Expected benefit</Th>
                <Th align="right">95% interval</Th>
                <Th align="right">Compute</Th>
                <Th align="right">Engineering</Th>
                <Th align="right">Validation</Th>
                <Th align="right">Deploy risk</Th>
                <Th align="right">Probe</Th>
                <Th align="right">Total cost</Th>
                <Th align="right">Net value</Th>
                <Th align="right">P(net &gt; 0)</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.action} className={r.action === d.recommended ? "bg-teal-400/[0.05]" : undefined}>
                  <Td>{r.rank}</Td>
                  <Td className="font-medium text-slate-100">{ACTION_LABELS[r.action]}</Td>
                  <Td align="center">{r.feasible ? <CheckCircle2 className="mx-auto h-4 w-4 text-emerald-300" aria-label="feasible" /> : <XCircle className="mx-auto h-4 w-4 text-rose-300" aria-label="blocked" />}</Td>
                  <Td align="right">{signed(r.expected_reduction, 4)}</Td>
                  <Td align="right">{r.recovery_ratio != null ? r.recovery_ratio.toFixed(2) : r.action === "defer" ? "—" : "hold-out"}</Td>
                  <Td align="right">{money(r.benefit)}</Td>
                  <Td align="right" className="text-xs text-slate-400">
                    {money(r.benefit_ci[0], 0)} – {money(r.benefit_ci[1], 0)}
                  </Td>
                  <Td align="right">{money(r.costs.compute)}</Td>
                  <Td align="right">{money(r.costs.engineering)}</Td>
                  <Td align="right">{money(r.costs.validation)}</Td>
                  <Td align="right">{money(r.costs.deployment_risk)}</Td>
                  <Td align="right">{money(r.costs.probe ?? 0)}</Td>
                  <Td align="right">{money(r.total_cost)}</Td>
                  <Td align="right" className={cn("font-semibold", r.net_value > 0 ? "text-emerald-300" : r.net_value < 0 ? "text-rose-300" : "text-slate-200")}>
                    {money(r.net_value)}
                  </Td>
                  <Td align="right">{r.prob_positive == null ? "—" : r.prob_positive.toFixed(2)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Itemised cost per action" description="Stacked simulated cost components." action={<SimLabel />} />
          <CardBody>
            <SimpleBars
              data={updates.map((r) => ({ action: ACTION_SHORT[r.action], compute: +r.costs.compute.toFixed(2), engineering: +r.costs.engineering.toFixed(2), validation: +r.costs.validation.toFixed(2), risk: +r.costs.deployment_risk.toFixed(2), probe: +(r.costs.probe ?? 0).toFixed(2) }))}
              xKey="action"
              stacked
              money
              bars={[
                { key: "compute", name: "Compute", color: C.sky },
                { key: "engineering", name: "Engineering", color: C.violet },
                { key: "validation", name: "Validation", color: C.amber },
                { key: "risk", name: "Deployment risk", color: C.rose },
                { key: "probe", name: "Probe evaluation", color: C.teal },
              ]}
              label="Itemised simulated cost per action"
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Benefit (95% interval) vs cost" description="Whiskers show the uncertainty of the expected benefit from the paired hold-out comparison." />
          <CardBody>
            <BenefitCostChart
              data={updates.map((r) => ({ action: ACTION_SHORT[r.action], benefit: +r.benefit.toFixed(2), err: [+(r.benefit - r.benefit_ci[0]).toFixed(2), +(r.benefit_ci[1] - r.benefit).toFixed(2)] as [number, number], cost: +r.total_cost.toFixed(2), net: +r.net_value.toFixed(2) }))}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Guardrails" icon={ShieldCheck} description="Every guardrail must pass for an update to be feasible. They are checked again, with current spend, just before execution." />
          <CardBody className="space-y-5">
            {updates.map((r) => (
              <div key={r.action}>
                <div className="mb-2 text-sm font-medium text-slate-200">{ACTION_LABELS[r.action]}</div>
                <ul className="space-y-1.5">
                  {r.guardrails.map((g) => (
                    <li key={g.name} className="flex items-start gap-2 text-sm">
                      {g.passed ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-label="passed" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-label="failed" />}
                      <span className="text-slate-300">
                        {g.name} <span className="text-slate-500">— {g.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Evidence from the chronological hold-out" description="Candidates were trained only on rows before the hold-out. Both they and the current model were scored on the same hold-out rows." />
          <CardBody>
            <Table caption="Hold-out evidence">
              <thead>
                <tr>
                  <Th>Measure</Th>
                  {updates.map((r) => (
                    <Th key={r.action} align="right">
                      {ACTION_SHORT[r.action]}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Hold-out labels", (r: RankedAction) => num(r.evidence.n)],
                    ["Hold-out rows", (r: RankedAction) => r.evidence.holdout_interval?.map((v) => num(v)).join("–") ?? "—"],
                    ["Training rows", (r: RankedAction) => `${num(r.evidence.train_rows)}${r.evidence.train_interval ? ` (${r.evidence.train_interval.map((v) => num(v)).join("–")})` : ""}`],
                    ["Current model error", (r: RankedAction) => pct(r.evidence.incumbent_error, 2)],
                    ["Candidate error", (r: RankedAction) => pct(r.evidence.candidate_error, 2)],
                    ["Error reduction", (r: RankedAction) => signed(r.evidence.reduction, 4)],
                    ["95% CI of reduction", (r: RankedAction) => (r.evidence.reduction_ci ? `${signed(r.evidence.reduction_ci[0], 3)} to ${signed(r.evidence.reduction_ci[1], 3)}` : "—")],
                    ["Current macro-F1", (r: RankedAction) => fixed(r.evidence.incumbent_f1, 3)],
                    ["Candidate macro-F1", (r: RankedAction) => fixed(r.evidence.candidate_f1, 3)],
                    ["Rows predicted differently", (r: RankedAction) => num(r.evidence.discordant)],
                    ["Fit time", (r: RankedAction) => (r.evidence.fit_seconds != null ? `${r.evidence.fit_seconds.toFixed(2)} s` : "—")],
                    ["Status", (r: RankedAction) => (r.evidence.compatible ? "evaluated" : r.evidence.reason ?? "not evaluated")],
                  ] as const
                ).map(([label, f]) => (
                  <tr key={label}>
                    <Td className="text-slate-400">{label}</Td>
                    {updates.map((r) => (
                      <Td key={r.action} align="right" className="whitespace-normal">
                        {f(r)}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sensitivity analysis" icon={SlidersHorizontal} description="Recommended action when one assumption changes at a time (computed by the engine when the decision was made)." />
          <CardBody>
            <Table caption="Sensitivity analysis">
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th>Recommended</Th>
                  <Th align="right">Net incremental</Th>
                  <Th align="right">Net full</Th>
                </tr>
              </thead>
              <tbody>
                {d.sensitivity.map((s) => (
                  <tr key={s.scenario}>
                    <Td>{s.scenario}</Td>
                    <Td>
                      <Badge tone={s.recommended === d.recommended ? "neutral" : "warn"}>{ACTION_SHORT[s.recommended]}</Badge>
                    </Td>
                    <Td align="right">{money(s.net_partial)}</Td>
                    <Td align="right">{money(s.net_full)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="mt-3 text-xs text-slate-500">
              The recommendation changes in {d.sensitivity.filter((s) => s.recommended !== d.recommended).length} of {d.sensitivity.length} scenarios — a rough measure of how robust it is to the assumed prices and values.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="What-if explorer" description="Try other assumptions against the same stored evidence. Nothing is saved." />
          <CardBody>
            <WhatIf decisionId={d.id} regime={settings.regime} recommended={d.recommended} />
          </CardBody>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Assumptions" />
          <CardBody>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-300">
              {d.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Decision history (this run)" />
          <CardBody>
            <Table caption="Decision history">
              <thead>
                <tr>
                  <Th>Decision</Th>
                  <Th align="right">Row</Th>
                  <Th>Recommended</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <Td mono>{h.id}</Td>
                    <Td align="right">{num(h.position)}</Td>
                    <Td>{ACTION_SHORT[h.recommended]}</Td>
                    <Td>
                      <Badge tone={decisionTone(h.status)}>{h.status}</Badge>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <Explainer title="Full decision record (JSON, as stored in SQLite)">
        <pre className="max-h-[480px] overflow-auto rounded-lg bg-navy-950 p-3 font-mono text-xs text-slate-300">{JSON.stringify(d, null, 2)}</pre>
      </Explainer>
    </>
  );
}

