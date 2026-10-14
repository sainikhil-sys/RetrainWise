/**
 * Column-oriented data frame used throughout the ML layer. Rows are addressed
 * by their stream index (0..length-1), which is also their chronological order.
 * Numeric missing values are NaN; categorical missing values are null.
 */
import crypto from "node:crypto";

export type Kind = "numeric" | "categorical";

export interface Frame {
  length: number;
  features: string[];
  kinds: Record<string, Kind>;
  numeric: Record<string, Float64Array>;
  categorical: Record<string, (string | null)[]>;
  target: string[];
}

export function emptyFrame(features: string[], kinds: Record<string, Kind>, length: number): Frame {
  const frame: Frame = { length, features, kinds, numeric: {}, categorical: {}, target: new Array(length).fill("") };
  for (const f of features) {
    if (kinds[f] === "numeric") frame.numeric[f] = new Float64Array(length).fill(Number.NaN);
    else frame.categorical[f] = new Array(length).fill(null);
  }
  return frame;
}

/** First `n` rows (a copy), keeping column kinds. */
export function headFrame(frame: Frame, n: number): Frame {
  const len = Math.min(n, frame.length);
  const out: Frame = { length: len, features: [...frame.features], kinds: { ...frame.kinds }, numeric: {},
    categorical: {}, target: frame.target.slice(0, len) };
  for (const [k, v] of Object.entries(frame.numeric)) out.numeric[k] = v.slice(0, len);
  for (const [k, v] of Object.entries(frame.categorical)) out.categorical[k] = v.slice(0, len);
  return out;
}

export function cell(frame: Frame, feature: string, row: number): number | string | null {
  if (frame.kinds[feature] === "numeric") {
    const v = frame.numeric[feature][row];
    return Number.isNaN(v) ? null : v;
  }
  return frame.categorical[feature][row];
}

export function records(frame: Frame, rows: number[]): Record<string, number | string | null>[] {
  return rows.map((r) => {
    const rec: Record<string, number | string | null> = {};
    for (const f of frame.features) rec[f] = cell(frame, f, r);
    rec.target = frame.target[r];
    return rec;
  });
}

export function range(start: number, stop: number): number[] {
  const out = new Array(Math.max(0, stop - start));
  for (let i = 0; i < out.length; i++) out[i] = start + i;
  return out;
}

/** Content hash of the frame (feature order, kinds, values and targets). */
export function frameSha256(frame: Frame): string {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify({ features: frame.features, kinds: frame.kinds, length: frame.length }));
  for (const f of frame.features) {
    if (frame.kinds[f] === "numeric") h.update(Buffer.from(frame.numeric[f].buffer, frame.numeric[f].byteOffset,
      frame.numeric[f].byteLength));
    else h.update(JSON.stringify(frame.categorical[f]));
  }
  h.update(JSON.stringify(frame.target));
  return h.digest("hex");
}

export interface SchemaColumn {
  column: string;
  dtype: string;
  missing: number;
  unique: number;
  role: string;
}

export function schemaPreview(frame: Frame): SchemaColumn[] {
  const out: SchemaColumn[] = frame.features.map((f) => {
    const values = frame.kinds[f] === "numeric" ? Array.from(frame.numeric[f]) : frame.categorical[f];
    const present = values.filter((v) => v !== null && !(typeof v === "number" && Number.isNaN(v)));
    return { column: f, dtype: frame.kinds[f] === "numeric" ? "float64" : "text", missing: values.length - present.length,
      unique: new Set(present).size, role: frame.kinds[f] };
  });
  out.push({ column: "target", dtype: "text", missing: 0, unique: new Set(frame.target).size, role: "target" });
  return out;
}
