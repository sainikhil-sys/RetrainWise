import { FlaskRound, Microscope, RefreshCcw, Scale3d } from "lucide-react";

import { money, num, pct, signed, version } from "@/lib/format";
import { probeSeries, renewalSeries } from "@/lib/series";
import type { ProbeRow, Settings, Telemetry } from "@/lib/types";
import { DidChart, ProbeErrorChart, RenewalChart } from "./charts";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Explainer, ProgressBar, SimLabel, StatCard, Table, Td, Th } from "./ui";

export function classificationTone(label: string | null | undefined) {
  if (label === "avoidable staleness") return "bad" as const;
  if (label === "task harder for all models") return "warn" as const;
  if (label === "no material staleness") return "good" as const;
  return "neutral" as const;
}

const pts = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${signed(v * 100, d)} pts`);

/** Counterfactual staleness: probe model vs deployed model, difference-in-differences, renewal rule. */
export function StalenessPanel({ probes, tel, settings, activeVersion, monitoringSpent }: { probes: ProbeRow[]; tel: Telemetry[]; settings: Settings; activeVersion: number | null; monitoringSpent: number }) {
  const last = tel.at(-1);
  const st = last?.staleness;
  const renewal = last?.renewal;
  const current = probes.filter((p) => p.version === activeVersion);
  const estimates = probes.filter((p) => p.phase === "estimate");
  if (!probes.length) {
    return (
      <EmptyState icon={Microscope} title="No probes yet">
        The first probe runs as soon as enough new labels arrive ({settings.probe_min_labels} per probe). The normal gap between a fresh deployed model and the cheaper probe is measured at deployment on the model&apos;s own validation hold-out (or, if that is impossible, by the first {settings.probe_baseline_probes} probes); later probes estimate avoidable staleness.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Avoidable staleness"
          icon={Microscope}
          value={st?.available ? pts(st.did) : "—"}
          tone={st?.available ? classificationTone(st.classification) : "neutral"}
          sub={st?.available && st.ci ? <>95% CI {pts(st.ci[0])} to {pts(st.ci[1])} · <span className="text-slate-300">{st.classification}</span></> : `building baseline (${st?.baseline_probes ?? 0}/${settings.probe_baseline_probes} probes for ${version(activeVersion)})`}
          info="Difference-in-differences: (deployed − probe error now) − (deployed − probe error just after deployment). The error a refreshed model could remove."
        />
        <StatCard label="Task-hardness shift" icon={Scale3d} value={st?.available ? pts(st.task_hardness) : "—"} sub="change in the fresh probe's own error since deployment — affects every model, not avoidable" info="If the probe also gets worse, the task itself got harder (noisier labels, harder inputs). Retraining cannot remove that part." tone={st?.available && (st.task_hardness ?? 0) > 0.02 ? "warn" : "neutral"} />
        <StatCard
          label="Renewal rule"
          icon={RefreshCcw}
          value={renewal?.available ? (renewal.due ? "Update due" : "Not yet due") : "—"}
          tone={renewal?.available ? (renewal.due ? "bad" : "good") : "neutral"}
          sub={renewal?.available ? <>marginal {money(renewal.marginal, 4)} vs average {money(renewal.average, 4)} per prediction</> : "needs a difference-in-differences estimate"}
          info="Renewal-reward rule: end the model cycle when the avoidable error cost of continuing (per prediction) reaches the running average cost of the cycle, including the cost of renewing."
        />
        <StatCard
          label="Probe spend"
          icon={FlaskRound}
          value={money(monitoringSpent)}
          sub={`${probes.length} probes this run · budget ${money(settings.monitoring_budget, 0)}`}
          footer={<ProgressBar value={settings.monitoring_budget ? monitoringSpent / settings.monitoring_budget : 1} showValue={false} className="w-24" tone={monitoringSpent > settings.monitoring_budget * 0.85 ? "bad" : "accent"} />}
          simulated
          info={settings.probe_mode === "adaptive" ? "Adaptive scheduling: probe when the value of information exceeds the probe cost, within the min/max intervals and the monitoring budget." : `Fixed scheduling: one probe every ${settings.probe_every} batch(es).`}
        />
      </div>

      {st?.baseline && (
        <p className="text-xs text-slate-500">
          Baseline gap for {version(activeVersion)}: {pts(st.baseline.gap)} (deployed − probe) on {num(st.baseline.n)} labels, measured from {st.baseline.source ?? "post-deployment probes"}.
        </p>
      )}

      {st?.available && st.classification === "task harder for all models" && (
        <Alert tone="warn" title="The task got harder, but the model is not (avoidably) stale">
          Both the deployed model and a freshly trained probe got worse by a similar amount. Retraining is unlikely to recover much of this error, so the avoidable-staleness estimate stays low.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Deployed vs fresh probe model" description="Both scored on the same newly labelled rows (predicted by the current version). The probe is trained only on earlier rows." />
          <CardBody>
            <ProbeErrorChart data={probeSeries(probes)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Difference-in-differences staleness" description="Above zero (with the band clear of zero) = avoidable staleness. The dashed line shows how much harder the task got for a fresh model." />
          <CardBody>
            {estimates.length ? <DidChart data={probeSeries(probes)} /> : <p className="py-10 text-center text-sm text-slate-400">Estimates start after the baseline probes.</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Renewal rule over time" description="Act when the marginal (red) reaches the running average (blue). Early in a cycle the average is dominated by the cost of renewing, so updates are rarely due." action={<SimLabel />} />
        <CardBody>
          <RenewalChart data={renewalSeries(tel)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Probe log" description="Every probe is stored in SQLite with why it ran, its cost and its result. Current model version first." action={<SimLabel />} />
        <CardBody>
          <Table caption="Probe log">
            <thead>
              <tr>
                <Th>Batch</Th>
                <Th>Model</Th>
                <Th>Phase</Th>
                <Th align="right">Labels</Th>
                <Th align="right">Deployed err.</Th>
                <Th align="right">Probe err.</Th>
                <Th align="right">Gap</Th>
                <Th align="right">DiD</Th>
                <Th>Verdict</Th>
                <Th align="right">VOI</Th>
                <Th align="right">Cost</Th>
                <Th>Why it ran</Th>
              </tr>
            </thead>
            <tbody>
              {[...current.slice().reverse(), ...probes.filter((p) => p.version !== activeVersion).reverse()].slice(0, 30).map((p) => (
                <tr key={p.id}>
                  <Td>{p.batch_index}</Td>
                  <Td>{version(p.version)}</Td>
                  <Td>
                    <Badge tone={p.phase === "baseline" ? "info" : "neutral"}>{p.phase}</Badge>
                  </Td>
                  <Td align="right">{num(p.n)}</Td>
                  <Td align="right">{pct(p.deployed_error)}</Td>
                  <Td align="right">{pct(p.probe_error)}</Td>
                  <Td align="right">{pts(p.gap)}</Td>
                  <Td align="right">{p.did == null ? "—" : `${pts(p.did)} ± ${((p.did_se ?? 0) * 196).toFixed(1)}`}</Td>
                  <Td>{p.classification ? <Badge tone={classificationTone(p.classification)}>{p.classification}</Badge> : <span className="text-xs text-slate-500">baseline</span>}</Td>
                  <Td align="right">{p.voi == null ? "—" : money(p.voi)}</Td>
                  <Td align="right">{money(p.cost)}</Td>
                  <Td className="max-w-72 whitespace-normal text-xs text-slate-400">{p.reason}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {last?.probe && !last.probe.ran && <p className="mt-3 text-xs text-slate-500">Latest batch: no probe — {last.probe.reason}.</p>}
        </CardBody>
      </Card>

      <Explainer title="Why a probe model and difference-in-differences?">
        <p>A rising error does not prove the model is stale: sometimes the task simply gets harder for every model. A cheap probe trained on the most recent labels is a counterfactual — “what would a fresh model do here?”</p>
        <p>The probe is weaker than a full model, so right after deployment there is a normal gap between them (the baseline). If that gap later grows, the deployed model has fallen behind in a way a refresh could fix: that growth is the avoidable staleness. If both get worse together, the gap stays put and the extra error is attributed to task hardness.</p>
        <p>Limitations: the probe is itself noisy (a 95% interval is shown), assumes the baseline gap would have stayed constant without staleness, and needs labels — with long label delays the estimate lags behind the stream.</p>
      </Explainer>
    </div>
  );
}
