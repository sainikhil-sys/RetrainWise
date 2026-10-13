"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SimpleBars, C } from "./charts";
import { Field, api, inputClass } from "./client";
import { Alert, KV, Table, Td, Th } from "./ui";

type Spec = { kind: "numeric"; edges: number[]; counts: number[] } | { kind: "categorical"; values: string[]; counts: number[] };
type Reference = {
  version: number;
  train_start: number;
  train_end: number;
  trained_until: number;
  n_train: number;
  seed: number;
  describe: { estimator: string; classes: string[]; numeric: string[]; categorical: string[]; hyperparameters: Record<string, unknown>; lineage: unknown[] };
  psi_reference: Record<string, Spec>;
};

const g = (v: number) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(2) : v.toPrecision(4));

function binLabels(spec: Spec): string[] {
  if (spec.kind === "numeric") {
    const e = spec.edges;
    return [`≤ ${g(e[0])}`, ...e.slice(0, -1).map((a, i) => `(${g(a)}, ${g(e[i + 1])}]`), `> ${g(e[e.length - 1])}`, "missing"];
  }
  return [...spec.values, "other/unseen", "missing"];
}

/** Loads the active model artifact (checksum-verified by the engine) and shows its fixed PSI reference bins. */
export function ReferenceWindow({ version, latestPsi }: { version: number; latestPsi: Record<string, number | null> }) {
  const [data, setData] = useState<Reference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feature, setFeature] = useState<string>("");

  useEffect(() => {
    let alive = true;
    api<Reference>(`/api/models/${version}/reference`)
      .then((r) => {
        if (!alive) return;
        setData(r);
        const features = Object.keys(r.psi_reference);
        const worst = features.slice().sort((a, b) => (latestPsi[b] ?? 0) - (latestPsi[a] ?? 0))[0];
        setFeature(worst ?? features[0] ?? "");
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [version, latestPsi]);

  const rows = useMemo(() => {
    if (!data || !feature) return [];
    const spec = data.psi_reference[feature];
    if (!spec) return [];
    const labels = binLabels(spec);
    const total = spec.counts.reduce((s, c) => s + c, 0) || 1;
    return labels.map((label, i) => ({ bin: label, count: spec.counts[i] ?? 0, share: (spec.counts[i] ?? 0) / total }));
  }, [data, feature]);

  if (error) return <Alert tone="bad" title="Could not load the model artifact">{error}</Alert>;
  if (!data)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading model artifact and verifying its SHA-256…
      </div>
    );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <KV
          className="sm:grid-cols-1"
          items={[
            ["Model version", `v${String(data.version).padStart(3, "0")} (${data.describe.estimator})`],
            ["Training rows", `${data.train_start.toLocaleString()} – ${data.train_end.toLocaleString()} (${data.n_train.toLocaleString()} rows)`],
            ["Has learned up to row", data.trained_until.toLocaleString()],
            ["Classes", data.describe.classes.join(", ")],
            ["Numeric features", String(data.describe.numeric.length)],
            ["Categorical features", String(data.describe.categorical.length)],
            ["Seed", String(data.seed)],
          ]}
        />
        <p className="text-xs leading-relaxed text-slate-500">
          PSI bins are quantiles fixed from this model&apos;s training window, so drift is always measured against what the model actually learned from. A new version brings new reference bins.
        </p>
      </div>
      <div className="space-y-3">
        <Field label="Feature" htmlFor="ref-feature" help="Sorted list; the most drifted feature in the latest batch is selected first.">
          <select id="ref-feature" className={inputClass} value={feature} onChange={(e) => setFeature(e.target.value)}>
            {Object.keys(data.psi_reference)
              .sort()
              .map((f) => (
                <option key={f} value={f}>
                  {f} {latestPsi[f] != null ? `(latest PSI ${(latestPsi[f] as number).toFixed(3)})` : ""}
                </option>
              ))}
          </select>
        </Field>
        <SimpleBars data={rows} xKey="bin" bars={[{ key: "share", name: "Reference share", color: C.teal }]} percent height={220} label={`Reference distribution of ${feature}`} />
        <Table caption="Reference bins">
          <thead>
            <tr>
              <Th>Bin</Th>
              <Th align="right">Reference count</Th>
              <Th align="right">Share</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bin}>
                <Td mono>{r.bin}</Td>
                <Td align="right">{r.count.toLocaleString()}</Td>
                <Td align="right">{(r.share * 100).toFixed(1)}%</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
