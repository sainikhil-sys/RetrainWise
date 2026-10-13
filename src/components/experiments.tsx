"use client";

import { Ban, Download, FlaskConical, Image as ImageIcon, Loader2, Play, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DATASETS, POLICIES, POLICY_COLORS, POLICY_HELP, POLICY_LABELS, REGIMES, SIZES, type DatasetName, type Policy, type SizeName } from "@/lib/catalog";
import { ago, jobTone, money, pct } from "@/lib/format";
import type { JobRow } from "@/lib/types";
import { AccuracySpendScatter, PolicyLines, SimpleBars } from "./charts";
import { Button, ChipSelect, Field, api, inputClass, useAction } from "./client";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, ProgressBar, SimLabel, Table, Td, Th, cn } from "./ui";

/* ----------------------------------------------------------- submit form */
export function ExperimentForm({ cached }: { cached: DatasetName[] }) {
  const [datasets, setDatasets] = useState<DatasetName[]>(["synthetic"]);
  const [policies, setPolicies] = useState<Policy[]>([...POLICIES]);
  const [regimes, setRegimes] = useState<string[]>(["balanced"]);
  const [size, setSize] = useState<SizeName>("small");
  const [seedsText, setSeedsText] = useState("1, 2");
  const { run, pending } = useAction();

  const parsed = seedsText
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => Number(s));
  const seedsError = !parsed.length
    ? "Enter at least one seed."
    : parsed.some((s) => !Number.isInteger(s) || s < 0)
      ? "Seeds must be non-negative whole numbers."
      : new Set(parsed).size !== parsed.length
        ? "Seeds must be distinct."
        : parsed.length > 10
          ? "At most 10 seeds."
          : null;
  const runs = datasets.length * policies.length * regimes.length * parsed.length;
  const invalid = !!seedsError || !datasets.length || !policies.length || !regimes.length || runs > 400;

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid) return;
        void run<{ job_id: string; created: boolean }>("/api/jobs", { datasets, policies, regimes, seeds: parsed, size }, {
          success: (r) => (r.created ? `Job ${r.job_id} started` : `Job ${r.job_id} is already running with these settings`),
          successBody: () => "It runs in a separate worker process; progress updates below.",
          failure: "Job not started",
        });
      }}
    >
      <Field label="Datasets" help="Only cached datasets can be used; download others in Data & simulation.">
        <ChipSelect ariaLabel="Datasets" options={DATASETS} value={datasets} onChange={setDatasets} disabled={(d) => !cached.includes(d)} />
      </Field>
      <Field label="Policies">
        <div className="flex flex-wrap gap-2">
          {POLICIES.map((p) => {
            const on = policies.includes(p);
            return (
              <button
                key={p}
                type="button"
                aria-pressed={on}
                title={POLICY_HELP[p]}
                onClick={() => setPolicies(on ? policies.filter((x) => x !== p) : [...policies, p])}
                className={cn("flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset", on ? "bg-slate-800 text-slate-100 ring-slate-600" : "text-slate-500 ring-slate-800 hover:text-slate-300")}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: on ? POLICY_COLORS[p] : "#334155" }} aria-hidden />
                {POLICY_LABELS[p]}
              </button>
            );
          })}
        </div>
      </Field>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Cost regimes">
          <ChipSelect ariaLabel="Cost regimes" options={REGIMES} value={regimes as (typeof REGIMES)[number][]} onChange={setRegimes} />
        </Field>
        <Field label="Sample size" htmlFor="exp-size">
          <select id="exp-size" className={inputClass} value={size} onChange={(e) => setSize(e.target.value as SizeName)}>
            {(Object.keys(SIZES) as SizeName[]).map((s) => (
              <option key={s} value={s}>
                {s} {SIZES[s] ? `(${SIZES[s]!.toLocaleString()} rows)` : "(all rows — slow)"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Seeds" htmlFor="exp-seeds" error={seedsError} help="Comma-separated; each seed is a full reproducible replay.">
          <input id="exp-seeds" className={inputClass} value={seedsText} onChange={(e) => setSeedsText(e.target.value)} aria-invalid={!!seedsError} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" icon={Play} loading={pending} disabled={invalid}>
          Start benchmark ({runs} run{runs === 1 ? "" : "s"})
        </Button>
        {runs > 400 && <span className="text-xs text-rose-300">At most 400 runs per job.</span>}
        <span className="text-xs text-slate-500">Uses the current Settings. All policies see identical streams, label masks and cost traces.</span>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- jobs */
export function JobsPanel({ initial }: { initial: JobRow[] }) {
  const [jobs, setJobs] = useState(initial);
  const cancel = useAction();
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => setJobs(initial), [initial]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(async () => {
      try {
        const r = await api<{ jobs: JobRow[] }>("/api/jobs");
        setJobs(r.jobs);
        if (!r.jobs.some((j) => j.status === "queued" || j.status === "running")) window.dispatchEvent(new Event("rw:jobs-finished"));
      } catch {
        /* keep polling */
      }
    }, 1500);
    return () => clearInterval(t);
  }, [active]);

  if (!jobs.length) return <EmptyState icon={FlaskConical} title="No benchmark jobs yet">Start one above. Results are written to CSV/JSON files in engine/ and listed below.</EmptyState>;
  return (
    <ul className="space-y-3">
      {jobs.map((j) => {
        const running = j.status === "queued" || j.status === "running";
        return (
          <li key={j.id} className="rounded-xl border border-slate-800 bg-slate-900/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-slate-300">{j.id}</span>
                <Badge tone={jobTone(j.status)} dot>
                  {j.status}
                </Badge>
                <span className="text-xs text-slate-500">
                  {j.payload.datasets.join(", ")} · {j.payload.size} · seeds {j.payload.seeds.join(", ")} · {j.payload.regimes.join(", ")} · {j.payload.policies.length} policies · {ago(j.created)}
                </span>
              </div>
              {running && (
                <Button size="sm" variant="ghost" icon={Ban} loading={cancel.pending} disabled={!!j.cancel_requested} onClick={() => cancel.run(`/api/jobs/${j.id}/cancel`, {}, { success: () => "Cancellation requested", successBody: () => "The worker stops after the current policy run." })}>
                  {j.cancel_requested ? "Cancelling…" : "Cancel"}
                </Button>
              )}
            </div>
            {running && <ProgressBar className="mt-3" value={j.progress} label={j.message ?? "working"} tone="info" />}
            {j.status === "completed" && j.result && (
              <p className="mt-2 text-xs text-emerald-300/90">
                {j.result.runs} runs in {Math.round(j.result.wall_seconds)} s → result set <span className="font-mono">experiment_{j.id}</span>
              </p>
            )}
            {j.error && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-rose-300/90">{j.error.split("\n")[0]}</p>}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------ results */
type ResultSet = { prefix: string; runs: number; datasets: string[]; regimes: string[]; seeds: number[]; size: string | null };
type Agg = Record<string, number | string | null> & { dataset: string; regime: string; policy: Policy };
type Results = { prefix: string; summary: Record<string, unknown>[]; aggregate: Agg[]; meta: { notes?: string[]; wall_seconds?: number } | null; charts: string[]; has_details: boolean };
type Traces = { options: { dataset: string; regime: string; seed: number }[]; selected: { dataset: string; regime: string; seed: number }; traces: { policy: Policy; label: string; points: { end: number; error: number; rolling_error: number; action: string; spent: number }[] }[] };

export function ResultsViewer({ sets: initialSets }: { sets: ResultSet[] }) {
  const [sets, setSets] = useState(initialSets);
  const [prefix, setPrefix] = useState(initialSets.find((s) => s.prefix === "results")?.prefix ?? initialSets[0]?.prefix ?? "");
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cell, setCell] = useState<string>("");
  const [traces, setTraces] = useState<Traces | null>(null);
  const [metric, setMetric] = useState<"rolling_error" | "spent">("rolling_error");

  useEffect(() => setSets(initialSets), [initialSets]);
  const reloadSets = useCallback(() => {
    api<{ sets: ResultSet[] }>("/api/experiments").then((r) => setSets(r.sets)).catch(() => undefined);
  }, []);
  useEffect(() => {
    window.addEventListener("rw:jobs-finished", reloadSets);
    return () => window.removeEventListener("rw:jobs-finished", reloadSets);
  }, [reloadSets]);

  useEffect(() => {
    if (!prefix) return;
    setData(null);
    setError(null);
    setTraces(null);
    api<Results>(`/api/experiments/${prefix}`)
      .then((r) => {
        setData(r);
        const first = r.aggregate[0];
        setCell(first ? `${first.dataset}|${first.regime}` : "");
      })
      .catch((e: Error) => setError(e.message));
  }, [prefix]);

  const [traceDataset, traceRegime] = cell.split("|");
  useEffect(() => {
    if (!data?.has_details || !traceDataset) return;
    setTraces(null);
    const seed = (data.summary.find((s) => s.dataset === traceDataset && s.regime === traceRegime)?.seed as number) ?? "";
    api<Traces>(`/api/experiments/${prefix}/traces?dataset=${traceDataset}&regime=${traceRegime}&seed=${seed}`).then(setTraces).catch(() => setTraces(null));
  }, [data, prefix, traceDataset, traceRegime]);

  const cells = useMemo(() => Array.from(new Set((data?.aggregate ?? []).map((a) => `${a.dataset}|${a.regime}`))), [data]);
  const cellRows = (data?.aggregate ?? []).filter((a) => `${a.dataset}|${a.regime}` === cell);

  if (!sets.length) return <EmptyState icon={FlaskConical} title="No result sets yet">Completed benchmark jobs write result files that appear here.</EmptyState>;

  const winners = cells.map((c) => {
    const rows = (data?.aggregate ?? []).filter((a) => `${a.dataset}|${a.regime}` === c && a.policy !== "hindsight_oracle");
    const best = rows.slice().sort((a, b) => Number(a.total_cost_mean) - Number(b.total_cost_mean))[0];
    return { cell: c, best };
  });
  const rwWins = winners.filter((w) => w.best?.policy === "retrainwise").length;

  const lineData = (() => {
    if (!traces) return [];
    const byEnd = new Map<number, Record<string, number>>();
    for (const t of traces.traces) for (const p of t.points) {
      const row = byEnd.get(p.end) ?? { end: p.end };
      row[t.policy] = metric === "spent" ? p.spent : p.rolling_error;
      byEnd.set(p.end, row);
    }
    return Array.from(byEnd.values()).sort((a, b) => a.end - b.end);
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="Result set" htmlFor="rs">
          <select id="rs" className={cn(inputClass, "min-w-72")} value={prefix} onChange={(e) => setPrefix(e.target.value)}>
            {sets.map((s) => (
              <option key={s.prefix} value={s.prefix}>
                {s.prefix} — {s.runs} runs · {s.datasets.join(", ")} · {s.size}
              </option>
            ))}
          </select>
        </Field>
        {data && (
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-800" href={`/api/experiments/${prefix}/export?kind=summary`}>
              <Download className="h-4 w-4" aria-hidden /> Summary CSV
            </a>
            <a className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-800" href={`/api/experiments/${prefix}/export?kind=aggregate`}>
              <Download className="h-4 w-4" aria-hidden /> Aggregate CSV
            </a>
            {data.has_details && (
              <a className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-800" href={`/api/experiments/${prefix}/export?kind=details`}>
                <Download className="h-4 w-4" aria-hidden /> Details JSON
              </a>
            )}
          </div>
        )}
      </div>

      {error && <Alert tone="bad" title="Could not load results">{error}</Alert>}
      {!data && !error && (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Aggregating results in the engine…
        </div>
      )}

      {data && (
        <>
          <Alert tone="neutral" title={`${data.summary.length} runs · lowest total cost of ownership among online policies: RetrainWise in ${rwWins} of ${cells.length} cell(s)`}>
            Total cost of ownership = simulated operational spend + cost of prediction errors (errors × assumed error value). Means over seeds; the hindsight oracle uses future labels and is shown only as a reference. {data.meta?.notes?.join(" ")}
          </Alert>

          <Card>
            <CardHeader title="Mean total cost of ownership per cell" icon={Trophy} description="Lower is better. One bar per policy for each dataset × cost regime." action={<SimLabel />} />
            <CardBody>
              <SimpleBars
                data={cells.map((c) => {
                  const row: Record<string, unknown> = { cell: c.replace("|", " · ") };
                  for (const a of data.aggregate.filter((x) => `${x.dataset}|${x.regime}` === c)) row[a.policy] = Math.round(Number(a.total_cost_mean));
                  return row;
                })}
                xKey="cell"
                money
                height={340}
                bars={POLICIES.filter((p) => data.aggregate.some((a) => a.policy === p)).map((p) => ({ key: p, name: POLICY_LABELS[p], color: POLICY_COLORS[p] }))}
                label="Mean total cost of ownership per policy and cell"
              />
            </CardBody>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Accuracy vs operational spend" description="Each point is one dataset × regime cell (mean over seeds). Up and to the left is better." action={<SimLabel />} />
              <CardBody>
                <AccuracySpendScatter
                  points={POLICIES.filter((p) => data.aggregate.some((a) => a.policy === p)).map((p) => ({
                    name: POLICY_LABELS[p],
                    color: POLICY_COLORS[p],
                    data: data.aggregate.filter((a) => a.policy === p).map((a) => ({ spend: Number(a.operational_cost_mean), accuracy: Number(a.accuracy_mean), label: `${a.dataset} · ${a.regime}` })),
                  }))}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Updates per policy" description="Mean full retrains and incremental updates per run, across all cells." />
              <CardBody>
                <SimpleBars
                  data={POLICIES.filter((p) => data.aggregate.some((a) => a.policy === p)).map((p) => {
                    const rows = data.aggregate.filter((a) => a.policy === p);
                    const mean = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0) / rows.length;
                    return { policy: POLICY_LABELS[p], full: +mean("full_updates_mean").toFixed(2), partial: +mean("partial_updates_mean").toFixed(2), rejected: +mean("rejected_actions_mean").toFixed(2) };
                  })}
                  xKey="policy"
                  stacked
                  height={320}
                  bars={[
                    { key: "full", name: "Full retrains", color: "#60a5fa" },
                    { key: "partial", name: "Incremental updates", color: "#2dd4bf" },
                    { key: "rejected", name: "Rejected by validation", color: "#fb7185" },
                  ]}
                  label="Mean number of updates per policy"
                />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="Per-cell comparison"
              description="Choose a dataset × regime cell to see its table and per-batch traces."
              action={
                <select aria-label="Cell" className={cn(inputClass, "w-auto")} value={cell} onChange={(e) => setCell(e.target.value)}>
                  {cells.map((c) => (
                    <option key={c} value={c}>
                      {c.replace("|", " · ")}
                    </option>
                  ))}
                </select>
              }
            />
            <CardBody className="space-y-5">
              <Table caption="Per-cell results">
                <thead>
                  <tr>
                    <Th>Policy</Th>
                    <Th align="right">Seeds</Th>
                    <Th align="right">Accuracy</Th>
                    <Th align="right">Macro F1</Th>
                    <Th align="right">Full</Th>
                    <Th align="right">Incremental</Th>
                    <Th align="right">Evaluations</Th>
                    <Th align="right">Probes</Th>
                    <Th align="right">Rejected</Th>
                    <Th align="right">Blocked</Th>
                    <Th align="right">Operational</Th>
                    <Th align="right">Error cost</Th>
                    <Th align="right">Total (± sd)</Th>
                    <Th align="right">vs best online</Th>
                  </tr>
                </thead>
                <tbody>
                  {cellRows.map((a) => (
                    <tr key={a.policy} className={a.policy === "retrainwise" ? "bg-teal-400/[0.05]" : undefined}>
                      <Td>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: POLICY_COLORS[a.policy] }} aria-hidden />
                          {POLICY_LABELS[a.policy]}
                        </span>
                      </Td>
                      <Td align="right">{a.seeds}</Td>
                      <Td align="right">{pct(Number(a.accuracy_mean), 2)}</Td>
                      <Td align="right">{Number(a.macro_f1_mean).toFixed(3)}</Td>
                      <Td align="right">{Number(a.full_updates_mean).toFixed(1)}</Td>
                      <Td align="right">{Number(a.partial_updates_mean).toFixed(1)}</Td>
                      <Td align="right">{Number(a.evaluations_mean).toFixed(1)}</Td>
                      <Td align="right">{a.probes_mean == null ? "—" : Number(a.probes_mean).toFixed(1)}</Td>
                      <Td align="right">{Number(a.rejected_actions_mean).toFixed(1)}</Td>
                      <Td align="right">{Number(a.blocked_actions_mean).toFixed(1)}</Td>
                      <Td align="right">{money(Number(a.operational_cost_mean), 0)}</Td>
                      <Td align="right">{money(Number(a.error_cost_mean), 0)}</Td>
                      <Td align="right">
                        {money(Number(a.total_cost_mean), 0)} <span className="text-xs text-slate-500">± {money(Number(a.total_cost_std ?? 0), 0)}</span>
                      </Td>
                      <Td align="right" className={Number(a.tco_vs_best_online_pct) <= 0.0001 ? "text-emerald-300" : "text-slate-300"}>
                        {a.policy === "hindsight_oracle" ? `${Number(a.tco_vs_best_online_pct).toFixed(1)}% (oracle)` : Number(a.tco_vs_best_online_pct) <= 0.0001 ? "best" : `+${Number(a.tco_vs_best_online_pct).toFixed(1)}%`}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {data.has_details && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-200">
                      Per-batch trace {traces && `· seed ${traces.selected.seed}`}
                    </span>
                    <div role="group" aria-label="Trace metric" className="flex gap-1 rounded-lg border border-slate-800 p-1">
                      {(["rolling_error", "spent"] as const).map((m) => (
                        <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)} className={cn("rounded-md px-2.5 py-1 text-xs", metric === m ? "bg-slate-800 text-teal-200" : "text-slate-400")}>
                          {m === "spent" ? "Cumulative spend" : "Rolling error"}
                        </button>
                      ))}
                    </div>
                  </div>
                  {traces ? (
                    <PolicyLines data={lineData} percent={metric !== "spent"} yLabel={metric} series={traces.traces.map((t) => ({ key: t.policy, name: POLICY_LABELS[t.policy] ?? t.label, color: POLICY_COLORS[t.policy] ?? "#94a3b8", dashed: t.policy === "hindsight_oracle" }))} />
                  ) : (
                    <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading traces…
                    </div>
                  )}
                </div>
              )}
            </CardBody>
          </Card>

          {data.charts.length > 0 && (
            <Card>
              <CardHeader title="Exported charts (PNG)" icon={ImageIcon} description="Generated by engine/reporting.py when the job finished." />
              <CardBody className="grid gap-4 md:grid-cols-2">
                {data.charts.map((c) => {
                  const name = c.replace(`${prefix}_chart_`, "").replace(".png", "");
                  const url = `/api/experiments/${prefix}/export?kind=chart&chart=${name}`;
                  return (
                    <figure key={c} className="overflow-hidden rounded-xl border border-slate-800 bg-white">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${url}&inline=1`} alt={`Chart ${name.replace(/_/g, " ")}`} className="w-full" loading="lazy" />
                      <figcaption className="flex items-center justify-between bg-navy-900 px-3 py-2 text-xs text-slate-400">
                        {c}
                        <a href={url} className="text-teal-300 hover:underline">
                          Download
                        </a>
                      </figcaption>
                    </figure>
                  );
                })}
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
