/** Saved benchmark result sets: new runs in data/results, archived research runs in research/results. */
import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR } from "./config";
import { aggregate, parseCsv, type Summary } from "./experiments";

export const ARCHIVE_DIR = path.join(process.cwd(), "research", "results");
const SETS = [{ dir: RESULTS_DIR, source: "this app" }, { dir: ARCHIVE_DIR, source: "archived research run" }];

export interface ResultSet {
  prefix: string;
  source: string;
  dir: string;
  files: string[];
}

export function listResultSets(): ResultSet[] {
  const out: ResultSet[] = [];
  for (const { dir, source } of SETS) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir);
    for (const f of files.filter((x) => x.endsWith("_summary.csv")).sort()) {
      const prefix = f.slice(0, -"_summary.csv".length);
      if (out.some((s) => s.prefix === prefix)) continue;
      out.push({ prefix, source, dir, files: files.filter((x) => x.startsWith(`${prefix}_`)).sort() });
    }
  }
  return out;
}

export function loadResultSet(set: ResultSet): { summary: Summary[]; aggregate: Summary[] } {
  const summary = parseCsv(fs.readFileSync(path.join(set.dir, `${set.prefix}_summary.csv`), "utf-8")) as Summary[];
  return { summary, aggregate: aggregate(summary) };
}

/** Resolve a downloadable file of a known result set (no traversal: names must match the listing). */
export function resultFile(prefix: string, file: string): string | null {
  const set = listResultSets().find((s) => s.prefix === prefix);
  if (!set || !set.files.includes(file)) return null;
  return path.join(set.dir, file);
}
