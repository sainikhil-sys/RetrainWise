"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { ChartReveal } from "./motion";

/*
 * Analytical charts in the editorial system: white background, black primary
 * series, gray comparisons, light grid, minimal legends, direct annotations.
 */

export const INK = { primary: "#0a0a0a", secondary: "#8a8a87", tertiary: "#c4c4c0", quaternary: "#5f5f5c", grid: "#ededeb", axis: "#8a8a87", warn: "#a15c00", bad: "#c62828", ok: "#16794a" };
const TONES = { primary: INK.primary, secondary: INK.secondary, tertiary: INK.tertiary, quaternary: INK.quaternary, warn: INK.warn, bad: INK.bad, ok: INK.ok } as const;
export type SeriesTone = keyof typeof TONES;

export type YFormat = "pct" | "money" | "num" | "pts" | "int";

export function fmtY(v: unknown, f: YFormat): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  switch (f) {
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "money":
      return `$${v.toLocaleString("en-US", { maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0 })}`;
    case "pts":
      return `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pts`;
    case "int":
      return Math.round(v).toLocaleString("en-US");
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 3 });
  }
}

function tickY(v: number, f: YFormat) {
  if (f === "pct") return `${Math.round(v * 100)}%`;
  if (f === "pts") return `${Math.round(v * 100)}`;
  if (f === "money") return `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : Math.round(v)}`;
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v * 100) / 100);
}

const axisProps = { stroke: INK.axis, tick: { fill: INK.axis, fontSize: 11 }, tickLine: false, axisLine: { stroke: "#dededb" } } as const;

function TooltipBox({ active, payload, label, labelFormat, yFormat }: { active?: boolean; payload?: Array<{ name: string; value: unknown; color: string; dataKey: string }>; label?: unknown; labelFormat?: (l: unknown) => string; yFormat: YFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.3)]">
      <div className="mb-1 font-medium text-foreground">{labelFormat ? labelFormat(label) : String(label)}</div>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined && !Array.isArray(p.value))
        .map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4 tabular">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="inline-block h-0.5 w-3" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="text-foreground">{fmtY(p.value, yFormat)}</span>
          </div>
        ))}
    </div>
  );
}

export type Annotation = { x: number; label: string; kind: "retrain" | "partial" | "alarm" | "decision" | "promotion" | "rollback" };
export type HLine = { y: number; label: string; tone?: "neutral" | "warn" | "bad" };

const ANN_STYLE: Record<Annotation["kind"], { stroke: string; dash?: string }> = {
  retrain: { stroke: INK.primary },
  promotion: { stroke: INK.primary },
  partial: { stroke: INK.quaternary, dash: "4 3" },
  rollback: { stroke: INK.warn, dash: "4 3" },
  alarm: { stroke: INK.warn, dash: "2 3" },
  decision: { stroke: INK.secondary, dash: "1 3" },
};

/** Legend as a single quiet line of text. */
export function ChartLegend({ items, className }: { items: { label: string; tone: SeriesTone; dashed?: boolean; band?: boolean }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground", className)}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          {i.band ? (
            <span className="inline-block h-2.5 w-3 rounded-[2px] bg-[#f0f0ee]" />
          ) : (
            <span className="inline-block w-3.5 border-t-[1.5px]" style={{ borderColor: TONES[i.tone], borderStyle: i.dashed ? "dashed" : "solid" }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

export type LineSeries = { key: string; name: string; tone?: SeriesTone; dashed?: boolean; width?: number; dots?: boolean; step?: boolean };

export function LineChartMono({
  data,
  xKey,
  series,
  yFormat = "num",
  height = 280,
  band,
  annotations = [],
  hLines = [],
  xFormat,
  xLabel,
  label,
  yDomain,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: LineSeries[];
  yFormat?: YFormat;
  height?: number;
  band?: { key: string; name: string };
  annotations?: Annotation[];
  hLines?: HLine[];
  xFormat?: (v: number) => string;
  xLabel?: string;
  label: string;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
}) {
  return (
    <ChartReveal>
      <div role="img" aria-label={label} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 18, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} tickFormatter={xFormat} minTickGap={24} label={xLabel ? { value: xLabel, position: "insideBottomRight", offset: -2, fill: INK.axis, fontSize: 11 } : undefined} />
            <YAxis {...axisProps} width={46} tickFormatter={(v) => tickY(v, yFormat)} domain={yDomain ?? ["auto", "auto"]} />
            <Tooltip content={<TooltipBox yFormat={yFormat} labelFormat={(l) => (xFormat && typeof l === "number" ? xFormat(l) : `${xLabel ?? xKey} ${typeof l === "number" ? l.toLocaleString() : l}`)} />} cursor={{ stroke: "#c4c4c0", strokeDasharray: "3 3" }} />
            {band && <Area type="monotone" dataKey={band.key} name={band.name} stroke="none" fill="#f0f0ee" fillOpacity={1} isAnimationActive={false} connectNulls />}
            {hLines.map((h) => (
              <ReferenceLine key={h.label} y={h.y} stroke={h.tone === "bad" ? INK.bad : h.tone === "warn" ? INK.warn : INK.secondary} strokeDasharray="4 4" label={{ value: h.label, position: "insideTopRight", fill: h.tone === "bad" ? INK.bad : h.tone === "warn" ? INK.warn : INK.axis, fontSize: 10.5 }} />
            ))}
            {annotations.map((a, i) => (
              <ReferenceLine
                key={`${a.x}-${i}`}
                x={a.x}
                stroke={ANN_STYLE[a.kind].stroke}
                strokeDasharray={ANN_STYLE[a.kind].dash}
                strokeWidth={1}
                label={{ value: a.label, position: "insideTopLeft", fill: ANN_STYLE[a.kind].stroke, fontSize: 10.5, offset: 4 }}
              />
            ))}
            {series.map((s) => (
              <Line
                key={s.key}
                type={s.step ? "stepAfter" : "monotone"}
                dataKey={s.key}
                name={s.name}
                stroke={TONES[s.tone ?? "primary"]}
                strokeWidth={s.width ?? (s.tone === "primary" || !s.tone ? 1.8 : 1.3)}
                strokeDasharray={s.dashed ? "5 4" : undefined}
                dot={s.dots ? { r: 2, strokeWidth: 0, fill: TONES[s.tone ?? "primary"] } : false}
                activeDot={{ r: 3.5, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartReveal>
  );
}

export function BarChartMono({
  data,
  xKey,
  bars,
  yFormat = "num",
  height = 260,
  stacked,
  layout = "horizontal",
  label,
  hLines = [],
}: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: { key: string; name: string; tone?: SeriesTone }[];
  yFormat?: YFormat;
  height?: number;
  stacked?: boolean;
  layout?: "horizontal" | "vertical";
  label: string;
  hLines?: HLine[];
}) {
  const vertical = layout === "vertical";
  return (
    <ChartReveal>
      <div role="img" aria-label={label} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout={layout} margin={{ top: 12, right: 12, left: vertical ? 4 : 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid stroke={INK.grid} vertical={vertical} horizontal={!vertical} />
            {vertical ? (
              <>
                <XAxis type="number" {...axisProps} tickFormatter={(v) => tickY(v, yFormat)} />
                <YAxis type="category" dataKey={xKey} {...axisProps} width={140} />
              </>
            ) : (
              <>
                <XAxis dataKey={xKey} {...axisProps} interval={0} tick={{ fill: INK.axis, fontSize: 10.5 }} />
                <YAxis {...axisProps} width={52} tickFormatter={(v) => tickY(v, yFormat)} />
              </>
            )}
            <Tooltip content={<TooltipBox yFormat={yFormat} />} cursor={{ fill: "rgba(10,10,10,0.03)" }} />
            {hLines.map((h) => (
              <ReferenceLine key={h.label} {...(vertical ? { x: h.y } : { y: h.y })} stroke={h.tone === "warn" ? INK.warn : INK.secondary} strokeDasharray="4 4" label={{ value: h.label, fill: h.tone === "warn" ? INK.warn : INK.axis, fontSize: 10.5, position: "insideTopRight" }} />
            ))}
            {bars.map((b) => (
              <Bar key={b.key} dataKey={b.key} name={b.name} fill={TONES[b.tone ?? "primary"]} stackId={stacked ? "s" : undefined} radius={stacked ? 0 : [2, 2, 0, 0]} isAnimationActive={false} maxBarSize={36} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartReveal>
  );
}

export function ScatterMono({ groups, height = 300, xFormat = "money", yFormat = "pct", label }: { groups: { name: string; tone: SeriesTone; points: { x: number; y: number; label: string }[]; emphasis?: boolean }[]; height?: number; xFormat?: YFormat; yFormat?: YFormat; label: string }) {
  return (
    <ChartReveal>
      <div role="img" aria-label={label} style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={INK.grid} />
            <XAxis type="number" dataKey="x" {...axisProps} tickFormatter={(v) => tickY(v, xFormat)} />
            <YAxis type="number" dataKey="y" {...axisProps} width={46} domain={["auto", "auto"]} tickFormatter={(v) => tickY(v, yFormat)} />
            <ZAxis range={[44, 44]} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-sm">
                    <div className="font-medium">{(payload[0].payload as { label: string }).label}</div>
                    <div className="text-muted-foreground tabular">
                      {fmtY((payload[0].payload as { x: number }).x, xFormat)} · {fmtY((payload[0].payload as { y: number }).y, yFormat)}
                    </div>
                  </div>
                ) : null
              }
            />
            {groups.map((g) => (
              <Scatter key={g.name} name={g.name} data={g.points} fill={TONES[g.tone]} shape={g.emphasis ? "diamond" : "circle"} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </ChartReveal>
  );
}

/** PSI heatmap: grayscale intensity, amber above the threshold (attention only). */
export function PsiHeatmap({ features, batches, values, threshold }: { features: string[]; batches: { row: number; batch: number }[]; values: (number | null)[][]; threshold: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const maxCols = 60;
  const start = Math.max(0, batches.length - maxCols);
  const cols = batches.slice(start);
  const color = (v: number | null) => {
    if (v == null || !Number.isFinite(v)) return "#f7f7f6";
    if (v >= threshold) return `rgba(161,92,0,${Math.min(0.85, 0.35 + v / (threshold * 4))})`;
    return `rgba(10,10,10,${Math.min(0.55, 0.04 + (v / threshold) * 0.45)})`;
  };
  return (
    <ChartReveal>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `minmax(96px,auto) repeat(${cols.length}, minmax(12px,1fr))` }} role="table" aria-label="PSI per feature and batch">
          {features.map((f, fi) => (
            <Fragment key={f}>
              <div role="rowheader" className="truncate pr-2 text-right font-mono text-[11px] leading-[14px] text-muted-foreground" title={f}>
                {f}
              </div>
              {cols.map((b, ci) => {
                const v = values[fi]?.[start + ci] ?? null;
                return (
                  <div
                    key={b.batch}
                    role="cell"
                    aria-label={`${f}, batch ${b.batch}: PSI ${v == null ? "n/a" : v.toFixed(3)}`}
                    onMouseEnter={() => setHover(`${f} · batch ${b.batch} · PSI ${v == null ? "n/a" : v.toFixed(3)}`)}
                    onMouseLeave={() => setHover(null)}
                    className="h-3.5 rounded-[2px]"
                    style={{ background: color(v) }}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-[2px]" style={{ background: color(threshold * 0.6) }} /> below {threshold}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-[2px]" style={{ background: color(threshold * 1.5) }} /> above threshold
        </span>
        <span className={cn("font-mono text-foreground", !hover && "opacity-0")}>{hover ?? "–"}</span>
        {start > 0 && <span>Latest {maxCols} batches</span>}
      </div>
    </ChartReveal>
  );
}

/** Confusion matrix with grayscale intensity; the diagonal is outlined. */
export function ConfusionMatrix({ labels, matrix, caption }: { labels: string[]; matrix: number[][]; caption?: ReactNode }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-[12px]" aria-label="Confusion matrix: rows are true classes, columns are predicted classes">
        <thead>
          <tr>
            <th className="px-2 text-left text-[11px] font-normal text-muted-foreground">true ↓ / predicted →</th>
            {labels.map((l) => (
              <th key={l} scope="col" className="max-w-24 truncate px-2 font-mono font-normal text-muted-foreground" title={l}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={labels[i]}>
              <th scope="row" className="max-w-24 truncate px-2 text-right font-mono font-normal text-muted-foreground" title={labels[i]}>
                {labels[i]}
              </th>
              {row.map((v, j) => {
                const a = v / max;
                return (
                  <td
                    key={j}
                    className={cn("h-9 min-w-12 rounded-[3px] px-2 text-center tabular", i === j && "ring-1 ring-foreground ring-inset")}
                    style={{ background: `rgba(10,10,10,${0.04 + a * 0.75})`, color: a > 0.5 ? "#fff" : "#0a0a0a" }}
                  >
                    {v.toLocaleString()}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <div className="mt-2 text-[12px] text-muted-foreground">{caption}</div>}
    </div>
  );
}
