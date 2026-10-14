/**
 * Schema alignment and preprocessing fitted on a training window only.
 *
 * `fitTransformer` is only ever called with the rows of the window a model is
 * trained on, so imputation medians, scaling statistics and category
 * vocabularies never see later observations. Incremental updates reuse the
 * frozen transformer.
 */
import type { Frame } from "./frame";

export const MAX_CATEGORIES = 200; // rarest categories beyond this are grouped as infrequent
const MISSING = "__missing__";

export interface Schema {
  features: string[];
  numeric: string[];
  categorical: string[];
}

export interface SchemaIssues {
  missing_columns: string[];
  unexpected_columns: string[];
  coerced_values: number;
}

export interface Transformer {
  numeric: { name: string; median: number; mean: number; scale: number }[];
  categorical: { name: string; categories: string[]; infrequent: boolean; offset: number }[];
  numDim: number;
  dim: number;
}

/** Dense numeric block plus one active one-hot index per categorical column (-1 = none). */
export interface Encoded {
  n: number;
  numDim: number;
  catCols: number;
  dense: Float64Array;
  cats: Int32Array;
  dim: number;
}

export function inferSchema(frame: Frame): Schema {
  if (new Set(frame.features).size !== frame.features.length) throw new Error("Duplicate feature columns");
  if (frame.features.includes("target")) throw new Error("Schema must not include the target column");
  return {
    features: [...frame.features],
    numeric: frame.features.filter((f) => frame.kinds[f] === "numeric"),
    categorical: frame.features.filter((f) => frame.kinds[f] !== "numeric"),
  };
}

/** Report how a frame differs from the training schema. Missing columns are imputed, extras ignored. */
export function schemaIssues(frame: Frame, schema: Schema): SchemaIssues {
  return {
    missing_columns: schema.features.filter((f) => !frame.features.includes(f)),
    unexpected_columns: frame.features.filter((f) => !schema.features.includes(f)),
    coerced_values: 0,
  };
}

function numericValues(frame: Frame, name: string, rows: number[]): number[] {
  const col = frame.numeric[name];
  const out: number[] = [];
  if (!col) return out;
  for (const r of rows) {
    const v = col[r];
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function categoryOf(frame: Frame, name: string, row: number): string {
  const col = frame.categorical[name];
  const v = col ? col[row] : null;
  return v === null || v === undefined ? MISSING : v;
}

export function fitTransformer(frame: Frame, rows: number[], schema: Schema): Transformer {
  if (!schema.numeric.length && !schema.categorical.length) throw new Error("No usable features");
  const numeric = schema.numeric.map((name) => {
    const present = numericValues(frame, name, rows);
    const med = median(present);
    // StandardScaler statistics on imputed values (population standard deviation).
    let sum = 0;
    for (const r of rows) {
      const v = frame.numeric[name]?.[r];
      sum += Number.isFinite(v) ? (v as number) : med;
    }
    const mean = rows.length ? sum / rows.length : 0;
    let ss = 0;
    for (const r of rows) {
      const v = frame.numeric[name]?.[r];
      const x = Number.isFinite(v) ? (v as number) : med;
      ss += (x - mean) ** 2;
    }
    const sd = rows.length ? Math.sqrt(ss / rows.length) : 0;
    return { name, median: med, mean, scale: sd > 1e-12 ? sd : 1 };
  });
  let offset = numeric.length;
  const categorical = schema.categorical.map((name) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = categoryOf(frame, name, r);
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    let categories = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((e) => e[0]);
    const infrequent = categories.length > MAX_CATEGORIES;
    if (infrequent) categories = categories.slice(0, MAX_CATEGORIES - 1);
    const item = { name, categories, infrequent, offset };
    offset += categories.length + (infrequent ? 1 : 0);
    return item;
  });
  return { numeric, categorical, numDim: numeric.length, dim: offset };
}

export function encode(t: Transformer, frame: Frame, rows: number[]): Encoded {
  const n = rows.length;
  const dense = new Float64Array(n * t.numDim);
  const cats = new Int32Array(n * t.categorical.length).fill(-1);
  const lookups = t.categorical.map((c) => new Map(c.categories.map((v, i) => [v, c.offset + i])));
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    for (let j = 0; j < t.numDim; j++) {
      const spec = t.numeric[j];
      const col = frame.numeric[spec.name];
      const v = col ? col[r] : Number.NaN;
      const x = Number.isFinite(v) ? v : spec.median;
      dense[i * t.numDim + j] = (x - spec.mean) / spec.scale;
    }
    for (let j = 0; j < t.categorical.length; j++) {
      const spec = t.categorical[j];
      const value = categoryOf(frame, spec.name, r);
      const idx = lookups[j].get(value);
      // Unknown or infrequent values map to the infrequent column when it exists, otherwise to nothing.
      cats[i * t.categorical.length + j] = idx ?? (spec.infrequent ? spec.offset + spec.categories.length : -1);
    }
  }
  return { n, numDim: t.numDim, catCols: t.categorical.length, dense, cats, dim: t.dim };
}

/** Share of categorical cells whose value was absent from the training window. */
export function unseenCategoryRate(frame: Frame, rows: number[], schema: Schema,
  vocab: Record<string, string[]>): number {
  let cells = 0;
  let unseen = 0;
  for (const col of schema.categorical) {
    const values = frame.categorical[col];
    if (!values) continue;
    const known = new Set(vocab[col] || []);
    for (const r of rows) {
      const v = values[r];
      if (v === null || v === undefined) continue;
      cells += 1;
      if (!known.has(v)) unseen += 1;
    }
  }
  return cells ? unseen / cells : 0;
}

export function categoryVocabulary(frame: Frame, rows: number[], schema: Schema): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const col of schema.categorical) {
    const set = new Set<string>();
    for (const r of rows) {
      const v = frame.categorical[col]?.[r];
      if (v !== null && v !== undefined) set.add(v);
    }
    out[col] = [...set].sort().slice(0, 5_000);
  }
  return out;
}
