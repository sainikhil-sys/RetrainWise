import { ArrowRight, Pulse } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { EvaluateButton, ProcessBatchButton, StartDemoButton } from "@/components/actions";
import { LineChartMono, ChartLegend } from "@/components/charts";
import { AnimatedNumber, Reveal } from "@/components/motion";
import { EmptyState, MetricStrip, NextStep, PageHeader, Section, SimLabel, Status, Tag, Timeline } from "@/components/rw";
import { TipCallout } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/authz";
import { ENGINE_MODE } from "@/lib/engine";
import { ACTION_LABELS } from "@/lib/catalog";
import { ago, money, num, pct, signed } from "@/lib/format";
import { chartAnnotations, lifecycleStage, nextStep, riskLevel, stateSentence, timelineFromEvents, v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getAllModels, getEvents, getLabelSummary, getLatestDecision, getRegistry, getSettings, getTelemetry, listDecisions } from "@/lib/queries";
import { errorSeries } from "@/lib/series";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

const STAGES = [
  { label: "Detect", text: "Predictions, labels, drift, age, cost" },
  { label: "Evaluate", text: "Probe model and candidates" },
  { label: "Approve", text: "Value, uncertainty, guardrails" },
  { label: "Update", text: "Validate, then promote" },
  { label: "Monitor", text: "Track the outcome" },
];

export default async function OverviewPage() {
  const ctx = await requirePage("/overview");
  if (ENGINE_MODE === "missing") {
    return (
      <Reveal>
        <PageHeader title="Model health" description={`Welcome to ${ctx.workspace.name}.`} />
        <EmptyState icon={Pulse} title="The ML engine is not connected yet" className="py-16">
          Your account and workspace are ready. Monitoring, decisions, training and experiments start working as soon as the engine service is connected to this deployment. Meanwhile you can invite your team in Settings and complete your profile.
        </EmptyState>
      </Reveal>
    );
  }
  const ws = ctx.workspace.id;
  const [settings, run, models, events] = await Promise.all([getSettings(ws), getActiveRun(ws), getAllModels(ws), getEvents(ws, { limit: 10 })]);
  const [tel, decision, registry, decisions, labels] = run
    ? await Promise.all([getTelemetry(ws, run.id), getLatestDecision(ws, run.id), getRegistry(ws, run.id), listDecisions(ws, run.id, 10), getLabelSummary(ws, run.id)])
    : [[], null, [], [], null];
  const last = tel.at(-1);
  const canOperate = can(ctx.role, "stream.operate");
  const canApprove = can(ctx.role, "action.approve");
  const candidates = models.filter((m) => m.status === "candidate").length;
  const step = nextStep({ run, tel, decision, candidates, canOperate, canApprove });
  const risk = riskLevel(run, tel, settings);
  const stage = lifecycleStage(run, tel, decision);
  const active = registry.find((m) => m.version === run?.active_version);
  const budgetLeft = run ? Math.max(0, settings.budget - run.spent) : settings.budget;
  const st = last?.staleness;
  const timeline = timelineFromEvents(events);
  const lifecycleEvents = models.slice(0, 5);

  const stepAction =
    step.action === "batch" && run ? (
      <ProcessBatchButton runId={run.id} position={run.position} />
    ) : step.action === "evaluate" && run ? (
      <EvaluateButton runId={run.id} />
    ) : step.action === "start" ? (
      <StartDemoButton regime={ctx.workspace.defaultRegime} />
    ) : step.href ? (
      <Button asChild>
        <Link href={step.href}>
          Open <ArrowRight />
        </Link>
      </Button>
    ) : null;

  return (
    <Reveal>
      <PageHeader
        title="Model health"
        description={stateSentence(run, tel)}
        actions={
          run && canOperate ? (
            <>
              <ProcessBatchButton runId={run.id} position={run.position} variant="secondary" />
              <Button variant="secondary" asChild>
                <Link href="/decisions">View recommendation</Link>
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mb-8">
        <TipCallout id="shortcuts" title="Work from the keyboard" dismissed={ctx.user.dismissedTips.includes("shortcuts")}>
          Press ⌘K to search or run a command, B to process the next batch, E to evaluate update options, and ? for all shortcuts.
        </TipCallout>
      </div>

      {!run ? (
        <EmptyState
          icon={Pulse}
          title="No model is being monitored"
          action={canOperate ? <StartDemoButton regime={ctx.workspace.defaultRegime} /> : <span className="text-[13px] text-muted-foreground">Ask an operator to start a stream.</span>}
          className="py-16"
        >
          A demo stream replays synthetic data with known drift points, entirely on this computer. You can also choose a real dataset in Data &amp; streams.
        </EmptyState>
      ) : (
        <>
          <MetricStrip
            items={[
              {
                label: "Model version",
                value: v(run.active_version),
                sub: `${active?.action === "initial" ? "initial training" : active?.action === "partial" ? "partial update" : active?.action === "trained" ? "trained model" : "full retrain"} · ${run.dataset} · row ${num(run.position)} of ${num(run.n_rows)}`,
              },
              {
                label: "Rolling error",
                value: last?.rolling_error != null ? <AnimatedNumber value={last.rolling_error} format="pct" /> : "—",
                sub: last ? `${signed(last.degradation != null ? last.degradation * 100 : null, 1)} pts vs reference ${pct(last.reference_error)}` : "Process a batch to measure",
                tone: last?.predictive_signal ? "bad" : undefined,
                info: `Error over the last ${num(settings.rolling_window)} labelled predictions, measured prequentially (each batch is predicted before its labels are seen).`,
              },
              {
                label: "Staleness estimate",
                value: st?.available ? <AnimatedNumber value={st.did ?? 0} format="pts" /> : "—",
                sub: st?.available ? `${st.classification} · 95% CI ${signed((st.ci?.[0] ?? 0) * 100, 1)} to ${signed((st.ci?.[1] ?? 0) * 100, 1)}` : "Waiting for the first probe",
                tone: st?.available ? (st.classification === "avoidable staleness" ? "bad" : st.classification === "task harder for all models" ? "warn" : "ok") : undefined,
                info: "Counterfactual estimate: how many more errors the deployed model makes than a fresh probe model on the same rows, compared with the gap at deployment (difference-in-differences).",
              },
              {
                label: "Budget remaining",
                value: <AnimatedNumber value={budgetLeft} format="money0" />,
                sub: (
                  <>
                    {money(run.spent)} spent of {money(settings.budget, 0)} · <SimLabel />
                  </>
                ),
                tone: run.spent / Math.max(settings.budget, 1) > 0.85 ? "bad" : undefined,
              },
            ]}
          />

          <Section
            title="Performance over the stream"
            description="Rolling error with its 95% interval (shaded), per-batch error in gray, and the reference error. Lines mark model changes, drift alarms and decisions."
            action={<ChartLegend items={[{ label: "Rolling error", tone: "primary" }, { label: "Batch error", tone: "tertiary" }, { label: "Reference", tone: "secondary", dashed: true }, { label: "95% interval", tone: "tertiary", band: true }]} />}
          >
            {tel.length ? (
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
            ) : (
              <EmptyState title="No batches yet" action={canOperate && <ProcessBatchButton runId={run.id} position={run.position} />}>
                Process the first batch: the model predicts it, labels are revealed, and the monitors update.
              </EmptyState>
            )}
            {last && (
              <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[12.5px]">
                {[
                  ["Accuracy (rolling)", pct(last.rolling_error != null ? 1 - last.rolling_error : null)],
                  ["Macro F1 (last batch)", last.batch_f1 != null ? last.batch_f1.toFixed(3) : "—"],
                  ["Max PSI", last.max_psi != null ? `${last.max_psi.toFixed(3)} on ${last.max_psi_feature}` : "—"],
                  ["Model age", `${run.batch_index - run.last_update_batch} batches`],
                  ["Labelled samples", labels ? `${num(labels.revealed)} revealed · ${num(labels.available - labels.revealed)} pending` : "—"],
                ].map(([k, val]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="tabular font-medium">{val}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <div className="grid gap-x-12 lg:grid-cols-[1.25fr_1fr]">
            <Section title="Current recommendation" action={decision && <Link href="/decisions" className="text-[13px] underline decoration-border underline-offset-4 hover:decoration-foreground">Decision details</Link>}>
              <div className="rounded-lg border border-border p-5">
                {decision ? (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="font-serif text-[26px] leading-tight">{decision.recommended === "defer" ? "No action recommended" : ACTION_LABELS[decision.recommended]}</span>
                      <Tag tone={decision.status === "pending" ? "info" : decision.status === "promoted" || decision.status === "deferred" ? "ok" : decision.status === "rejected" || decision.status === "failed" ? "bad" : "neutral"}>{decision.status}</Tag>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">
                      {decision.recommended === "defer"
                        ? "No update clears every guardrail with a positive net value, so keeping the current model is the lowest-cost option."
                        : `Net expected value ${money(decision.ranked[0]?.net_value)} at ${(decision.ranked[0]?.prob_positive ?? 0).toFixed(2)} confidence. Validation is required before promotion.`}
                    </p>
                    <div className="mt-4 grid grid-cols-3 border-t border-border pt-4 text-[12.5px]">
                      {(["defer", "partial", "full"] as const).map((a) => {
                        const r = decision.ranked.find((x) => x.action === a);
                        return (
                          <div key={a} className={cn("pr-3", a === decision.recommended && "font-medium")}>
                            <div className="text-muted-foreground">{a === "defer" ? "Keep" : a === "partial" ? "Partial" : "Full"}</div>
                            <div className="mt-0.5 tabular text-[15px]">{money(r?.net_value ?? 0, 0)}</div>
                            <div className="text-[11.5px] text-muted-foreground">{r?.feasible ? "feasible" : "blocked"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-3 text-[11.5px] text-muted-foreground">
                      Decision {decision.id} · {ago(decision.created)} · <SimLabel>net values use simulated costs</SimLabel>
                    </p>
                  </>
                ) : (
                  <p className="text-[13.5px] text-muted-foreground">No decision yet. Evaluate update options once enough labels have arrived (at least {settings.min_evidence}).</p>
                )}
                <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                  <span className="text-[12.5px] text-muted-foreground">Risk of keeping the current model</span>
                  <Status tone={risk.tone}>{risk.label}</Status>
                </div>
                <p className="mt-1 text-right text-[12px] text-muted-foreground">{risk.reason}</p>
              </div>
            </Section>

            <Section title="Lifecycle">
              <ol className="space-y-0 border-l border-border" aria-label="Lifecycle stage">
                {STAGES.map((s, i) => (
                  <li key={s.label} aria-current={i === stage ? "step" : undefined} className={cn("relative py-2 pl-5", i === stage ? "text-foreground" : "text-muted-foreground")}>
                    <span aria-hidden className={cn("absolute -left-[4.5px] top-[14px] size-2 rounded-full border", i === stage ? "border-foreground bg-foreground" : i < stage ? "border-foreground bg-white" : "border-border bg-white")} />
                    <span className={cn("text-[13.5px]", i === stage && "font-medium")}>{s.label}</span>
                    <span className="ml-2 text-[12px]">{s.text}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-6 space-y-2 text-[12.5px]">
                {lifecycleEvents.map((m) => (
                  <Link key={m.version} href={`/models/${m.version}`} className="flex items-center justify-between gap-3 border-b border-border py-1.5 hover:text-foreground">
                    <span className="font-mono text-[12px]">{v(m.version)}</span>
                    <span className="flex-1 truncate text-muted-foreground">{m.action === "trained" ? "trained" : m.action}</span>
                    <Tag tone={m.status === "active" ? "info" : m.status === "rejected" ? "bad" : m.status === "candidate" ? "warn" : "neutral"}>{m.status.replace("_", " ")}</Tag>
                  </Link>
                ))}
              </div>
            </Section>
          </div>
        </>
      )}

      <div className="pt-10">
        <NextStep title={step.title} action={stepAction}>
          {step.text}
        </NextStep>
      </div>

      <Section title="Recent activity" description="Every action is written to the engine's append-only audit log." action={<Link href="/audit" className="text-[13px] underline decoration-border underline-offset-4 hover:decoration-foreground">Full audit trail</Link>}>
        <Timeline items={timeline.map((t) => ({ id: t.id, title: t.title, tone: t.tone, tag: t.tag, when: ago(t.created), meta: t.actor }))} />
      </Section>
    </Reveal>
  );
}
