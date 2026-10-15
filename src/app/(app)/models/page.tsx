import { Cube } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { DeleteJobButton } from "@/components/model-actions";
import { Reveal } from "@/components/motion";
import { DataTable, EmptyState, MetricStrip, PageHeader, Section, Status, Tag, type Tone } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { wsEngine } from "@/lib/engine";
import type { DatasetName } from "@/lib/catalog";
import { num, when } from "@/lib/format";
import { v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getAllModels, getJobLogs, getJobsByKind } from "@/lib/queries";
import type { ModelRow } from "@/lib/types";
import { JobMonitor } from "./_components/job-monitor";
import { jobTone } from "./_components/job-tone";
import { TrainDialog, type TrainingOptions } from "./_components/train-dialog";
import { reportFinishedJobs } from "@/lib/report-jobs";

export const metadata: Metadata = { title: "Models" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ModelRow["status"], Tone> = { active: "info", candidate: "warn", archived: "neutral", rolled_back: "neutral", rejected: "bad" };
const origin = (m: ModelRow) => (m.action === "initial" ? "initial training" : m.action === "trained" ? "trained" : m.action === "partial" ? "partial update" : m.action === "full" ? "full retrain" : m.action);

/** Exact value in the title attribute; rounded value on screen. */
function Pct({ x, d = 2 }: { x: number | null | undefined; d?: number }) {
  if (x == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tabular" title={String(x)}>
      {(x * 100).toFixed(d)}%
    </span>
  );
}
function Delta({ x }: { x: number | null | undefined }) {
  if (x == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={`tabular ${x > 0 ? "text-ok" : x < 0 ? "text-bad" : ""}`} title={String(x)}>
      {x > 0 ? "+" : x < 0 ? "−" : "±"}
      {Math.abs(x * 100).toFixed(2)} pts
    </span>
  );
}

export default async function ModelsPage() {
  const ctx = await requirePage("/models");
  const ws = ctx.workspace.id;
  const isViewer = ctx.role === "viewer";
  const canTrain = can(ctx.role, "model.train");

  const [models, run, jobs] = await Promise.all([getAllModels(ws), getActiveRun(ws), isViewer ? Promise.resolve([]) : getJobsByKind(ws, "training", 30)]);
  const [options, catalog] = canTrain
    ? await Promise.all([
        wsEngine(ws).call<TrainingOptions>("training_options", {}, { timeoutMs: 60_000 }),
        wsEngine(ws).call<{ datasets: { name: DatasetName; cached: boolean }[] }>("datasets", {}, { timeoutMs: 180_000 }),
      ])
    : [null, null];

  void reportFinishedJobs(ws, jobs).catch(() => undefined);
  const live = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const liveLogs = await Promise.all(live.map((j) => getJobLogs(ws, j.id)));
  const recentDone = jobs.find((j) => j.status !== "queued" && j.status !== "running");
  const visible = isViewer ? models.filter((m) => m.status === "active" || m.status === "archived" || m.status === "rolled_back") : models;
  const candidates = models.filter((m) => m.status === "candidate");
  const production = models.find((m) => m.status === "active" && m.run_id === run?.id) ?? models.find((m) => m.status === "active");
  const lastTrained = models.find((m) => m.metadata.kind === "trained" && m.metadata.evaluation);

  return (
    <Reveal>
      <PageHeader
        title="Models"
        description={
          production
            ? `${v(production.version)} is in production. ${candidates.length ? `${candidates.length} candidate${candidates.length === 1 ? " is" : "s are"} waiting for review.` : "No candidates waiting for review."}`
            : "No model is in production yet."
        }
        actions={canTrain && options && catalog ? <TrainDialog options={options} datasets={catalog.datasets} activeVersion={run?.active_version ?? null} /> : undefined}
      />

      <dl className="mb-8 grid gap-4 border-y border-border py-5 text-[13px] sm:grid-cols-3" data-reveal>
        {[
          ["Train", "Fits a model on chronologically earlier rows on this computer. Creates a candidate; production is untouched."],
          ["Validate", "Scores the candidate and the production model on withheld, later rows neither was trained on."],
          ["Promote", "Replaces the production model, only after an approver accepts and the checks pass again."],
        ].map(([k, t]) => (
          <div key={k}>
            <dt className="font-serif text-[20px]">{k}</dt>
            <dd className="mt-0.5 leading-relaxed text-ink-2">{t}</dd>
          </div>
        ))}
      </dl>

      <MetricStrip
        items={[
          { label: "Production", value: production ? v(production.version) : "—", sub: production ? `${origin(production)} · ${when(production.created)}` : "start a stream or promote a candidate" },
          { label: "Candidates", value: num(candidates.length), sub: candidates.length ? "awaiting review" : "none waiting", tone: candidates.length ? "warn" : undefined },
          { label: "Training jobs", value: num(live.length), sub: live.length ? "running or queued" : recentDone ? `last: ${recentDone.status} ${when(recentDone.finished ?? recentDone.created)}` : "none yet" },
          {
            label: "Last trained accuracy",
            value: <Pct x={lastTrained?.metadata.evaluation?.metrics.accuracy} />,
            sub: lastTrained ? (
              <>
                {v(lastTrained.version)} · <Delta x={lastTrained.metadata.evaluation?.parent?.accuracy_change} /> vs parent
              </>
            ) : (
              "no trained model yet"
            ),
          },
        ]}
      />

      {live.length > 0 && (
        <Section title="Training now" description="Stage, progress and log lines come from the worker as it runs.">
          <div className="space-y-4">
            {live.map((j, i) => (
              <JobMonitor key={j.id} initial={j} initialLogs={liveLogs[i]} canCancel={canTrain} />
            ))}
          </div>
        </Section>
      )}

      {!isViewer && candidates.length > 0 && (
        <Section title="Candidates awaiting review" description="Validated on withheld chronological rows. Open one to compare it with production, then request, approve or reject promotion.">
          <DataTable
            caption="Candidates"
            rows={candidates}
            rowKey={(m) => m.version}
            onRowHref={(m) => `/models/${m.version}`}
            columns={[
              { key: "v", header: "Version", cell: (m) => <span className="font-mono">{v(m.version)}</span> },
              { key: "t", header: "Model", cell: (m) => m.metadata.config?.model.type ?? m.metadata.model?.estimator ?? "—" },
              { key: "acc", header: "Accuracy", align: "right", cell: (m) => <Pct x={m.metadata.evaluation?.metrics.accuracy} /> },
              { key: "f1", header: "Macro F1", align: "right", cell: (m) => <Pct x={m.metadata.evaluation?.metrics.f1} /> },
              { key: "d", header: "vs parent", align: "right", cell: (m) => <Delta x={m.metadata.evaluation?.parent?.comparable ? m.metadata.evaluation.parent.accuracy_change : null} /> },
              { key: "g", header: "Gate", cell: (m) => (m.metadata.gate ? <Status tone={m.metadata.gate.passed ? "ok" : "bad"}>{m.metadata.gate.passed ? "passed" : "failed"}</Status> : "—") },
              { key: "r", header: "Review", mobile: false, cell: (m) => (m.metadata.reviews?.some((r) => r.action === "request") ? <Tag tone="info">promotion requested</Tag> : <span className="text-muted-foreground">—</span>) },
              { key: "by", header: "Trained by", mobile: false, cell: (m) => m.metadata.created_by ?? "—" },
            ]}
          />
        </Section>
      )}

      <Section title={isViewer ? "Approved versions" : "All versions"} description={isViewer ? "Versions that served production. Candidates and rejected models are visible to operators and above." : "Every version across streams in this workspace."}>
        {visible.length ? (
          <DataTable
            caption="Model versions"
            rows={visible}
            rowKey={(m) => m.version}
            onRowHref={(m) => `/models/${m.version}`}
            columns={[
              { key: "v", header: "Version", cell: (m) => <span className="font-mono">{v(m.version)}</span> },
              { key: "s", header: "Status", cell: (m) => <Tag tone={STATUS_TONE[m.status]}>{m.status.replace("_", " ")}</Tag> },
              { key: "o", header: "Origin", cell: origin },
              { key: "p", header: "Parent", cell: (m) => (m.parent_version ? v(m.parent_version) : "—") },
              { key: "acc", header: "Accuracy", align: "right", cell: (m) => <Pct x={m.metadata.evaluation?.metrics.accuracy ?? (m.metadata.reference_error != null ? 1 - m.metadata.reference_error : null)} /> },
              { key: "n", header: "Training rows", align: "right", mobile: false, cell: (m) => num(m.n_train) },
              { key: "run", header: "Stream", mobile: false, cell: (m) => <span className="font-mono text-[12px] text-muted-foreground">{m.run_id}</span> },
              { key: "c", header: "Created", mobile: false, cell: (m) => when(m.created) },
            ]}
          />
        ) : (
          <EmptyState icon={Cube} title="No models yet">
            Starting a stream trains the initial model. {canTrain ? "You can also train one directly with Train model." : ""}
          </EmptyState>
        )}
      </Section>

      {!isViewer && (
        <Section title="Training jobs" description="Every training request, including failed and cancelled ones. Admins can delete failed jobs; the deletion is audited.">
          <DataTable
            caption="Training jobs"
            rows={jobs}
            rowKey={(j) => j.id}
            empty="No training jobs yet."
            columns={[
              { key: "id", header: "Job", cell: (j) => <span className="font-mono">{j.id}</span> },
              { key: "s", header: "Status", cell: (j) => <Status tone={jobTone(j.status)}>{j.status}</Status> },
              { key: "m", header: "Model", cell: (j) => j.payload.config?.model.type ?? "—" },
              { key: "r", header: "Result", cell: (j) => (j.result?.version ? <Link className="font-mono underline underline-offset-4" href={`/models/${j.result.version}`}>{v(j.result.version)}</Link> : <span className="text-[12px] text-muted-foreground">{j.error ? j.error.slice(0, 60) : "—"}</span>) },
              { key: "dur", header: "Duration", align: "right", mobile: false, cell: (j) => (j.result?.evaluation ? `${j.result.evaluation.total_seconds.toFixed(2)} s` : "—") },
              { key: "by", header: "Requested by", mobile: false, cell: (j) => j.payload.requested_by ?? "—" },
              { key: "c", header: "Created", mobile: false, cell: (j) => when(j.created) },
              {
                key: "x",
                header: "",
                cell: (j) => (can(ctx.role, "jobs.delete") && ["failed", "cancelled", "interrupted"].includes(j.status) ? <DeleteJobButton jobId={j.id} /> : null),
              },
            ]}
          />
        </Section>
      )}
    </Reveal>
  );
}
