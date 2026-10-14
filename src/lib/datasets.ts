/**
 * Dataset acquisition, caching, provenance and the reproducible synthetic stream.
 *
 * - Real datasets are only obtained through the explicit `download` function
 *   (the Data and simulation page, or `npm run datasets -- electricity`).
 * - `loadDataset` never substitutes synthetic data for a missing real dataset;
 *   it throws with the command needed to fetch it.
 * - Rows are kept in source order. Each source documents whether that order is
 *   a genuine time order or a stream replay.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { unzipSync } from "fflate";
import { DATASETS_DIR, SAMPLE_SIZES } from "./config";
import { now } from "./db";
import { emptyFrame, type Frame, type Kind } from "./ml/frame";
import { Rng } from "./rng";

const USER_AGENT = "RetrainWise/2.0 (research prototype)";

const COVERTYPE_COLUMNS = [
  "Elevation", "Aspect", "Slope", "Horizontal_Distance_To_Hydrology", "Vertical_Distance_To_Hydrology",
  "Horizontal_Distance_To_Roadways", "Hillshade_9am", "Hillshade_Noon", "Hillshade_3pm",
  "Horizontal_Distance_To_Fire_Points",
  ...Array.from({ length: 4 }, (_, i) => `Wilderness_Area${i + 1}`),
  ...Array.from({ length: 40 }, (_, i) => `Soil_Type${i + 1}`),
];

export interface Source {
  title: string;
  page: string;
  expected_target: string;
  drop_features: string[];
  categorical_features: string[];
  order: string;
  drop_reason: string;
  citation: string;
  openml_id?: number;
  metadata_url?: string;
  download_url?: string;
  licence?: string;
}

export const SOURCES: Record<string, Source> = {
  electricity: {
    title: "Electricity (Elec2, elecNormNew)", openml_id: 151, page: "https://www.openml.org/d/151",
    metadata_url: "https://www.openml.org/api/v1/json/data/151", expected_target: "class",
    drop_features: ["date"], categorical_features: ["day"],
    order: "Chronological. Rows are 30-minute observations of the Australian New South Wales electricity market " +
      "(May 1996 - Dec 1998) in source order.",
    drop_reason: "'date' is a monotonically increasing normalised timestamp. It is kept in the cache but excluded " +
      "from model features so the deployed model cannot key on stream position and so PSI is not trivially " +
      "triggered by time.",
    citation: "Harries, M. (1999). SPLICE-2 comparative evaluation: Electricity pricing. Tech. report, UNSW. " +
      "Normalised version distributed via MOA/OpenML.",
  },
  airlines: {
    title: "Airlines (flight delay)", openml_id: 1169, page: "https://www.openml.org/d/1169",
    metadata_url: "https://www.openml.org/api/v1/json/data/1169", expected_target: "Delay", drop_features: [],
    categorical_features: ["Airline", "AirportFrom", "AirportTo", "DayOfWeek"],
    order: "Stream replay in source order. The data set is commonly used as a drift stream (MOA/Ikonomovska " +
      "version); rows are not guaranteed to be strictly time-sorted, so RetrainWise treats it as an ordered " +
      "replay, not a verified chronology.",
    drop_reason: "",
    citation: "Ikonomovska, E. Airline dataset (derived from the 2009 Data Expo / US BTS data), distributed via " +
      "MOA and OpenML.",
  },
  covertype: {
    title: "Covertype (forest cover type)", page: "https://archive.ics.uci.edu/dataset/31/covertype",
    download_url: "https://archive.ics.uci.edu/static/public/31/covertype.zip", expected_target: "Cover_Type",
    drop_features: [], categorical_features: [],
    order: "Stream replay in source order. Observations are 30x30 m cartographic cells, not time-stamped events; " +
      "ordering follows the UCI file, as in the stream-learning literature that replays it as a stream.",
    drop_reason: "", licence: "CC BY 4.0",
    citation: "Blackard, J. (1998). Covertype [Dataset]. UCI Machine Learning Repository. " +
      "https://doi.org/10.24432/C50K5N",
  },
};
export const DATASETS = ["synthetic", ...Object.keys(SOURCES)];

export function cachePath(name: string): string {
  return path.join(DATASETS_DIR, `${name}.csv.gz`);
}

export function provenancePath(name: string): string {
  return path.join(DATASETS_DIR, `${name}_provenance.json`);
}

export function isCached(name: string): boolean {
  return name === "synthetic" || fs.existsSync(cachePath(name));
}

async function fetchBytes(url: string, timeoutMs = 180_000): Promise<Buffer> {
  if (!url.startsWith("https://")) throw new Error("Only HTTPS downloads are allowed");
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} from ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// --------------------------------------------------------------------- parsing
function splitValues(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\" && i + 1 < line.length) cur += line[++i];
      else if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

interface Table {
  columns: string[];
  categorical: Set<string>;
  rows: (string | null)[][];
}

/** Minimal dense ARFF reader (numeric and nominal attributes; '?' is missing). */
export function parseArff(text: string): Table {
  const columns: string[] = [];
  const categorical = new Set<string>();
  const rows: (string | null)[][] = [];
  let inData = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("%")) continue;
    if (!inData) {
      const lower = line.toLowerCase();
      if (lower.startsWith("@attribute")) {
        const m = line.match(/^@attribute\s+('([^']*)'|"([^"]*)"|(\S+))\s+(.+)$/i);
        if (!m) throw new Error(`Cannot parse ARFF attribute: ${line}`);
        const name = m[2] ?? m[3] ?? m[4];
        columns.push(name);
        if (m[5].trim().startsWith("{") || /^(string|date)/i.test(m[5].trim())) categorical.add(name);
      } else if (lower.startsWith("@data")) inData = true;
      continue;
    }
    if (line.startsWith("{")) throw new Error("Sparse ARFF data is not supported");
    const values = splitValues(line);
    if (values.length !== columns.length) throw new Error(`ARFF row has ${values.length} values, expected ${columns.length}`);
    rows.push(values.map((v) => (v === "?" || v === "" ? null : v)));
  }
  return { columns, categorical, rows };
}

function csvQuote(v: string | null): string {
  if (v === null) return "";
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function labelText(v: string): string {
  const num = Number(v);
  return v.trim() !== "" && Number.isFinite(num) && Number.isInteger(num) ? String(num) : v;
}

// -------------------------------------------------------------------- download
export async function download(name: string): Promise<Record<string, unknown>> {
  const source = SOURCES[name];
  if (!source) throw new Error(`Unknown real dataset ${name}; choose from ${Object.keys(SOURCES).join(", ")}`);
  const prov: Record<string, unknown> = { ...source };
  let raw: Buffer;
  let table: Table;
  let target: string;
  if (source.openml_id) {
    const meta = JSON.parse((await fetchBytes(source.metadata_url!)).toString("utf-8")).data_set_description;
    raw = await fetchBytes(meta.url);
    table = parseArff(raw.toString("utf-8"));
    target = meta.default_target_attribute || source.expected_target;
    Object.assign(prov, { download_url: meta.url, openml_name: meta.name, openml_version: meta.version,
      licence: meta.licence || "not stated by OpenML", openml_md5_checksum: meta.md5_checksum,
      file_format: meta.format || "ARFF" });
  } else {
    raw = await fetchBytes(source.download_url!);
    const archive = unzipSync(new Uint8Array(raw));
    const member = Object.keys(archive).find((m) => m.endsWith("covtype.data.gz"));
    if (!member) throw new Error("covtype.data.gz not found in the UCI archive");
    const text = zlib.gunzipSync(Buffer.from(archive[member])).toString("utf-8");
    const rows = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(","));
    if (rows[0]?.length !== 55) throw new Error(`Unexpected Covertype width ${rows[0]?.length}`);
    table = { columns: [...COVERTYPE_COLUMNS, "Cover_Type"], categorical: new Set(), rows };
    target = "Cover_Type";
    Object.assign(prov, { archive_member: member, file_format: "CSV (gzip) inside ZIP" });
  }
  const ti = table.columns.indexOf(target);
  if (ti < 0) throw new Error(`Target column ${target} not found`);
  if (table.rows.some((r) => r[ti] === null)) throw new Error("Source contains missing targets; refusing to cache silently");
  const columns = table.columns.map((c, i) => (i === ti ? "target" : c));
  const lines = [columns.map(csvQuote).join(",")];
  const classCounts: Record<string, number> = {};
  let missing = 0;
  for (const r of table.rows) {
    const out = r.map((v, i) => (i === ti ? labelText(v as string) : v));
    classCounts[out[ti] as string] = (classCounts[out[ti] as string] || 0) + 1;
    missing += out.filter((v, i) => i !== ti && v === null).length;
    lines.push(out.map(csvQuote).join(","));
  }
  fs.mkdirSync(DATASETS_DIR, { recursive: true });
  const gz = zlib.gzipSync(Buffer.from(lines.join("\n") + "\n", "utf-8"));
  const file = cachePath(name);
  fs.writeFileSync(`${file}.tmp`, gz);
  fs.renameSync(`${file}.tmp`, file);
  const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
  Object.assign(prov, {
    dataset: name, retrieved_utc: now(), raw_sha256: sha(raw), raw_bytes: raw.length, cache_file: path.basename(file),
    cache_sha256: sha(gz), target_column: target, rows: table.rows.length, columns,
    categorical_columns: columns.filter((c) => table.categorical.has(c) && c !== "target"),
    class_counts: Object.fromEntries(Object.entries(classCounts).sort()), missing_values: missing,
    preprocessing: "Cached as-is in source order with the target renamed to 'target' and labels stored as text. " +
      "Imputation, scaling and one-hot encoding are fitted only on each model's own training window.",
    usage_note: "Research/educational use; re-check the licence on the source page before redistribution.",
    regenerate: `npm run datasets -- ${name}`,
  });
  fs.writeFileSync(provenancePath(name), JSON.stringify(prov, null, 2));
  return prov;
}

export function readProvenance(name: string): Record<string, unknown> | null {
  if (name === "synthetic") return syntheticMetadata();
  const file = provenancePath(name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
}

// --------------------------------------------------------------------- synthetic
export const SYNTHETIC_SEGMENTS = { abrupt: 0.2, gradual_start: 0.4, gradual_end: 0.6, recurring: 0.7, covariate_only: 0.85 };

export function syntheticMetadata(n = 20_000, seed = 42): Record<string, unknown> {
  return {
    dataset: "synthetic", title: "Synthetic drift stream (generated locally)", generator: "synthetic(n, seed)",
    rows: n, seed, order: "Chronological by construction; row i is time step i.",
    drift_points: Object.fromEntries(Object.entries(SYNTHETIC_SEGMENTS).map(([k, v]) => [k, Math.trunc(v * n)])),
    description: {
      abrupt: "Concept A -> B at 'abrupt' (sign of x0 inverted).",
      gradual: "B -> C between 'gradual_start' and 'gradual_end' (mixture probability ramps linearly).",
      recurring: "C -> A at 'recurring' (original concept returns).",
      covariate_only: "From 'covariate_only', x3 and x4 shift in distribution but do not affect y (PSI should rise " +
        "without predictive degradation).",
      unseen_category: "Category 'west' first appears at 'gradual_start'.",
      missing: "About 2% of x5 values are missing throughout.",
    },
    licence: "Generated by this project; no external data.", target_column: "target",
  };
}

export function synthetic(n = 20_000, seed = 42): Frame {
  if (n < 200) throw new Error("Synthetic stream needs at least 200 rows");
  const rng = new Rng(seed);
  const features = ["x0", "x1", "x2", "x3", "x4", "x5", "region"];
  const kinds: Record<string, Kind> = Object.fromEntries(features.map((f) => [f, f === "region" ? "categorical" : "numeric"]));
  const frame = emptyFrame(features, kinds, n);
  const s = SYNTHETIC_SEGMENTS;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const x = Array.from({ length: 6 }, () => rng.normal());
    if (t >= s.covariate_only) {
      x[3] = x[3] + 1.5;
      x[4] = x[4] * 2.0;
    }
    const conceptA = x[0] + 0.5 * x[1];
    const conceptB = -x[0] + 0.5 * x[1];
    const conceptC = x[2] - 0.5 * x[1];
    const ramp = Math.min(1, Math.max(0, (t - s.gradual_start) / (s.gradual_end - s.gradual_start)));
    const useC = rng.random() < ramp;
    const score = t < s.abrupt ? conceptA : t < s.gradual_start ? conceptB : t < s.recurring ? (useC ? conceptC : conceptB)
      : conceptA;
    const y = score + rng.normal(0, 0.35) > 0;
    let region = rng.choice(["north", "south", "east"], [0.4, 0.35, 0.25]);
    if (t >= s.gradual_start && rng.random() < 0.2) region = "west";
    for (let j = 0; j < 6; j++) frame.numeric[`x${j}`][i] = x[j];
    if (rng.random() < 0.02) frame.numeric.x5[i] = Number.NaN;
    frame.categorical.region[i] = region;
    frame.target[i] = y ? "positive" : "negative";
  }
  return frame;
}

// ------------------------------------------------------------------------- load
export function resolveSize(size: string | number | null): number | null {
  if (size === null || typeof size === "number") {
    if (size !== null && size < 200) throw new Error("Sample size must be at least 200 rows");
    return size;
  }
  if (!(size in SAMPLE_SIZES)) throw new Error(`Unknown size ${size}; choose from ${Object.keys(SAMPLE_SIZES).join(", ")}`);
  return SAMPLE_SIZES[size];
}

/** The first `size` rows in source order with a `target` column. The seed only affects the synthetic generator. */
export function loadDataset(name: string, size: string | number | null = "standard", seed = 42): Frame {
  const n = resolveSize(size);
  if (name === "synthetic") return synthetic(n ?? 50_000, seed);
  const source = SOURCES[name];
  if (!source) throw new Error(`Unknown dataset ${name}; choose from ${DATASETS.join(", ")}`);
  const file = cachePath(name);
  if (!fs.existsSync(file)) {
    throw new Error(`${name} is not cached. Download it explicitly (Data and simulation page, or ` +
      `\`npm run datasets -- ${name}\`). Synthetic data is never substituted.`);
  }
  const lines = zlib.gunzipSync(fs.readFileSync(file)).toString("utf-8").split("\n");
  const header = parseCsvLine(lines[0]);
  const body: string[][] = [];
  for (let i = 1; i < lines.length && (n === null || body.length < n); i++) if (lines[i]) body.push(parseCsvLine(lines[i]));
  const ti = header.indexOf("target");
  if (ti < 0) throw new Error(`Cached ${name} file has no target column`);
  const keep = header.map((c, i) => [c, i] as const).filter(([c]) => c !== "target" && !source.drop_features.includes(c));
  const prov = readProvenance(name);
  const declared = new Set([...(source.categorical_features || []), ...((prov?.categorical_columns as string[]) || [])]);
  const kinds: Record<string, Kind> = {};
  for (const [c, i] of keep) {
    kinds[c] = declared.has(c) || body.some((r) => r[i] !== "" && !Number.isFinite(Number(r[i]))) ? "categorical" : "numeric";
  }
  const frame = emptyFrame(keep.map(([c]) => c), kinds, body.length);
  body.forEach((r, row) => {
    for (const [c, i] of keep) {
      const v = r[i];
      if (kinds[c] === "numeric") frame.numeric[c][row] = v === "" ? Number.NaN : Number(v);
      else frame.categorical[c][row] = v === "" ? null : labelText(v);
    }
    frame.target[row] = r[ti];
  });
  return frame;
}
