"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { C } from "@/lib/palette";
import { cn } from "./ui";

export { C };

const axis = { stroke: C.axis, tick: { fill: "#94a3b8", fontSize: 11 }, tickLine: false, axisLine: { stroke: "#334155" } };

const tooltipStyle = {
  contentStyle: { background: "#0b1324", border: "1px solid #334155", borderRadius: 10, fontSize: 12, color: "#e2e8f0", boxShadow: "0 10px 30px rgba(0,0,0,.5)" },
  labelStyle: { color: "#cbd5e1", fontWeight: 600, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "#475569", strokeDasharray: "3 3" },
};

const legendStyle = { wrapperStyle: { fontSize: 12, color: "#cbd5e1", paddingTop: 8 } };

function Frame({ height = 280, children, label }: { height?: number; children: ReactNode; label: string }) {
  return (
    <div role="img" aria-label={label} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

const fmtPct = (v: unknown) => (typeof v === "number" ? `${(v * 100).toFixed(1)}%` : String(v ?? "—"));
const fmtNum = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 3 }) : String(v ?? "—"));
const fmtMoney = (v: unknown) => (typeof v === "number" ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : String(v ?? "—"));

/* ----------------------------------------------------------- error trace */
export type ErrorPoint = {
  row: number;
  batch: number;
  batchError: number | null;
  rolling: number | null;
  reference: number | null;
  ci: [number, number] | null;
  version: number;
};

export function ErrorTraceChart({ data, versionChanges, height = 300, showCi = true }: { data: ErrorPoint[]; versionChanges: { row: number; version: number }[]; height?: number; showCi?: boolean }) {
  return (
    <Frame height={height} label="Observed error over the stream with rolling error, its 95% interval and the reference error">
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="row" {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} label={{ value: "stream row", position: "insideBottomRight", offset: -2, fill: "#64748b", fontSize: 11 }} />
        <YAxis {...axis} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} domain={[0, "auto"]} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Row ${Number(v).toLocaleString()}`} formatter={(v: unknown, name) => [Array.isArray(v) ? `${fmtPct(v[0])} – ${fmtPct(v[1])}` : fmtPct(v), name]} />
        <Legend {...legendStyle} />
        {showCi && <Area type="monotone" dataKey="ci" name="Rolling 95% interval" stroke="none" fill={C.amber} fillOpacity={0.12} isAnimationActive={false} />}
        <Line type="monotone" dataKey="batchError" name="Batch error" stroke={C.sky} strokeWidth={1.5} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="rolling" name="Rolling error" stroke={C.amber} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
        <Line type="stepAfter" dataKey="reference" name="Reference error" stroke={C.slate} strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        {versionChanges.map((v) => (
          <ReferenceLine key={v.row} x={v.row} stroke={C.teal} strokeDasharray="4 4" label={{ value: `v${String(v.version).padStart(3, "0")}`, fill: C.teal, fontSize: 10, position: "insideTopLeft" }} />
        ))}
      </ComposedChart>
    </Frame>
  );
}

/* ------------------------------------------------------------- metrics */
export function MetricsChart({ data, height = 280 }: { data: { row: number; accuracy: number | null; precision: number | null; recall: number | null; f1: number | null }[]; height?: number }) {
  return (
    <Frame height={height} label="Accuracy, macro precision, macro recall and macro F1 per batch">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="row" {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <YAxis {...axis} domain={[0, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} width={44} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Row ${Number(v).toLocaleString()}`} formatter={(v: unknown, n) => [fmtPct(v), n]} />
        <Legend {...legendStyle} />
        <Line dataKey="accuracy" name="Accuracy" stroke={C.teal} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="f1" name="Macro F1" stroke={C.violet} strokeWidth={1.8} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="precision" name="Macro precision" stroke={C.sky} strokeWidth={1.4} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="recall" name="Macro recall" stroke={C.amber} strokeWidth={1.4} strokeDasharray="2 3" dot={false} connectNulls isAnimationActive={false} />
      </LineChart>
    </Frame>
  );
}

/* --------------------------------------------------- detectors / staleness */
export function StalenessChart({ data, height = 280 }: { data: { row: number; debt: number; adwin: number | null; ddmDrift: number | null; ddmWarn: number | null; age: number }[]; height?: number }) {
  return (
    <Frame height={height} label="Learning debt over the stream with ADWIN and DDM alarms">
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="row" {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <YAxis yAxisId="debt" {...axis} width={52} tickFormatter={(v) => `$${v}`} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Row ${Number(v).toLocaleString()}`} formatter={(v: unknown, n) => [n === "Learning debt" ? fmtMoney(v) : v == null ? "—" : "alarm", n]} />
        <Legend {...legendStyle} />
        <Bar yAxisId="debt" dataKey="debt" name="Learning debt" fill={C.sky} fillOpacity={0.55} radius={[3, 3, 0, 0]} isAnimationActive={false} />
        <Scatter yAxisId="debt" dataKey="adwin" name="ADWIN error increase" fill={C.rose} shape="triangle" isAnimationActive={false} />
        <Scatter yAxisId="debt" dataKey="ddmDrift" name="DDM drift" fill={C.violet} shape="cross" isAnimationActive={false} />
        <Scatter yAxisId="debt" dataKey="ddmWarn" name="DDM warning" fill={C.amber} shape="circle" isAnimationActive={false} />
      </ComposedChart>
    </Frame>
  );
}

/* ---------------------------------------------------------------- bars */
export function SimpleBars({
  data,
  bars,
  xKey,
  height = 260,
  label,
  stacked,
  money,
  percent,
  layout = "horizontal",
}: {
  data: Record<string, unknown>[];
  bars: { key: string; name: string; color: string }[];
  xKey: string;
  height?: number;
  label: string;
  stacked?: boolean;
  money?: boolean;
  percent?: boolean;
  layout?: "horizontal" | "vertical";
}) {
  const fmt = money ? fmtMoney : percent ? fmtPct : fmtNum;
  const vertical = layout === "vertical";
  return (
    <Frame height={height} label={label}>
      <BarChart data={data} layout={layout} margin={{ top: 10, right: 16, left: vertical ? 8 : 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={(v) => (money ? `$${v}` : percent ? `${Math.round(v * 100)}%` : String(v))} />
            <YAxis type="category" dataKey={xKey} {...axis} width={150} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} interval="preserveStartEnd" />
            <YAxis {...axis} width={56} tickFormatter={(v) => (money ? `$${v}` : percent ? `${Math.round(v * 100)}%` : String(v))} />
          </>
        )}
        <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(148,163,184,0.06)" }} formatter={(v: unknown, n) => [fmt(v), n]} />
        {bars.length > 1 && <Legend {...legendStyle} />}
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} stackId={stacked ? "s" : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </Frame>
  );
}

/* ------------------------------------------------- benefit vs cost (CI) */
export function BenefitCostChart({ data, height = 280 }: { data: { action: string; benefit: number; err: [number, number]; cost: number; net: number }[]; height?: number }) {
  return (
    <Frame height={height} label="Expected benefit with 95% interval versus total cost per action">
      <BarChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="action" {...axis} />
        <YAxis {...axis} width={60} tickFormatter={(v) => `$${v}`} />
        <Tooltip {...tooltipStyle} cursor={{ fill: "rgba(148,163,184,0.06)" }} formatter={(v: unknown, n) => [Array.isArray(v) ? `± ${fmtMoney(v[1])}` : fmtMoney(v), n]} />
        <Legend {...legendStyle} />
        <ReferenceLine y={0} stroke="#475569" />
        <Bar dataKey="benefit" name="Expected benefit" fill={C.emerald} radius={[4, 4, 0, 0]} isAnimationActive={false}>
          <ErrorBar dataKey="err" width={8} strokeWidth={1.5} stroke="#e2e8f0" direction="y" />
        </Bar>
        <Bar dataKey="cost" name="Total cost" fill={C.rose} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Bar dataKey="net" name="Net expected value" fill={C.teal} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </Frame>
  );
}

/* --------------------------------------------------------- PSI heatmap */
function psiColor(v: number | null | undefined, threshold: number): string {
  if (v == null || !Number.isFinite(v)) return "rgba(51,65,85,0.25)";
  const t = Math.min(1, v / Math.max(threshold * 2.5, 0.5));
  if (v >= threshold) return `rgba(251,113,133,${0.35 + 0.6 * t})`;
  return `rgba(45,212,191,${0.08 + 0.55 * t})`;
}

export function PsiHeatmap({ features, batches, values, threshold }: { features: string[]; batches: { row: number; batch: number }[]; values: (number | null)[][]; threshold: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const maxCols = 60;
  const start = Math.max(0, batches.length - maxCols);
  const cols = batches.slice(start);
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `minmax(110px,auto) repeat(${cols.length}, minmax(14px,1fr))` }} role="table" aria-label="PSI per feature (rows) and batch (columns)">
          {features.map((f, fi) => (
            <Fragment key={f}>
              <div role="rowheader" className="truncate pr-2 text-right font-mono text-[11px] leading-[16px] text-slate-400" title={f}>
                {f}
              </div>
              {cols.map((b, ci) => {
                const v = values[fi]?.[start + ci] ?? null;
                return (
                  <div
                    key={b.batch}
                    role="cell"
                    tabIndex={-1}
                    aria-label={`${f}, batch ${b.batch}: PSI ${v == null ? "n/a" : v.toFixed(3)}`}
                    onMouseEnter={() => setHover(`${f} · batch ${b.batch} (row ${b.row.toLocaleString()}) · PSI ${v == null ? "n/a" : v.toFixed(3)}`)}
                    onMouseLeave={() => setHover(null)}
                    className="h-4 rounded-[3px]"
                    style={{ background: psiColor(v, threshold) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: psiColor(threshold * 0.4, threshold) }} /> below threshold
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm" style={{ background: psiColor(threshold * 1.5, threshold) }} /> above {threshold}
        </span>
        <span className={cn("min-h-4 font-mono text-slate-300", !hover && "opacity-0")}>{hover ?? "–"}</span>
        {start > 0 && <span>Showing the latest {maxCols} batches.</span>}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- experiments */
export function PolicyLines({ data, series, height = 320, yLabel = "error", percent = true }: { data: Record<string, unknown>[]; series: { key: string; name: string; color: string; dashed?: boolean }[]; height?: number; yLabel?: string; percent?: boolean }) {
  return (
    <Frame height={height} label={`Per-batch ${yLabel} for each policy`}>
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="end" {...axis} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
        <YAxis {...axis} width={50} tickFormatter={(v) => (percent ? `${Math.round(v * 100)}%` : `$${v}`)} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Row ${Number(v).toLocaleString()}`} formatter={(v: unknown, n) => [percent ? fmtPct(v) : fmtMoney(v), n]} />
        <Legend {...legendStyle} />
        {series.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={s.key === "retrainwise" ? 2.6 : 1.5} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} connectNulls isAnimationActive={false} />
        ))}
      </LineChart>
    </Frame>
  );
}

export function AccuracySpendScatter({ points, height = 320 }: { points: { name: string; color: string; data: { spend: number; accuracy: number; label: string }[] }[]; height?: number }) {
  return (
    <Frame height={height} label="Accuracy versus operational spend for each policy and cell">
      <ScatterChart margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} />
        <XAxis type="number" dataKey="spend" name="Operational spend" {...axis} tickFormatter={(v) => `$${v}`} />
        <YAxis type="number" dataKey="accuracy" name="Accuracy" {...axis} width={50} domain={["auto", "auto"]} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
        <ZAxis range={[60, 60]} />
        <Tooltip {...tooltipStyle} formatter={(v: unknown, n) => [n === "Accuracy" ? fmtPct(v) : fmtMoney(v), n]} />
        <Legend {...legendStyle} />
        {points.map((p) => (
          <Scatter key={p.name} name={p.name} data={p.data} fill={p.color} isAnimationActive={false} />
        ))}
      </ScatterChart>
    </Frame>
  );
}

/* ------------------------------------------------------- probe / DiD */
export type ProbePoint = {
  batch: number;
  deployed: number;
  probe: number;
  did: number | null;
  band: [number, number] | null;
  hardness: number | null;
  phase: string;
};

export function ProbeErrorChart({ data, height = 280 }: { data: ProbePoint[]; height?: number }) {
  return (
    <Frame height={height} label="Deployed model error and fresh probe model error on the same newly labelled rows">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="batch" {...axis} label={{ value: "batch", position: "insideBottomRight", offset: -2, fill: "#64748b", fontSize: 11 }} />
        <YAxis {...axis} width={44} tickFormatter={(v) => `${Math.round(v * 100)}%`} domain={[0, "auto"]} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Batch ${v}`} formatter={(v: unknown, n) => [fmtPct(v), n]} />
        <Legend {...legendStyle} />
        <Line dataKey="deployed" name="Deployed model" stroke={C.amber} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="probe" name="Fresh probe model" stroke={C.teal} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </Frame>
  );
}

export function DidChart({ data, height = 280 }: { data: ProbePoint[]; height?: number }) {
  return (
    <Frame height={height} label="Difference-in-differences avoidable staleness with 95% interval and task-hardness shift">
      <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="batch" {...axis} />
        <YAxis {...axis} width={48} tickFormatter={(v) => `${(v * 100).toFixed(0)} pts`} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Batch ${v}`} formatter={(v: unknown, n) => [Array.isArray(v) ? `${(v[0] * 100).toFixed(1)} to ${(v[1] * 100).toFixed(1)} pts` : typeof v === "number" ? `${(v * 100).toFixed(1)} pts` : "—", n]} />
        <Legend {...legendStyle} />
        <ReferenceLine y={0} stroke="#475569" />
        <Area type="monotone" dataKey="band" name="95% interval" stroke="none" fill={C.rose} fillOpacity={0.14} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="did" name="Avoidable staleness (DiD)" stroke={C.rose} strokeWidth={2.2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        <Line type="monotone" dataKey="hardness" name="Task got harder for all models" stroke={C.slate} strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </Frame>
  );
}

export function RenewalChart({ data, height = 260 }: { data: { batch: number; marginal: number | null; average: number | null }[]; height?: number }) {
  return (
    <Frame height={height} label="Renewal rule: marginal avoidable cost per prediction versus running average cycle cost">
      <LineChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="batch" {...axis} />
        <YAxis {...axis} width={56} scale="log" domain={["auto", "auto"]} allowDataOverflow tickFormatter={(v) => `$${Number(v).toPrecision(2)}`} />
        <Tooltip {...tooltipStyle} labelFormatter={(v) => `Batch ${v}`} formatter={(v: unknown, n) => [typeof v === "number" ? `$${v.toFixed(4)} / prediction` : "—", n]} />
        <Legend {...legendStyle} />
        <Line dataKey="average" name="Running average cycle cost" stroke={C.sky} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        <Line dataKey="marginal" name="Marginal avoidable cost" stroke={C.rose} strokeWidth={2} dot={{ r: 2 }} connectNulls isAnimationActive={false} />
      </LineChart>
    </Frame>
  );
}
