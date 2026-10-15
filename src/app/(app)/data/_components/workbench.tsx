"use client";

import { ArrowSquareOut, CloudArrowDown, Play } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { Callout, KV, SimLabel, Status, Tag } from "@/components/rw";
import { ConfirmDialog, Spinner, api, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DATASET_INFO, REGIMES, SIZES, type DatasetName, type SizeName } from "@/lib/catalog";
import type { Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

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
const MAX_SEED = 2_147_483_647;

function cell(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v);
}

function Field({ id, label, help, error, children }: { id: string; label: string; help?: string; error?: string | null; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </Label>
      {children}
      {error ? <p className="text-[12px] text-bad">{error}</p> : help ? <p className="text-[12px] leading-snug text-muted-foreground">{help}</p> : null}
    </div>
  );
}

function intIn(s: string, min: number, max: number) {
  const n = Number(s);
  return s.trim() !== "" && Number.isInteger(n) && n >= min && n <= max;
}

export function DataWorkbench({
  datasets,
  settings,
  activeRunId,
  canOperate,
  canConfigure,
  canChangeRegime,
  defaultRegime,
}: {
  datasets: DatasetEntry[];
  settings: Settings;
  activeRunId: string | null;
  canOperate: boolean;
  canConfigure: boolean;
  canChangeRegime: boolean;
  defaultRegime: string;
}) {
  const [name, setName] = useState<DatasetName>(datasets.find((d) => d.synthetic)?.name ?? datasets[0].name);
  const [size, setSize] = useState<SizeName>("standard");
  const [seed, setSeed] = useState(String(settings.seed));
  const [batch, setBatch] = useState(String(settings.batch_size));
  const [delay, setDelay] = useState(String(settings.label_delay_batches));
  const [fraction, setFraction] = useState(String(Math.round(settings.label_fraction * 100)));
  const [regime, setRegime] = useState(defaultRegime);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const download = useAction();
  const save = useAction();
  const start = useAction();

  const entry = datasets.find((d) => d.name === name)!;
  const info = DATASET_INFO[name];
  const seedOk = intIn(seed, 0, MAX_SEED);
  const batchOk = intIn(batch, 10, 100_000);
  const delayOk = intIn(delay, 0, 100);
  const fractionOk = intIn(fraction, 1, 100);
  const formOk = seedOk && batchOk && delayOk && fractionOk;
  const seedNum = Number(seed);

  const streamDirty =
    Number(seed) !== settings.seed ||
    Number(batch) !== settings.batch_size ||
    Number(delay) !== settings.label_delay_batches ||
    Number(fraction) / 100 !== settings.label_fraction;

  useEffect(() => {
    if (!entry.cached || !seedOk) {
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
  }, [name, size, seedNum, seedOk, entry.cached]);

  async function saveStreamSettings() {
    if (!streamDirty) return true;
    const next: Settings = {
      ...settings,
      seed: Number(seed),
      batch_size: Number(batch),
      label_delay_batches: Number(delay),
      label_fraction: Number(fraction) / 100,
    };
    const r = await save.run("/api/settings", { settings: next }, { method: "PUT", success: () => "Stream settings saved", failure: "Could not save stream settings" });
    return r !== null;
  }

  async function startRun() {
    if (canConfigure && !(await saveStreamSettings())) return;
    const r = await start.run<{ id: string; rows: number; active_version: number }>(
      "/api/runs",
      { dataset: name, size, seed: seedNum, ...(canChangeRegime ? { regime } : {}) },
      {
        success: (r) => `Run ${r.id} started`,
        description: (r) => `${r.rows.toLocaleString()} rows loaded in source order. Initial model v${String(r.active_version).padStart(3, "0")} trained on the first rows.`,
        failure: "Could not start the stream",
      },
    );
    setConfirm(false);
    if (r) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const startDisabled = !canOperate || !entry.cached || !formOk || start.pending || save.pending;

  return (
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[1fr_1.25fr]">
      <div className="space-y-8">
        <div>
          <h3 className="mb-3 text-[13px] font-medium text-muted-foreground">1 · Dataset</h3>
          <div role="radiogroup" aria-label="Dataset" className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {datasets.map((d) => {
              const selected = d.name === name;
              return (
                <button
                  key={d.name}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setName(d.name)}
                  className={cn("relative block w-full px-4 py-3 text-left transition-colors", selected ? "bg-subtle" : "hover:bg-subtle/60")}
                >
                  {selected && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-foreground" />}
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-[14px] font-medium">{DATASET_INFO[d.name].title}</span>
                    {d.synthetic ? <Tag>synthetic</Tag> : d.cached ? <Status tone="ok">cached</Status> : <Status tone="warn">not downloaded</Status>}
                  </span>
                  <span className="mt-1 block text-[12.5px] leading-relaxed text-muted-foreground">{DATASET_INFO[d.name].blurb}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-3 text-[13px] font-medium text-muted-foreground">2 · Stream configuration</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="size" label="Sample size" help="Rows from the start of the source-ordered stream.">
              <Select value={size} onValueChange={(v) => setSize(v as SizeName)}>
                <SelectTrigger id="size" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SIZES) as SizeName[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SIZE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="seed" label="Seed" help="SGD randomness, label sampling, synthetic generator." error={seedOk ? null : "Whole number, 0 to 2147483647."}>
              <Input id="seed" inputMode="numeric" value={seed} disabled={!canConfigure} aria-invalid={!seedOk} onChange={(e) => setSeed(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
            <Field id="batch" label="Batch size" help="Rows predicted per batch." error={batchOk ? null : "10 to 100,000 rows."}>
              <Input id="batch" inputMode="numeric" value={batch} disabled={!canConfigure} aria-invalid={!batchOk} onChange={(e) => setBatch(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
            <Field id="delay" label="Label delay (batches)" help="Batches before true labels arrive." error={delayOk ? null : "0 to 100 batches."}>
              <Input id="delay" inputMode="numeric" value={delay} disabled={!canConfigure} aria-invalid={!delayOk} onChange={(e) => setDelay(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
            <Field id="fraction" label="Labels available (%)" help="Share of predictions that ever receive a label." error={fractionOk ? null : "1 to 100%."}>
              <Input id="fraction" inputMode="numeric" value={fraction} disabled={!canConfigure} aria-invalid={!fractionOk} onChange={(e) => setFraction(e.target.value.replace(/[^0-9]/g, ""))} />
            </Field>
            <Field id="regime" label="Cost regime" help={canChangeRegime ? "Simulated price level for compute and people." : "Only admins can change the cost regime."}>
              <Select value={regime} onValueChange={setRegime} disabled={!canChangeRegime}>
                <SelectTrigger id="regime" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGIMES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r[0].toUpperCase() + r.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="mt-3 text-[12px] text-muted-foreground">
            Batch size and label settings also apply to the next batch of the active stream. <SimLabel>Simulated costs</SimLabel>
          </p>

          {!entry.cached && (
            <Callout tone="warn" title={`${info.title} is not on this computer`} className="mt-5">
              Download it from the original source first. The file and a provenance record (URL, time, SHA-256 checksums) are kept locally.
            </Callout>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!entry.synthetic && canOperate && (
              <Button
                variant={entry.cached ? "secondary" : "default"}
                disabled={download.pending}
                onClick={() =>
                  download.run<{ rows: number; cache_sha256: string }>(`/api/datasets/${name}/download`, {}, {
                    success: (r) => `Cached ${r.rows.toLocaleString()} rows of ${info.title}`,
                    description: (r) => `SHA-256 ${r.cache_sha256.slice(0, 16)}… recorded in the provenance file.`,
                    failure: "Download failed",
                  })
                }
              >
                {download.pending ? <Spinner /> : <CloudArrowDown />}
                {download.pending ? "Downloading and verifying…" : entry.cached ? "Re-download" : "Download dataset"}
              </Button>
            )}
            {canOperate ? (
              <Button disabled={startDisabled} onClick={() => (activeRunId ? setConfirm(true) : void startRun())}>
                {start.pending ? <Spinner /> : <Play weight="fill" />}
                {start.pending ? "Loading data and training initial model…" : "Start stream"}
              </Button>
            ) : (
              <p className="text-[13px] text-muted-foreground">Viewers can inspect datasets. Starting streams requires the Operator role.</p>
            )}
            {canConfigure && streamDirty && !start.pending && (
              <Button variant="ghost" disabled={!formOk || save.pending} onClick={() => void saveStreamSettings()}>
                {save.pending && <Spinner />}
                Save settings only
              </Button>
            )}
          </div>
          {download.pending && <p className="mt-2 text-[12px] text-muted-foreground">Large files can take a minute. You can keep using the app.</p>}
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="font-serif text-[24px] leading-tight">{info.title}</h3>
          {entry.synthetic ? (
            <Tag>generated locally</Tag>
          ) : entry.page ? (
            <a href={entry.page} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12.5px] underline-offset-4 hover:underline">
              Source <ArrowSquareOut className="size-3.5" />
            </a>
          ) : null}
        </div>
        {entry.order && <p className="mb-4 text-[13px] leading-relaxed text-ink-2">{entry.order}</p>}

        {!entry.cached ? (
          <div className="rounded-md border border-dashed border-border px-6 py-12 text-center text-[13px] text-muted-foreground">
            Schema, first rows and class balance are read from the real file once it is downloaded.
          </div>
        ) : (
          <Tabs defaultValue="schema">
            <TabsList>
              <TabsTrigger value="schema">Schema</TabsTrigger>
              <TabsTrigger value="rows">First rows</TabsTrigger>
              <TabsTrigger value="balance">Class balance</TabsTrigger>
              <TabsTrigger value="prov">{entry.synthetic ? "Drift points" : "Provenance"}</TabsTrigger>
            </TabsList>
            <div className="pt-4">
              {previewError ? (
                <Callout tone="bad" title="Could not read the dataset">
                  {previewError}
                </Callout>
              ) : !preview || loadingPreview ? (
                <Loading />
              ) : (
                <>
                  <TabsContent value="schema">
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px]">
                        <caption className="sr-only">Schema</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Column</th>
                            <th className="py-2 pr-3 font-medium">Role</th>
                            <th className="py-2 pr-3 font-medium">Type</th>
                            <th className="py-2 pr-3 text-right font-medium">Missing</th>
                            <th className="py-2 text-right font-medium">Unique</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.schema.map((c) => (
                            <tr key={c.column} className="border-b border-border/60">
                              <td className="py-1.5 pr-3 font-mono text-[12px]">{c.column}</td>
                              <td className="py-1.5 pr-3">{c.role === "target" ? <Tag>target</Tag> : <span className="text-ink-2">{c.role}</span>}</td>
                              <td className="py-1.5 pr-3 font-mono text-[12px] text-ink-2">{c.dtype}</td>
                              <td className="tabular py-1.5 pr-3 text-right">{c.missing}</td>
                              <td className="tabular py-1.5 text-right">{c.unique}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-3 text-[12px] text-muted-foreground">
                      Computed from the first {preview.preview_rows.toLocaleString()} rows{entry.synthetic ? " of the exact stream this seed generates" : " of the cached file"}.
                    </p>
                  </TabsContent>
                  <TabsContent value="rows">
                    <div className="overflow-x-auto">
                      <table className="w-full whitespace-nowrap text-[12px]">
                        <caption className="sr-only">First rows</caption>
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">#</th>
                            {preview.columns.map((c) => (
                              <th key={c} className="py-2 pr-3 font-medium">
                                {c}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((r, i) => (
                            <tr key={i} className="border-b border-border/60">
                              <td className="py-1.5 pr-3 text-muted-foreground">{i}</td>
                              {preview.columns.map((c) => (
                                <td key={c} className={cn("py-1.5 pr-3 font-mono", c === "target" && "font-semibold")}>
                                  {cell(r[c])}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </TabsContent>
                  <TabsContent value="balance">
                    <div className="space-y-3">
                      {(() => {
                        const total = preview.class_balance.reduce((s, x) => s + x.count, 0) || 1;
                        return preview.class_balance.map((c) => (
                          <div key={c.label}>
                            <div className="mb-1 flex justify-between text-[12.5px]">
                              <span className="font-mono">{c.label}</span>
                              <span className="tabular text-muted-foreground">
                                {c.count.toLocaleString()} · {((c.count / total) * 100).toFixed(1)}%
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted">
                              <div className="h-1.5 rounded-full bg-foreground" style={{ width: `${(c.count / total) * 100}%` }} />
                            </div>
                          </div>
                        ));
                      })()}
                    </div>
                  </TabsContent>
                  <TabsContent value="prov">
                    {entry.synthetic ? (
                      preview.synthetic ? (
                        <div className="space-y-4">
                          <KV items={Object.entries(preview.synthetic.drift_points).map(([k, val]) => [k.replace(/_/g, " "), `row ${val.toLocaleString()}`])} />
                          <ul className="space-y-1.5 text-[13px] text-ink-2">
                            {Object.entries(preview.synthetic.description).map(([k, val]) => (
                              <li key={k}>
                                <span className="font-medium text-foreground">{k.replace(/_/g, " ")}:</span> {val}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-[13px] text-muted-foreground">No drift-point record.</p>
                      )
                    ) : entry.provenance ? (
                      <div className="space-y-4">
                        <KV
                          items={Object.entries(entry.provenance)
                            .filter(([, val]) => typeof val !== "object" || val === null)
                            .map(([k, val]) => [k.replace(/_/g, " "), <span key={k} className="break-all font-mono text-[12px]">{String(val)}</span>])}
                        />
                        {entry.drop_reason && <Callout title="Preprocessing note">{entry.drop_reason}</Callout>}
                        {entry.licence && <p className="text-[12px] text-muted-foreground">Licence: {entry.licence}</p>}
                        {entry.citation && <p className="text-[12px] text-muted-foreground">Citation: {entry.citation}</p>}
                      </div>
                    ) : (
                      <p className="text-[13px] text-muted-foreground">No provenance record.</p>
                    )}
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Replace the active stream?"
        description={
          <>
            Run <span className="font-mono">{activeRunId}</span> will be closed. Its batches, decisions and model versions stay in the audit trail; pending decisions become stale.
          </>
        }
        confirmLabel="Close it and start"
        pending={start.pending || save.pending}
        onConfirm={startRun}
      >
        <KV
          items={[
            ["Dataset", info.title],
            ["Sample", SIZE_LABEL[size]],
            ["Seed", seed],
            ["Batch size", `${batch} rows`],
          ]}
        />
      </ConfirmDialog>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground" aria-live="polite">
      <Spinner /> Reading the dataset through the engine…
    </div>
  );
}
