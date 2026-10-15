"use client";

import { DownloadSimple, Play } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";

import { ChartLegend, LineChartMono, ScatterMono, type SeriesTone } from "@/components/charts";
import { Callout, SimLabel, Status, Tag, type Tone } from "@/components/rw";
import { Spinner, api, useAction, useAutoRefresh } from "@/components/rw-client";
import { CancelJobButton } from "@/components/model-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DATASETS, DATASET_INFO, POLICIES, POLICY_LABELS, REGIMES, SIZES, type DatasetName, type Policy, type SizeName } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";

export const POLICY_TONE: Record<Policy, { tone: SeriesTone; dashed?: boolean; width?: number }> = {
  retrainwise: { tone: "primary", width: 2.2 },
  cara_ct_inspired: { tone: "quaternary" },
  drift_triggered: { tone: "secondary" },
  calendar: { tone: "secondary", dashed: true },
  never: { tone: "tertiary" },
  hindsight_oracle: { tone: "warn", dashed: true },
};

function Chips<T extends string>({ label, options, value, onChange, render, disabled }: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void; render?: (v: T) => string; disabled?: (v: T) => boolean }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          const off = disabled?.(o) ?? false;
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={off}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={cn("h-7 rounded-md border px-2.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-subtle")}
            >
              {render ? render(o) : o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function BenchmarkForm({ cached }: { cached: DatasetName[] }) {
  const [datasets, setDatasets] = useState<DatasetName[]>(["synthetic"]);
  const [policies, setPolicies] = useState<Policy[]>([...POLICIES]);
  const [regimes, setRegimes] = useState<string[]>(["balanced"]);
  const [size, setSize] = useState<SizeName>("small");
  const [seedsText, setSeedsText] = useState("1, 2");
  const { run, pending } = useAction();

  const seeds = seedsText.split(/[\s,]+/).filter(Boolean).map(Number);
  const seedsError = !seeds.length
    ? "Enter at least one seed."
    : seeds.some((s) => !Number.isInteger(s) || s < 0)
      ? "Seeds must be non-negative whole numbers."
      : new Set(seeds).size !== seeds.length
        ? "Seeds must be distinct."
        : seeds.length > 10
          ? "At most 10 seeds."
          : null;
  const runs = datasets.length * policies.length * regimes.length * seeds.length;
  const invalid = !!seedsError || !datasets.length || !policies.length || !regimes.length || runs > 400;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        void run<{ job_id: string; created: boolean }>("/api/jobs", { datasets, policies, regimes, seeds, size }, {
          success: (r) => (r.created ? `Benchmark ${r.job_id} queued` : `Benchmark ${r.job_id} is already running with these settings`),
          description: () => "It runs in a separate worker process; progress updates on this page.",
          failure: "Benchmark not started",
        });
      }}
    >
      <Chips label="Datasets" options={DATASETS} value={datasets} onChange={setDatasets} render={(d) => DATASET_INFO[d].title} disabled={(d) => !cached.includes(d)} />
      <Chips label="Policies" options={POLICIES} value={policies} onChange={setPolicies} render={(p) => POLICY_LABELS[p]} />
      <Chips label="Cost regimes" options={REGIMES} value={regimes as (typeof REGIMES)[number][]} onChange={(v) => setRegimes(v)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="b-size" className="text-[13px]">
            Sample size
          </Label>
          <Select value={size} onValueChange={(v) => setSize(v as SizeName)}>
            <SelectTrigger id="b-size" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SIZES) as SizeName[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "full" ? "Full · all rows" : `${s[0].toUpperCase() + s.slice(1)} · ${SIZES[s]!.toLocaleString()} rows`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="b-seeds" className="text-[13px]">
            Seeds
          </Label>
          <Input id="b-seeds" value={seedsText} onChange={(e) => setSeedsText(e.target.value)} aria-invalid={!!seedsError} />
          {seedsError && <p className="text-[12px] text-bad">{seedsError}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={invalid || pending}>
          {pending ? <Spinner /> : <Play weight="fill" />}
          Run {runs} replay{runs === 1 ? "" : "s"}
        </Button>
        <span className="text-[12px] text-muted-foreground">{runs > 400 ? "At most 400 runs per job." : "Uses the current engine settings. Every policy sees identical streams, label masks and cost traces."}</span>
      </div>
    </form>
  );
}

function tone(s: JobRow["status"]): Tone {
  return s === "completed" ? "ok" : s === "failed" ? "bad" : s === "cancelled" || s === "interrupted" ? "warn" : "info";
}

export function BenchmarkJobs({ jobs, canCancel }: { jobs: JobRow[]; canCancel: boolean }) {
  const live = jobs.some((j) => j.status === "queued" || j.status === "running");
  useAutoRefresh(live, 2000);
  if (!jobs.length) return <p className="text-[13px] text-muted-foreground">No benchmark jobs yet.</p>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {jobs.map((j) => {
        const running = j.status === "queued" || j.status === "running";
        return (
          <li key={j.id} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[13px]">
                <span className="font-mono">{j.id}</span>
                <Status tone={tone(j.status)}>{j.status}</Status>
              </span>
              {running && canCancel && !j.cancel_requested && <CancelJobButton jobId={j.id} />}
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {j.payload.datasets?.join(", ")} · {j.payload.policies?.length} policies · {j.payload.regimes?.join(", ")} · seeds {j.payload.seeds?.join(", ")} · {j.payload.size}
            </p>
            {running && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(j.progress * 100)} aria-label="Benchmark progress">
                <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${j.progress * 100}%` }} />
              </div>
            )}
            {j.message && running && <p className="mt-1 text-[12px] text-muted-foreground">{j.message}</p>}
            {j.error && <p className="mt-1 font-mono text-[11.5px] text-bad">{j.error.split("\n")[0]}</p>}
            {j.status === "completed" && j.result?.runs != null && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                {j.result.runs} runs in {j.result.wall_seconds?.toFixed(0)} s
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type ResultSet = { prefix: string; reference: boolean; runs: number; datasets: string[]; regimes: string[]; seeds: number[]; size: string | null };
type Agg = Record<string, number | string | null> & { dataset: string; regime: string; policy: Policy };
type Results = { prefix: string; reference: boolean; summary: Record<string, unknown>[]; aggregate: Agg[]; meta: { notes?: string[]; wall_seconds?: number } | null; has_details: boolean };
type Traces = { options: { dataset: string; regime: string; seed: number }[]; selected: { dataset: string; regime: string; seed: number }; traces: { policy: Policy; label: string; points: { end: number; error: number; rolling_error: number; action: string; spent: number }[] }[] };

const n = (x: unknown) => (typeof x === "number" ? x : Number(x));

export function ResultsViewer({ sets }: { sets: ResultSet[] }) {
  const [prefix, setPrefix] = useState(sets[0]?.prefix ?? "");
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState("");
  const [traces, setTraces] = useState<Traces | null>(null);
  const [metric, setMetric] = useState<"rolling_error" | "spent">("rolling_error");

  useEffect(() => {
    if (!prefix) return;
    setData(null);
    setError(null);
    api<Results>(`/api/experiments/${prefix}`)
      .then((r) => {
        setData(r);
        const first = r.aggregate[0];
        setCell(first ? `${first.dataset}|${first.regime}` : "");
      })
      .catch((e: Error) => setError(e.message));
  }, [prefix]);

  const cells = useMemo(() => Array.from(new Set((data?.aggregate ?? []).map((a) => `${a.dataset}|${a.regime}`))), [data]);
  const rows = (data?.aggregate ?? []).filter((a) => `${a.dataset}|${a.regime}` === cell);
  const wins = cells.filter((c) => {
    const online = (data?.aggregate ?? []).filter((a) => `${a.dataset}|${a.regime}` === c && a.policy !== "hindsight_oracle");
    const best = online.reduce((m, a) => (n(a.total_cost_mean) < n(m.total_cost_mean) ? a : m), online[0]);
    return best?.policy === "retrainwise";
  }).length;
  const rw = (data?.aggregate ?? []).filter((a) => a.policy === "retrainwise");
  const avgGap = rw.length ? rw.reduce((s, a) => s + n(a.tco_vs_best_online_pct), 0) / rw.length : null;

  useEffect(() => {
    if (!data?.has_details || !cell) {
      setTraces(null);
      return;
    }
    const [dataset, regime] = cell.split("|");
    const seed = data.summary.find((s) => s.dataset === dataset && s.regime === regime)?.seed;
    api<Traces>(`/api/experiments/${prefix}/traces?dataset=${dataset}&regime=${regime}${seed != null ? `&seed=${seed}` : ""}`)
      .then(setTraces)
      .catch(() => setTraces(null));
  }, [data, cell, prefix]);

  const lineData = useMemo(() => {
    if (!traces) return [];
    const byEnd = new Map<number, Record<string, number>>();
    for (const t of traces.traces)
      for (const p of t.points) {
        const row = byEnd.get(p.end) ?? { end: p.end };
        row[t.policy] = metric === "spent" ? p.spent : p.rolling_error;
        byEnd.set(p.end, row);
      }
    return [...byEnd.values()].sort((a, b) => a.end - b.end);
  }, [traces, metric]);

  if (!sets.length) return <p className="text-[13px] text-muted-foreground">No result sets yet. Run a benchmark above.</p>;
  const policiesPresent = POLICIES.filter((p) => data?.aggregate.some((a) => a.policy === p));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 space-y-1.5">
          <Label htmlFor="r-set" className="text-[13px]">
            Result set
          </Label>
          <Select value={prefix} onValueChange={setPrefix}>
            <SelectTrigger id="r-set" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sets.map((s) => (
                <SelectItem key={s.prefix} value={s.prefix}>
                  <span className="font-mono">{s.prefix}</span> · {s.runs} runs{s.reference ? " · reference" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {data && (
          <div className="flex gap-2">
            <Button variant="secondary" asChild>
              <a href={`/api/experiments/${prefix}/export?kind=summary`}>
                <DownloadSimple /> Runs CSV
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={`/api/experiments/${prefix}/export?kind=aggregate`}>
                <DownloadSimple /> Aggregate CSV
              </a>
            </Button>
          </div>
        )}
      </div>

      {error && <Callout tone="bad" title="Could not read this result set">{error}</Callout>}
      {!data && !error && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Spinner /> Reading results…
        </p>
      )}

      {data && (
        <>
          <Callout title={`${data.summary.length} runs · RetrainWise had the lowest total cost among online policies in ${wins} of ${cells.length} cell${cells.length === 1 ? "" : "s"}`}>
            {avgGap != null && <>On average its total cost was {avgGap >= 0 ? `${avgGap.toFixed(1)}% above` : `${Math.abs(avgGap).toFixed(1)}% below`} the best online policy in each cell. </>}
            Total cost = simulated operational cost + cost of errors. <SimLabel />
            {data.meta?.notes?.length ? <span className="mt-1 block text-[12px] text-muted-foreground">{data.meta.notes.join(" ")}</span> : null}
          </Callout>

          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h3 className="text-[13.5px] font-medium">Accuracy against operational spend</h3>
              <span className="text-[12px] text-muted-foreground">One point per dataset × regime; RetrainWise as diamonds</span>
            </div>
            <ScatterMono
              label="Mean accuracy against mean simulated operational cost per policy"
              groups={policiesPresent
                .filter((p) => p !== "hindsight_oracle")
                .map((p) => ({
                  name: POLICY_LABELS[p],
                  tone: POLICY_TONE[p].tone,
                  emphasis: p === "retrainwise",
                  points: data.aggregate.filter((a) => a.policy === p).map((a) => ({ x: n(a.operational_cost_mean), y: n(a.accuracy_mean), label: `${a.dataset} · ${a.regime}` })),
                }))}
            />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Dataset and regime">
              {cells.map((c) => (
                <button key={c} role="tab" aria-selected={c === cell} onClick={() => setCell(c)} className={cn("h-7 rounded-md border px-2.5 text-[12.5px]", c === cell ? "border-foreground bg-foreground text-background" : "border-border hover:bg-subtle")}>
                  {c.replace("|", " · ")}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <caption className="sr-only">Policy comparison for {cell.replace("|", " · ")}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Policy</th>
                    <th className="py-2 pr-3 text-right font-medium">Accuracy</th>
                    <th className="py-2 pr-3 text-right font-medium">Full / partial</th>
                    <th className="py-2 pr-3 text-right font-medium">Operational</th>
                    <th className="py-2 pr-3 text-right font-medium">Error cost</th>
                    <th className="py-2 pr-3 text-right font-medium">Total cost</th>
                    <th className="py-2 text-right font-medium">vs best online</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((a) => {
                    const gap = n(a.tco_vs_best_online_pct);
                    return (
                      <tr key={a.policy} className={cn("border-b border-border/60", a.policy === "retrainwise" && "font-medium")}>
                        <td className="py-1.5 pr-3">
                          {POLICY_LABELS[a.policy] ?? a.policy}
                          {a.policy === "hindsight_oracle" && <Tag className="ml-2">not achievable online</Tag>}
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right">{(n(a.accuracy_mean) * 100).toFixed(2)}%</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {n(a.full_updates_mean).toFixed(1)} / {n(a.partial_updates_mean ?? 0).toFixed(1)}
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right">{money(n(a.operational_cost_mean), 0)}</td>
                        <td className="tabular py-1.5 pr-3 text-right">{money(n(a.error_cost_mean), 0)}</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {money(n(a.total_cost_mean), 0)}
                          {a.total_cost_std != null && <span className="text-[11px] text-muted-foreground"> ±{money(n(a.total_cost_std), 0)}</span>}
                        </td>
                        <td className={cn("tabular py-1.5 text-right", a.policy !== "hindsight_oracle" && gap === 0 && "text-ok")}>{a.policy === "hindsight_oracle" ? "—" : gap === 0 ? "best" : `+${gap.toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {data.has_details && (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-[13.5px] font-medium">Per-batch trace {traces && <span className="font-normal text-muted-foreground">· seed {traces.selected.seed}</span>}</h3>
                <div className="flex gap-1.5">
                  {(["rolling_error", "spent"] as const).map((m) => (
                    <button key={m} onClick={() => setMetric(m)} aria-pressed={metric === m} className={cn("h-7 rounded-md border px-2.5 text-[12.5px]", metric === m ? "border-foreground bg-foreground text-background" : "border-border hover:bg-subtle")}>
                      {m === "spent" ? "Cumulative spend" : "Rolling error"}
                    </button>
                  ))}
                </div>
              </div>
              {traces ? (
                <>
                  <ChartLegend className="mb-2" items={traces.traces.map((t) => ({ label: POLICY_LABELS[t.policy] ?? t.label, tone: POLICY_TONE[t.policy]?.tone ?? "tertiary", dashed: POLICY_TONE[t.policy]?.dashed }))} />
                  <LineChartMono
                    label={`Per-batch ${metric === "spent" ? "cumulative spend" : "rolling error"} for each policy`}
                    data={lineData}
                    xKey="end"
                    xLabel="row"
                    xFormat="thousands"
                    yFormat={metric === "spent" ? "money" : "pct"}
                    height={300}
                    series={traces.traces.map((t) => ({ key: t.policy, name: POLICY_LABELS[t.policy] ?? t.label, tone: POLICY_TONE[t.policy]?.tone ?? "tertiary", dashed: POLICY_TONE[t.policy]?.dashed, width: POLICY_TONE[t.policy]?.width }))}
                  />
                </>
              ) : (
                <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  <Spinner /> Loading traces…
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
