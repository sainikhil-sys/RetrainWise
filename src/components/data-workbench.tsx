"use client";

import { CheckCircle2, CloudDownload, Database, ExternalLink, FileSearch, HardDrive, Loader2, Play, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { DATASET_INFO, SIZES, type DatasetName, type SizeName } from "@/lib/catalog";
import { Button, Field, Tabs, api, inputClass, useAction } from "./client";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, KV, SimLabel, Table, Td, Th, cn } from "./ui";

export type DatasetEntry = {
  name: DatasetName;
  cached: boolean;
  synthetic: boolean;
  title: string;
  page: string | null;
  order: string | null;
  drop_reason: string | null;
  citation: string | null;
  licence: string | null;
  provenance: Record<string, unknown> | null;
};

type Preview = {
  schema: { column: string; dtype: string; missing: number; unique: number; role: string }[];
  rows: Record<string, unknown>[];
  columns: string[];
  preview_rows: number;
  class_balance: { label: string; count: number }[];
  synthetic: { drift_points: Record<string, number>; description: Record<string, string> } | null;
};

const SIZE_LABEL: Record<SizeName, string> = { small: "Small · first 5,000 rows", standard: "Standard · first 20,000 rows", full: "Full · all rows" };

function cell(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v);
}

export function DataWorkbench({ datasets, defaultSeed, hasActiveRun, activeRunId }: { datasets: DatasetEntry[]; defaultSeed: number; hasActiveRun: boolean; activeRunId: string | null }) {
  const [name, setName] = useState<DatasetName>("synthetic");
  const [size, setSize] = useState<SizeName>("standard");
  const [seed, setSeed] = useState<string>(String(defaultSeed));
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const download = useAction();
  const start = useAction();

  const entry = datasets.find((d) => d.name === name)!;
  const seedNum = Number(seed);
  const seedValid = seed.trim() !== "" && Number.isInteger(seedNum) && seedNum >= 0 && seedNum <= 2_147_483_647;

  useEffect(() => {
    if (!entry.cached || !seedValid) {
      setPreview(null);
      return;
    }
    const ctrl = new AbortController();
    setLoadingPreview(true);
    setPreviewError(null);
    const t = setTimeout(() => {
      api<Preview>(`/api/datasets/${name}/preview?size=${size}&seed=${seedNum}`, { signal: ctrl.signal })
        .then(setPreview)
        .catch((e: Error) => {
          if (e.name !== "AbortError") setPreviewError(e.message);
        })
        .finally(() => setLoadingPreview(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [name, size, seedNum, seedValid, entry.cached]);

  const prov = entry.provenance;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <div className="space-y-6 xl:col-span-2">
        <Card>
          <CardHeader title="1 · Dataset" icon={Database} description="Real datasets are downloaded explicitly from their original source. Synthetic data is never substituted for a missing real dataset." />
          <CardBody>
            <div role="radiogroup" aria-label="Dataset" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              {datasets.map((d) => {
                const info = DATASET_INFO[d.name];
                const selected = d.name === name;
                return (
                  <button
                    key={d.name}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setName(d.name)}
                    className={cn(
                      "rounded-xl border p-3.5 text-left transition-colors",
                      selected ? "border-teal-400/60 bg-teal-400/[0.07] ring-1 ring-teal-400/30" : "border-slate-800 hover:border-slate-600 hover:bg-slate-800/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium text-slate-100">
                        {d.synthetic ? <Sparkles className="h-4 w-4 text-violet-300" aria-hidden /> : <HardDrive className="h-4 w-4 text-sky-300" aria-hidden />}
                        {info.title}
                      </span>
                      {d.synthetic ? <Badge tone="info">synthetic</Badge> : d.cached ? <Badge tone="good">cached</Badge> : <Badge tone="warn">not downloaded</Badge>}
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{info.blurb}</p>
                  </button>
                );
              })}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2 · Configure and start" icon={Play} />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sample size" htmlFor="size" help="Rows taken from the start of the source-ordered stream.">
                <select id="size" className={inputClass} value={size} onChange={(e) => setSize(e.target.value as SizeName)}>
                  {(Object.keys(SIZES) as SizeName[]).map((s) => (
                    <option key={s} value={s}>
                      {SIZE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Seed" htmlFor="seed" error={seedValid ? null : "Enter a whole number between 0 and 2147483647."} help="Controls SGD randomness, label sampling and the synthetic generator.">
                <input id="seed" inputMode="numeric" className={inputClass} value={seed} aria-invalid={!seedValid} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} />
              </Field>
            </div>

            {!entry.cached && (
              <Alert tone="warn" title={`${DATASET_INFO[name].title} is not cached on this computer`}>
                Download it from the original source first. The file and a provenance record (URL, time, SHA-256 checksums) are stored in <code className="font-mono">engine/</code>.
              </Alert>
            )}

            {hasActiveRun && (
              <label className="flex items-start gap-2.5 text-sm text-slate-300">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-400" checked={confirmReplace} onChange={(e) => setConfirmReplace(e.target.checked)} />
                <span>
                  Close the current run (<span className="font-mono">{activeRunId}</span>) and start a new one. Its history stays in the audit log; pending decisions become stale.
                </span>
              </label>
            )}

            <div className="flex flex-wrap gap-3">
              {!entry.synthetic && (
                <Button
                  variant={entry.cached ? "secondary" : "primary"}
                  icon={CloudDownload}
                  loading={download.pending}
                  onClick={() =>
                    download.run<{ rows: number; cache_sha256: string }>(`/api/datasets/${name}/download`, {}, {
                      success: (r) => `Cached ${r.rows.toLocaleString()} rows of ${name}`,
                      successBody: (r) => `SHA-256 ${r.cache_sha256.slice(0, 16)}… recorded in the provenance file.`,
                      failure: "Download failed",
                    })
                  }
                >
                  {download.pending ? "Downloading and verifying…" : entry.cached ? "Re-download" : "Download and cache"}
                </Button>
              )}
              <Button
                variant="primary"
                icon={Play}
                loading={start.pending}
                disabled={!entry.cached || !seedValid || (hasActiveRun && !confirmReplace)}
                onClick={async () => {
                  const r = await start.run<{ id: string; rows: number; active_version: number }>(
                    "/api/runs",
                    { dataset: name, size, seed: seedNum },
                    {
                      success: (r) => `Run ${r.id} started`,
                      successBody: (r) => `${r.rows.toLocaleString()} rows loaded in source order; initial model v${String(r.active_version).padStart(3, "0")} trained on the first rows.`,
                      failure: "Could not start the run",
                    },
                  );
                  if (r) {
                    setConfirmReplace(false);
                    document.getElementById("replay")?.scrollIntoView({ behavior: "smooth" });
                  }
                }}
              >
                {start.pending ? "Loading data and training the initial model…" : "Start stream"}
              </Button>
            </div>
            {download.pending && <p className="text-xs text-slate-500">Large files (Covertype ≈ 11 MB compressed) can take a minute. You can keep using the dashboard.</p>}
          </CardBody>
        </Card>
      </div>

      <Card className="xl:col-span-3">
        <CardHeader
          title={entry.title}
          icon={FileSearch}
          description={entry.order ?? undefined}
          action={entry.synthetic ? <SimLabel kind="synthetic" /> : entry.page ? (
            <a href={entry.page} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs font-medium text-teal-300 hover:underline">
              Source <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        />
        <CardBody>
          {!entry.cached ? (
            <EmptyState icon={CloudDownload} title="Download to inspect">
              Schema, first rows and class balance come from the real file once it is cached.
            </EmptyState>
          ) : (
            <Tabs
              tabs={[
                {
                  id: "schema",
                  label: "Schema",
                  content: loadingPreview && !preview ? (
                    <Loading />
                  ) : previewError ? (
                    <Alert tone="bad" title="Could not read the dataset">{previewError}</Alert>
                  ) : preview ? (
                    <div className="space-y-4">
                      <Table caption="Schema">
                        <thead>
                          <tr>
                            <Th>Column</Th>
                            <Th>Role</Th>
                            <Th>Type</Th>
                            <Th align="right">Missing</Th>
                            <Th align="right">Unique</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.schema.map((c) => (
                            <tr key={c.column}>
                              <Td mono>{c.column}</Td>
                              <Td>
                                <Badge tone={c.role === "target" ? "accent" : c.role === "numeric" ? "info" : "neutral"}>{c.role}</Badge>
                              </Td>
                              <Td mono>{c.dtype}</Td>
                              <Td align="right">{c.missing}</Td>
                              <Td align="right">{c.unique}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                      <p className="text-xs text-slate-500">Computed from the first {preview.preview_rows.toLocaleString()} rows{entry.synthetic ? " of the exact stream this seed generates" : " of the cached file"}.</p>
                    </div>
                  ) : null,
                },
                {
                  id: "rows",
                  label: "First rows",
                  content: preview ? (
                    <Table caption="First 10 rows">
                      <thead>
                        <tr>
                          <Th>#</Th>
                          {preview.columns.map((c) => (
                            <Th key={c}>{c}</Th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r, i) => (
                          <tr key={i}>
                            <Td className="text-slate-500">{i}</Td>
                            {preview.columns.map((c) => (
                              <Td key={c} mono className={c === "target" ? "text-teal-200" : undefined}>
                                {cell(r[c])}
                              </Td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : (
                    <Loading />
                  ),
                },
                {
                  id: "balance",
                  label: "Class balance",
                  content: preview ? (
                    <div className="space-y-2">
                      {preview.class_balance.map((c) => {
                        const total = preview.class_balance.reduce((s, x) => s + x.count, 0);
                        return (
                          <div key={c.label}>
                            <div className="mb-1 flex justify-between text-xs text-slate-400">
                              <span className="font-mono text-slate-200">{c.label}</span>
                              <span className="tabular">
                                {c.count.toLocaleString()} ({((c.count / total) * 100).toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-slate-800">
                              <div className="h-2 rounded-full bg-teal-400/80" style={{ width: `${(c.count / total) * 100}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <Loading />
                  ),
                },
                {
                  id: "provenance",
                  label: entry.synthetic ? "Drift points" : "Provenance",
                  content: entry.synthetic ? (
                    preview?.synthetic ? (
                      <div className="space-y-4">
                        <KV items={Object.entries(preview.synthetic.drift_points).map(([k, v]) => [k.replace(/_/g, " "), `row ${v.toLocaleString()}`])} />
                        <ul className="space-y-1.5 text-sm text-slate-400">
                          {Object.entries(preview.synthetic.description).map(([k, v]) => (
                            <li key={k}>
                              <span className="font-medium text-slate-200">{k.replace(/_/g, " ")}:</span> {v}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <Loading />
                    )
                  ) : prov ? (
                    <div className="space-y-3">
                      <KV
                        items={Object.entries(prov)
                          .filter(([, v]) => typeof v !== "object" || v === null)
                          .map(([k, v]) => [k.replace(/_/g, " "), <span key={k} className="break-all font-mono text-xs">{String(v)}</span>])}
                        className="sm:grid-cols-1"
                      />
                      {entry.drop_reason && <Alert tone="info" title="Preprocessing note">{entry.drop_reason}</Alert>}
                      {entry.citation && <p className="text-xs text-slate-500">Citation: {entry.citation}</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No provenance record.</p>
                  ),
                },
              ]}
            />
          )}
          {entry.cached && !entry.synthetic && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-emerald-300/80">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Real data, read from the cached original file.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-slate-400" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the dataset through the engine…
    </div>
  );
}
