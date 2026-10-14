"use client";

import { Area, Bar, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter,
  Tooltip, XAxis, YAxis } from "recharts";
import { SERIES } from "@/lib/palette";

export interface Series {
  key: string;
  name: string;
  color: string;
  kind?: "line" | "bar" | "scatter" | "band";
  dashed?: boolean;
  stack?: string;
  /** For bands: key holding [lo, hi]. For bars: key holding [minus, plus] error extents. */
  errorKey?: string;
  shape?: "triangle" | "cross" | "circle" | "diamond";
}

type Row = Record<string, unknown>;

const fmtTick = (v: unknown) => (typeof v === "number" ? (Math.abs(v) >= 1000 ? v.toLocaleString("en-US") :
  Number(v.toFixed(3)).toString()) : String(v));

export function Chart({ title, data, x, series, height = 300, verticalLines = [], yLabel, money = false }: {
  title: string; data: Row[]; x: string; series: Series[]; height?: number; verticalLines?: number[]; yLabel?: string;
  money?: boolean;
}) {
  const fmt = (v: unknown) => (typeof v === "number" ? (money ? `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
    : fmtTick(v)) : Array.isArray(v) ? v.map(fmtTick).join(" – ") : String(v ?? "—"));
  return (
    <figure className="card" style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600, fontSize: "0.92rem", marginBottom: 6 }}>{title}</figcaption>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid stroke="rgba(128,128,128,0.22)" vertical={false} />
            <XAxis dataKey={x} tickFormatter={fmtTick} fontSize={11} stroke="currentColor" opacity={0.7} />
            <YAxis tickFormatter={money ? (v) => `$${fmtTick(v)}` : fmtTick} fontSize={11} stroke="currentColor"
              opacity={0.7} width={60} label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
            <Tooltip formatter={(v, name) => [fmt(v), name]} labelFormatter={(l) => `${x}: ${fmtTick(l)}`}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {verticalLines.map((v) => <ReferenceLine key={v} x={v} stroke={SERIES.green} strokeDasharray="4 3" />)}
            {series.map((s) => {
              if (s.kind === "band") {
                return <Area key={s.key} dataKey={s.key} name={s.name} stroke="none" fill={s.color} fillOpacity={0.15}
                  isAnimationActive={false} connectNulls />;
              }
              if (s.kind === "bar") {
                return (
                  <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={s.stack} isAnimationActive={false}>
                    {s.errorKey ? <ErrorBar dataKey={s.errorKey} width={4} strokeWidth={1.2} stroke="currentColor" /> : null}
                  </Bar>
                );
              }
              if (s.kind === "scatter") {
                return <Scatter key={s.key} dataKey={s.key} name={s.name} fill={s.color} shape={s.shape ?? "circle"}
                  isAnimationActive={false} />;
              }
              return <Line key={s.key} dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={data.length < 40}
                strokeDasharray={s.dashed ? "5 4" : undefined} isAnimationActive={false} connectNulls />;
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
