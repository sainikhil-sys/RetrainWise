import { Database } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { ProcessBatchButton } from "@/components/actions";
import { Reveal } from "@/components/motion";
import { DataTable, EmptyState, KV, PageHeader, Section, Status, Tag } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { wsEngine } from "@/lib/engine";
import { num, pct, when } from "@/lib/format";
import { v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getLabelSummary, getSettings, getTelemetry, listRuns } from "@/lib/queries";
import type { Telemetry } from "@/lib/types";
import { DataWorkbench, type DatasetEntry } from "./_components/workbench";

export const metadata: Metadata = { title: "Data & streams" };
export const dynamic = "force-dynamic";

function statusTone(s: string) {
  return s.includes("predictive") ? "bad" : s.includes("covariate") || s.includes("insufficient") ? "warn" : "ok";
}

export default async function DataPage() {
  const ctx = await requirePage("/data");
  const ws = ctx.workspace.id;
  const [settings, run, runs, catalog] = await Promise.all([
    getSettings(ws),
    getActiveRun(ws),
    listRuns(ws, 12),
    wsEngine(ws).call<{ datasets: DatasetEntry[] }>("datasets", {}, { timeoutMs: 180_000 }),
  ]);
  const [tel, labels] = run ? await Promise.all([getTelemetry(ws, run.id), getLabelSummary(ws, run.id)]) : [[] as Telemetry[], null];
  const recent = tel.slice(-10).reverse();
  const canOperate = can(ctx.role, "stream.operate");
  const progress = run ? run.position / run.n_rows : 0;

  return (
    <Reveal>
      <PageHeader
        title="Data & streams"
        description={
          run
            ? `Replaying ${run.dataset} in source order: row ${num(run.position)} of ${num(run.n_rows)}. Each batch is predicted before its labels are revealed.`
            : "Choose a dataset and start a monitored stream. The model predicts each batch first; labels arrive later, as in production."
        }
        actions={run && canOperate && run.position < run.n_rows ? <ProcessBatchButton runId={run.id} position={run.position} /> : undefined}
      />

      {run && (
        <Section flush title="Active stream" description={`Run ${run.id} · ${run.size_label} sample · seed ${run.seed} · started ${when(run.created)}`}>
          <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[1.25fr_1fr]">
            <div>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-muted-foreground">Stream position</span>
                <span className="tabular">
                  {num(run.position)} / {num(run.n_rows)} rows · {(progress * 100).toFixed(1)}%
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Stream progress">
                <div className="h-full bg-foreground transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {canOperate && run.position < run.n_rows && (
                  <>
                    <ProcessBatchButton runId={run.id} position={run.position} variant="secondary" />
                    <ProcessBatchButton runId={run.id} position={run.position} count={Math.min(10, Math.ceil((run.n_rows - run.position) / settings.batch_size))} variant="secondary" />
                  </>
                )}
                {run.position >= run.n_rows && <Status tone="ok">End of stream reached. Start a new stream or run a benchmark.</Status>}
              </div>
            </div>
            <KV
              items={[
                ["Model", v(run.active_version)],
                ["Batch", `${run.batch_index} · ${num(settings.batch_size)} rows each`],
                ["Labels revealed", labels ? num(labels.revealed) : "—"],
                ["Labels pending", labels ? num(labels.available - labels.revealed) : "—"],
                ["Label delay", `${settings.label_delay_batches} batch${settings.label_delay_batches === 1 ? "" : "es"}`],
                ["Label availability", pct(settings.label_fraction, 0)],
              ]}
            />
          </div>
          <div className="mt-8">
            <DataTable
              caption="Recent batches"
              rows={recent}
              rowKey={(t) => t.batch_index}
              empty="No batches yet. Process the first batch to start collecting evidence."
              columns={[
                { key: "b", header: "Batch", cell: (t) => <span className="font-mono">{t.batch_index}</span> },
                { key: "rows", header: "Rows", cell: (t) => `${num(t.start_row)}–${num(t.end_row)}` },
                { key: "v", header: "Model", cell: (t) => v(t.version) },
                { key: "l", header: "Labels", align: "right", cell: (t) => num(t.labels_revealed) },
                { key: "e", header: "Batch error", align: "right", cell: (t) => pct(t.batch_error) },
                { key: "r", header: "Rolling error", align: "right", cell: (t) => pct(t.rolling_error) },
                { key: "p", header: "Max PSI", align: "right", cell: (t) => (t.max_psi != null ? t.max_psi.toFixed(3) : "—") },
                { key: "s", header: "Status", cell: (t) => <Status tone={statusTone(t.status)}>{t.status}</Status> },
                { key: "probe", header: "Probe", mobile: false, cell: (t) => (t.probe?.ran ? <Tag>{t.probe.phase ?? "probe"}</Tag> : <span className="text-ink-3">—</span>) },
              ]}
            />
          </div>
        </Section>
      )}

      <Section
        id="start"
        title={run ? "Start a new stream" : "Choose a data stream"}
        description="Synthetic data is generated on this computer with known drift points. Real datasets are downloaded from their original sources with checksums and provenance; synthetic data is never substituted for them."
      >
        {catalog.datasets.length ? (
          <DataWorkbench
            datasets={catalog.datasets}
            settings={settings}
            activeRunId={run?.id ?? null}
            canOperate={canOperate}
            canConfigure={can(ctx.role, "stream.configure")}
            canChangeRegime={can(ctx.role, "settings.engine")}
            defaultRegime={settings.regime}
          />
        ) : (
          <EmptyState icon={Database} title="No datasets available">
            The engine did not return any datasets.
          </EmptyState>
        )}
      </Section>

      <Section title="Run history" description="Starting a stream closes the previous one. Its batches, decisions and model versions stay in the audit trail.">
        <DataTable
          caption="Run history"
          rows={runs}
          rowKey={(r) => r.id}
          empty="No streams yet."
          columns={[
            { key: "id", header: "Run", cell: (r) => <span className="font-mono">{r.id}</span> },
            { key: "d", header: "Dataset", cell: (r) => r.dataset },
            { key: "s", header: "Sample", cell: (r) => r.size_label },
            { key: "seed", header: "Seed", align: "right", cell: (r) => r.seed },
            { key: "p", header: "Progress", align: "right", cell: (r) => `${num(r.position)} / ${num(r.n_rows)}` },
            { key: "v", header: "Model", cell: (r) => v(r.active_version) },
            { key: "st", header: "Status", cell: (r) => (r.status === "active" ? <Status tone="ok">active</Status> : <span className="text-muted-foreground">closed</span>) },
            { key: "c", header: "Started", mobile: false, cell: (r) => when(r.created) },
          ]}
        />
      </Section>
    </Reveal>
  );
}
