import "server-only";

import fs from "node:fs";
import path from "node:path";

/** Rows of a reference benchmark aggregate (engine/<prefix>_aggregate.csv), read as-is. */
export type AggRow = {
  dataset: string;
  regime: string;
  policy: string;
  accuracy: number;
  total: number;
  operational: number;
  error: number;
  fullUpdates: number;
  partialUpdates: number;
  gapPct: number;
  seeds: number;
};

const ENGINE = path.join(process.cwd(), "engine");

function parseCsv(text: string): Record<string, string>[] {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.filter(Boolean).map((l) => {
    const v = l.split(",");
    return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ""]));
  });
}

/** Returns null when the result set is not present (it is not shipped in every deployment). */
export function readAggregate(prefix: "results" | "results_v2" | "results_full"): AggRow[] | null {
  const file = path.join(ENGINE, `${prefix}_aggregate.csv`);
  if (!fs.existsSync(file)) return null;
  const n = (x: string) => (x === "" ? NaN : Number(x));
  return parseCsv(fs.readFileSync(file, "utf8")).map((r) => ({
    dataset: r.dataset,
    regime: r.regime,
    policy: r.policy,
    accuracy: n(r.accuracy_mean),
    total: n(r.total_cost_mean),
    operational: n(r.operational_cost_mean),
    error: n(r.error_cost_mean),
    fullUpdates: n(r.full_updates_mean),
    partialUpdates: n(r.partial_updates_mean),
    gapPct: n(r.tco_vs_best_online_pct),
    seeds: n(r.seeds),
  }));
}

/** Cell-level winners among online policies (the hindsight oracle is excluded). */
export function winners(rows: AggRow[]) {
  const cells = new Map<string, AggRow[]>();
  for (const r of rows) {
    if (r.policy === "hindsight_oracle") continue;
    const k = `${r.dataset}|${r.regime}`;
    cells.set(k, [...(cells.get(k) ?? []), r]);
  }
  return [...cells.entries()].map(([k, rs]) => {
    const best = rs.reduce((a, b) => (b.total < a.total ? b : a));
    const rw = rs.find((r) => r.policy === "retrainwise");
    const [dataset, regime] = k.split("|");
    return { dataset, regime, best: best.policy, bestTotal: best.total, retrainwiseTotal: rw?.total ?? NaN, retrainwiseGap: rw?.gapPct ?? NaN };
  });
}
