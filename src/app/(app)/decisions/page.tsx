import { CheckCircle, Scales, XCircle } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { EvaluateButton, StartDemoButton } from "@/components/actions";
import { BarChartMono } from "@/components/charts";
import { Reveal } from "@/components/motion";
import { Callout, DataTable, EmptyState, Explainer, KV, PageHeader, Section, SimLabel, Status, Tag, type Tone } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { ACTION_LABELS, ACTION_SHORT } from "@/lib/catalog";
import { fixed, money, num, pct, signed, when } from "@/lib/format";
import { v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getLatestDecision, getRequests, getSettings, getTelemetry, listDecisions } from "@/lib/queries";
import type { RankedAction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DecisionActions } from "./_components/decision-actions";
import { WhatIf } from "./_components/what-if";

export const metadata: Metadata = { title: "Decision analysis" };
export const dynamic = "force-dynamic";

function statusTone(s: string): Tone {
  if (s === "pending") return "info";
  if (s === "promoted" || s === "deferred") return "ok";
  if (s === "rejected" || s === "failed") return "bad";
  if (s === "stale" || s === "interrupted") return "warn";
  return "neutral";
}
function classTone(label: string | null | undefined): Tone {
  return label === "avoidable staleness" ? "bad" : label === "task harder for all models" ? "warn" : label === "no material staleness" ? "ok" : "neutral";
}
const pts = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${signed(x * 100, d)} pts`);

function Formula({ r, horizon, errorValue, factor, avoidable }: { r: RankedAction; horizon: number; errorValue: number; factor: number; avoidable: number }) {
  const ev = r.evidence;
  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium">{ACTION_LABELS[r.action]}</span>
        <Status tone={r.feasible ? "ok" : "bad"}>{r.feasible ? "feasible" : "blocked"}</Status>
      </div>
      {ev.compatible ? (
        <dl className="space-y-3 font-mono text-[12px] leading-relaxed">
          <div>
            <dt className="mb-0.5 font-sans text-[11.5px] text-muted-foreground">Estimated avoidable error reduction</dt>
            <dd>
              {r.basis === "avoidable" ? (
                <>
                  {signed(avoidable, 4)} <span className="text-muted-foreground">probe DiD</span> × {(r.recovery_ratio ?? 0).toFixed(2)} <span className="text-muted-foreground">recovery ratio</span> = <b>{signed(r.expected_reduction, 4)}</b>
                </>
              ) : (
                <>
                  {signed(ev.reduction, 4)} <span className="text-muted-foreground">hold-out</span> × {factor.toFixed(2)} <span className="text-muted-foreground">realisation</span> = <b>{signed(r.expected_reduction, 4)}</b>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="mb-0.5 font-sans text-[11.5px] text-muted-foreground">Expected benefit</dt>
            <dd>
              {signed(r.expected_reduction, 4)} × {num(horizon)} × {money(errorValue)} = <b>{money(r.benefit)}</b>
              <span className="block text-muted-foreground">
                95% range {money(r.benefit_ci[0])} to {money(r.benefit_ci[1])}
              </span>
            </dd>
          </div>
          <div>
            <dt className="mb-0.5 font-sans text-[11.5px] text-muted-foreground">Total cost</dt>
            <dd>
              {money(r.costs.compute)} compute + {money(r.costs.engineering)} engineering + {money(r.costs.validation)} validation + {money(r.costs.deployment_risk)} deployment risk + {money(r.costs.probe ?? 0)} probe = <b>{money(r.total_cost)}</b>
            </dd>
          </div>
          <div className="border-t border-border pt-2">
            <dt className="mb-0.5 font-sans text-[11.5px] text-muted-foreground">Net expected value</dt>
            <dd>
              {money(r.benefit)} − {money(r.total_cost)} = <b className={cn("text-[14px]", r.net_value < 0 && "text-bad")}>{money(r.net_value)}</b>
              <span className="ml-2 font-sans text-[11.5px] text-muted-foreground">P(net &gt; 0) = {r.prob_positive == null ? "—" : r.prob_positive.toFixed(2)}</span>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          No candidate was evaluated: {ev.reason ?? "not evaluated"}. Its cost would be {money(r.total_cost)}, so its net value is {money(r.net_value)}.
        </p>
      )}
    </div>
  );
}

export default async function DecisionsPage() {
  const ctx = await requirePage("/decisions");
  const ws = ctx.workspace.id;
  const [settings, run] = await Promise.all([getSettings(ws), getActiveRun(ws)]);
  const canOperate = can(ctx.role, "stream.operate");

  if (!run) {
    return (
      <Reveal>
        <PageHeader title="Decision analysis" description="Should the model be updated? Keep it, update it incrementally or retrain it fully, ranked by net expected value under guardrails." />
        <EmptyState icon={Scales} title="No active stream" action={canOperate ? <StartDemoButton regime={ctx.workspace.defaultRegime} /> : undefined} className="py-16">
          Decisions are made for the monitored stream. Start one in Data &amp; streams.
        </EmptyState>
      </Reveal>
    );
  }

  const [tel, d, history, requests] = await Promise.all([getTelemetry(ws, run.id), getLatestDecision(ws, run.id), listDecisions(ws, run.id, 15), getRequests(ws, "awaiting_approval")]);
  const last = tel.at(-1);
  const evaluate = canOperate && tel.length > 0 ? <EvaluateButton runId={run.id} variant={d?.status === "pending" ? "secondary" : "default"} /> : undefined;

  if (!d) {
    return (
      <Reveal>
        <PageHeader title="Decision analysis" description="No decision for this stream yet." actions={evaluate} />
        {last?.evaluation_suggested && (
          <Callout tone="warn" title="Monitoring suggests an evaluation" className="mb-8">
            {last.trigger_reasons.join("; ")}.
          </Callout>
        )}
        <EmptyState icon={Scales} title="Nothing evaluated yet" action={evaluate}>
          {tel.length
            ? `Evaluating trains candidates on past labelled rows and scores them on the newest rows. It needs at least ${settings.min_evidence} new labels since the last update (currently ${num(run.monitor.labels_since_update)}).`
            : "Process some batches first so monitoring can collect labels."}
        </EmptyState>
      </Reveal>
    );
  }

  const factor = d.context.realization?.factor ?? settings.realization_prior;
  const avoid = d.context.avoidable && d.context.avoidable.available ? d.context.avoidable : null;
  const renewal = d.context.renewal?.available ? d.context.renewal : null;
  const recovery = d.context.recovery;
  const updates = d.ranked.filter((r) => r.action !== "defer");
  const sorted = d.ranked.slice().sort((a, b) => a.rank - b.rank);
  const top = sorted[0];
  const pending = requests.find((r) => r.decision_id === d.id) ?? null;
  const flips = d.sensitivity.filter((s) => s.recommended !== d.recommended).length;

  return (
    <Reveal>
      <PageHeader
        title="Decision analysis"
        description={
          d.recommended === "defer"
            ? "No update clears every guardrail with a positive net value. Keeping the existing model is the lowest-cost option."
            : `${ACTION_LABELS[d.recommended]} is the highest-value feasible option at ${money(top.net_value)} net. Validation is required before promotion.`
        }
        actions={evaluate}
      />

      {d.status === "stale" && (
        <Callout tone="warn" title="This decision is stale" className="mb-8">
          The stream, model or settings changed after it was made. Evaluate again for a fresh one.
        </Callout>
      )}

      <div className="grid gap-x-12 gap-y-8 border-y border-border py-8 lg:grid-cols-[1.25fr_1fr]" data-reveal>
        <div>
          <div className="text-[12px] text-muted-foreground">Recommendation</div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <span className="font-serif text-[34px] leading-tight">{d.recommended === "defer" ? "Keep the existing model" : ACTION_LABELS[d.recommended]}</span>
            <Tag tone={statusTone(d.status)}>{d.status}</Tag>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-2">{d.justification}</p>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Decision <span className="font-mono">{d.id}</span> · {when(d.created)} · row {num(d.position)} · {v(d.version)} · requested by {d.requested_by}
          </p>
          {d.outcome && <p className="mt-2 text-[13px]">Outcome: {d.outcome}</p>}
        </div>
        <div>
          <div className="mb-3 grid grid-cols-3 gap-3 text-[12.5px]">
            {(["defer", "partial", "full"] as const).map((a) => {
              const r = d.ranked.find((x) => x.action === a);
              return (
                <div key={a} className={cn("border-l-2 pl-3", a === d.recommended ? "border-foreground" : "border-border")}>
                  <div className="text-muted-foreground">{ACTION_SHORT[a]}</div>
                  <div className="tabular text-[17px]">{money(r?.net_value ?? 0, 0)}</div>
                  <div className="text-[11.5px] text-muted-foreground">{a === "defer" ? "reference" : r?.feasible ? "feasible" : "blocked"}</div>
                </div>
              );
            })}
          </div>
          <p className="mb-5 text-[11.5px] text-muted-foreground">
            Net expected value · <SimLabel>simulated costs</SimLabel>
          </p>
          {d.status === "pending" ? (
            <DecisionActions
              decisionId={d.id}
              recommended={d.recommended}
              options={d.ranked.map((r) => ({ action: r.action, feasible: r.feasible, net: r.net_value, cost: r.total_cost }))}
              canRequest={can(ctx.role, "action.request")}
              canApprove={can(ctx.role, "action.approve")}
              requireSeparate={ctx.workspace.requireSeparateApprover}
              me={ctx.user.email}
              pending={pending ? { id: pending.id, action: pending.action, prepared_by: pending.prepared_by, rationale: pending.rationale } : null}
            />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              This decision is {d.status}. {d.status === "promoted" ? <Link href="/lifecycle" className="underline underline-offset-4">Track the outcome in Model lifecycle.</Link> : null}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-muted-foreground" data-reveal>
        <span>Triggers: {d.trigger_reasons.join("; ") || "manual"}</span>
        {d.evaluation.charged && d.evaluation.cost ? (
          <span>
            Shadow evaluation {money(d.evaluation.cost.total)} (spent) · {d.evaluation.plan?.window_basis} · hold-out rows {d.evaluation.plan?.holdout_interval?.map((x) => num(x)).join("–")}
          </span>
        ) : (
          <span className="text-warn">No candidates trained: {d.evaluation.note}. The conservative default is to keep the model.</span>
        )}
      </div>

      <div className="grid gap-x-12 lg:grid-cols-3">
        <Section title="Avoidable error">
          {avoid ? (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="tabular text-[26px]">{pts(avoid.did)}</span>
                <Status tone={classTone(avoid.classification)}>{avoid.classification}</Status>
              </div>
              <KV
                className="mt-3"
                items={[
                  ["95% interval", `${pts(avoid.ci[0])} to ${pts(avoid.ci[1])}`],
                  ["Gap now", `${pts(avoid.gap)} on ${num(avoid.n)} labels`],
                  ["Gap at deployment", pts(avoid.baseline_gap)],
                  ["Task-hardness shift", pts(avoid.task_hardness)],
                ]}
              />
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">No difference-in-differences estimate for {v(d.version)} yet. Benefits use the hold-out comparison instead.</p>
          )}
        </Section>
        <Section title="Renewal rule" action={<SimLabel />}>
          {renewal ? (
            <>
              <Status tone={renewal.due ? "bad" : "ok"}>{renewal.due ? "Update due: marginal ≥ average" : "Not yet due"}</Status>
              <KV
                className="mt-3"
                items={[
                  ["Marginal", `${money(renewal.marginal, 5)} / prediction`],
                  ["Cycle average", `${money(renewal.average, 5)} / prediction`],
                  ["Renewal cost", money(renewal.renewal_cost)],
                  ["Predictions this cycle", num(renewal.cycle_predictions)],
                ]}
              />
            </>
          ) : (
            <p className="text-[13px] text-muted-foreground">Not applied: it needs an avoidable-staleness estimate for the current model.</p>
          )}
        </Section>
        <Section title="Recovery ratios">
          <div className="space-y-3">
            {(["partial", "full"] as const).map((a) => {
              const r = recovery?.[a];
              return (
                <div key={a} className="border-b border-border pb-3 last:border-0">
                  <div className="flex items-center justify-between text-[13.5px]">
                    <span>{ACTION_LABELS[a]}</span>
                    <span className="tabular text-[17px]">{r ? r.ratio.toFixed(2) : "—"}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    {r
                      ? `${r.observations} measured update${r.observations === 1 ? "" : "s"} blended with prior ${(r.prior ?? (a === "full" ? settings.full_recovery_prior : settings.partial_recovery_prior)).toFixed(2)}`
                      : "prior only"}
                  </p>
                </div>
              );
            })}
          </div>
        </Section>
      </div>

      <Section
        title="How the numbers are computed"
        description="Expected benefit = estimated avoidable error reduction × horizon × error value. Total cost = compute + engineering + validation + deployment risk + probe evaluation. Net expected value = benefit − cost."
        action={<SimLabel>Assumed prices</SimLabel>}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          {updates.map((r) => (
            <Formula key={r.action} r={r} horizon={d.context.horizon} errorValue={settings.error_value} factor={factor} avoidable={avoid?.rate ?? 0} />
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          {avoid
            ? "With probe evidence, each action is credited with its learned share of the avoidable error. The hold-out comparison must not contradict it, and the validation gate re-checks before promotion."
            : `No probe estimate yet for this model, so the hold-out reduction is scaled by the realisation factor (${factor.toFixed(2)}).`}{" "}
          Keeping the existing model is the reference with zero incremental cost and benefit. Compute price multiplier ×{fixed(d.context.price_multiplier, 2)}.
        </p>
      </Section>

      <Section title="Ranked actions" description="Feasible actions rank above blocked ones, then by net expected value." action={<SimLabel />}>
        <DataTable
          caption="Ranked actions"
          rows={sorted}
          rowKey={(r) => r.action}
          columns={[
            { key: "rank", header: "#", cell: (r) => r.rank },
            { key: "a", header: "Action", cell: (r) => <span className={cn(r.action === d.recommended && "font-medium")}>{ACTION_LABELS[r.action]}</span> },
            { key: "f", header: "Feasible", cell: (r) => (r.feasible ? <CheckCircle className="size-4 text-ok" aria-label="feasible" /> : <XCircle className="size-4 text-bad" aria-label="blocked" />) },
            { key: "red", header: "Δ error", align: "right", cell: (r) => signed(r.expected_reduction, 4) },
            { key: "b", header: "Benefit", align: "right", cell: (r) => money(r.benefit) },
            { key: "ci", header: "95% range", align: "right", mobile: false, cell: (r) => `${money(r.benefit_ci[0], 0)} – ${money(r.benefit_ci[1], 0)}` },
            { key: "c", header: "Cost", align: "right", cell: (r) => money(r.total_cost) },
            { key: "n", header: "Net", align: "right", cell: (r) => <span className={cn("font-medium", r.net_value < 0 && "text-bad")}>{money(r.net_value)}</span> },
            { key: "p", header: "P(net > 0)", align: "right", cell: (r) => (r.prob_positive == null ? "—" : r.prob_positive.toFixed(2)) },
          ]}
        />
      </Section>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Cost by component" action={<SimLabel />}>
          <BarChartMono
            label="Itemised simulated cost per update action"
            data={updates.map((r) => ({
              action: ACTION_SHORT[r.action],
              compute: +r.costs.compute.toFixed(2),
              engineering: +r.costs.engineering.toFixed(2),
              validation: +r.costs.validation.toFixed(2),
              risk: +r.costs.deployment_risk.toFixed(2),
              probe: +(r.costs.probe ?? 0).toFixed(2),
            }))}
            xKey="action"
            stacked
            yFormat="money"
            height={240}
            bars={[
              { key: "compute", name: "Compute", tone: "primary" },
              { key: "engineering", name: "Engineering", tone: "quaternary" },
              { key: "validation", name: "Validation", tone: "secondary" },
              { key: "risk", name: "Deployment risk", tone: "tertiary" },
              { key: "probe", name: "Probe", tone: "warn" },
            ]}
          />
        </Section>
        <Section title="Guardrails" description="Every guardrail must pass for an update to be feasible. They are checked again just before execution.">
          <div className="space-y-5">
            {updates.map((r) => (
              <div key={r.action}>
                <div className="mb-2 text-[13.5px] font-medium">{ACTION_LABELS[r.action]}</div>
                <ul className="space-y-1.5">
                  {r.guardrails.map((g) => (
                    <li key={g.name} className="flex items-start gap-2 text-[13px]">
                      {g.passed ? <CheckCircle className="mt-0.5 size-4 shrink-0 text-ok" aria-label="passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-label="failed" />}
                      <span>
                        {g.name} <span className="text-muted-foreground">· {g.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title="Chronological hold-out evidence" description="Candidates were trained only on rows before the hold-out; candidates and the current model were scored on the same hold-out rows.">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Hold-out evidence</caption>
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Measure</th>
                {updates.map((r) => (
                  <th key={r.action} className="py-2 pr-3 text-right font-medium">
                    {ACTION_SHORT[r.action]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Hold-out labels", (r: RankedAction) => num(r.evidence.n)],
                  ["Hold-out rows", (r: RankedAction) => r.evidence.holdout_interval?.map((x) => num(x)).join("–") ?? "—"],
                  ["Training rows", (r: RankedAction) => num(r.evidence.train_rows)],
                  ["Current model error", (r: RankedAction) => pct(r.evidence.incumbent_error, 2)],
                  ["Candidate error", (r: RankedAction) => pct(r.evidence.candidate_error, 2)],
                  ["Error reduction", (r: RankedAction) => signed(r.evidence.reduction, 4)],
                  ["95% CI of reduction", (r: RankedAction) => (r.evidence.reduction_ci ? `${signed(r.evidence.reduction_ci[0], 3)} to ${signed(r.evidence.reduction_ci[1], 3)}` : "—")],
                  ["Current macro-F1", (r: RankedAction) => fixed(r.evidence.incumbent_f1, 3)],
                  ["Candidate macro-F1", (r: RankedAction) => fixed(r.evidence.candidate_f1, 3)],
                  ["Rows predicted differently", (r: RankedAction) => num(r.evidence.discordant)],
                  ["Fit time", (r: RankedAction) => (r.evidence.fit_seconds != null ? `${r.evidence.fit_seconds.toFixed(2)} s` : "—")],
                ] as const
              ).map(([label, f]) => (
                <tr key={label} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 text-muted-foreground">{label}</td>
                  {updates.map((r) => (
                    <td key={r.action} className="tabular py-1.5 pr-3 text-right">
                      {f(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Sensitivity" description={`The recommendation changes in ${flips} of ${d.sensitivity.length} one-at-a-time scenarios.`}>
          <DataTable
            caption="Sensitivity analysis"
            rows={d.sensitivity}
            rowKey={(s) => s.scenario}
            columns={[
              { key: "s", header: "Scenario", cell: (s) => s.scenario },
              { key: "r", header: "Recommended", cell: (s) => <Tag tone={s.recommended === d.recommended ? "neutral" : "warn"}>{ACTION_SHORT[s.recommended]}</Tag> },
              { key: "p", header: "Net partial", align: "right", cell: (s) => money(s.net_partial) },
              { key: "f", header: "Net full", align: "right", cell: (s) => money(s.net_full) },
            ]}
          />
        </Section>
        <Section title="What if" description="Re-rank the same stored evidence under other assumptions. Nothing is saved.">
          <WhatIf decisionId={d.id} regime={settings.regime} recommended={d.recommended} />
        </Section>
      </div>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Assumptions">
          <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
            {d.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Section>
        <Section title="Decision history">
          <DataTable
            caption="Decision history"
            rows={history}
            rowKey={(h) => h.id}
            columns={[
              { key: "id", header: "Decision", cell: (h) => <span className="font-mono">{h.id}</span> },
              { key: "row", header: "Row", align: "right", cell: (h) => num(h.position) },
              { key: "r", header: "Recommended", cell: (h) => ACTION_SHORT[h.recommended] },
              { key: "s", header: "Status", cell: (h) => <Tag tone={statusTone(h.status)}>{h.status}</Tag> },
            ]}
          />
        </Section>
      </div>

      <div className="mt-8">
        <Explainer title="Full decision record (JSON, as stored)">
          <pre className="max-h-[480px] overflow-auto rounded-md bg-subtle p-3 font-mono text-[11.5px]">{JSON.stringify(d, null, 2)}</pre>
        </Explainer>
      </div>
    </Reveal>
  );
}
