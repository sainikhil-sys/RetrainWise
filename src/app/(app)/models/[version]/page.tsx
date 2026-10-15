import { ArrowLeft, DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ConfusionMatrix } from "@/components/charts";
import { PromoteButton, RejectCandidateButton, RequestPromotionButton, RevalidateButton, RollbackButton } from "@/components/model-actions";
import { Reveal } from "@/components/motion";
import { Callout, DataTable, Explainer, KV, MetricStrip, PageHeader, Section, Status, Tag, Timeline, type Tone } from "@/components/rw";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/authz";
import { num, when } from "@/lib/format";
import { timelineFromEvents, v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getJobLogs, getModel, getModelEvents } from "@/lib/queries";
import type { ExactMetrics, ModelRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ version: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { version } = await params;
  return { title: `Model ${v(Number(version))}` };
}

const STATUS_TONE: Record<ModelRow["status"], Tone> = { active: "info", candidate: "warn", archived: "neutral", rolled_back: "neutral", rejected: "bad" };
const pct2 = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(2)}%`);
const ptsSigned = (x: number | null | undefined) => (x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x * 100).toFixed(2)} pts`);
const exact = (x: unknown) => (x == null ? "—" : String(x));

function MetricsTable({ m, parent }: { m: ExactMetrics; parent?: ExactMetrics | null }) {
  const rows: [string, keyof ExactMetrics][] = [
    ["Accuracy", "accuracy"],
    ["Error rate", "error_rate"],
    ["Precision (macro)", "precision"],
    ["Recall (macro)", "recall"],
    ["F1 (macro)", "f1"],
    ["Precision (weighted)", "precision_weighted"],
    ["Recall (weighted)", "recall_weighted"],
    ["F1 (weighted)", "f1_weighted"],
    ["Majority-class baseline error", "majority_baseline_error"],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">Validation metrics with exact values</caption>
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Metric</th>
            <th className="py-2 pr-3 text-right font-medium">This model</th>
            {parent && <th className="py-2 pr-3 text-right font-medium">Parent</th>}
            <th className="py-2 text-right font-medium">Exact value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, k]) => (
            <tr key={k} className="border-b border-border/60">
              <td className="py-1.5 pr-3">{label}</td>
              <td className="tabular py-1.5 pr-3 text-right">{pct2(m[k] as number)}</td>
              {parent && <td className="tabular py-1.5 pr-3 text-right text-muted-foreground">{pct2(parent[k] as number)}</td>}
              <td className="py-1.5 text-right font-mono text-[11.5px] text-muted-foreground">{exact(m[k])}</td>
            </tr>
          ))}
          <tr className="border-b border-border/60">
            <td className="py-1.5 pr-3">Correct / evaluated</td>
            <td className="tabular py-1.5 pr-3 text-right">
              {num(m.correct)} / {num(m.n)}
            </td>
            {parent && (
              <td className="tabular py-1.5 pr-3 text-right text-muted-foreground">
                {num(parent.correct)} / {num(parent.n)}
              </td>
            )}
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function ModelDetailPage({ params }: Props) {
  const { version } = await params;
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) notFound();
  const ctx = await requirePage(`/models/${n}`);
  const ws = ctx.workspace.id;
  const model = await getModel(ws, n);
  if (!model) notFound();
  if (ctx.role === "viewer" && (model.status === "candidate" || model.status === "rejected")) notFound();

  const m = model.metadata;
  const [events, logs, run] = await Promise.all([getModelEvents(ws, n), m.job ? getJobLogs(ws, m.job) : Promise.resolve([]), getActiveRun(ws)]);
  const ev = m.evaluation;
  const metrics = ev?.metrics;
  const parent = ev?.parent;
  const gate = m.gate ?? m.validation;
  const requested = m.reviews?.some((r) => r.action === "request");
  const isCandidate = model.status === "candidate";
  const sameCreator = ctx.workspace.requireSeparateApprover && m.created_by === ctx.user.email;
  const canRollbackHere = can(ctx.role, "model.rollback") && (model.status === "archived" || model.status === "rolled_back") && !!model.artifact && run?.id === model.run_id;
  const origin = model.action === "initial" ? "initial training" : model.action === "trained" ? "trained with Train model" : model.action === "partial" ? "partial update" : model.action === "full" ? "full retrain" : model.action;

  return (
    <Reveal>
      <Link href="/models" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Models
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Model {v(model.version)} <Tag tone={STATUS_TONE[model.status]}>{model.status.replace("_", " ")}</Tag>
          </span>
        }
        description={`${origin[0].toUpperCase() + origin.slice(1)}${model.parent_version ? ` from ${v(model.parent_version)}` : ""} · ${when(model.created)}${m.created_by ? ` · by ${m.created_by}` : m.approved_by ? ` · approved by ${m.approved_by}` : ""}`}
        actions={
          <>
            <Button variant="secondary" asChild>
              <a href={`/api/models/${n}/report?format=csv`} download>
                <DownloadSimple /> CSV
              </a>
            </Button>
            <Button variant="secondary" asChild>
              <a href={`/api/models/${n}/report?format=json`} download>
                <DownloadSimple /> JSON
              </a>
            </Button>
          </>
        }
      />

      {isCandidate && (
        <div className="mb-8 rounded-md border border-border p-5" data-reveal>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <div className="font-serif text-[22px] leading-tight">{gate?.passed ? "Validated candidate" : "Candidate did not pass validation"}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                {gate?.passed
                  ? `It beat the production model on withheld chronological rows. Production changes only when an approver promotes it.${requested ? " Promotion has been requested." : ""}`
                  : "It cannot be promoted. You can validate again after more data arrives, or reject it."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can(ctx.role, "model.train") && <RevalidateButton version={n} />}
              {can(ctx.role, "action.request") && !can(ctx.role, "model.promote") && gate?.passed && !requested && <RequestPromotionButton version={n} />}
              {can(ctx.role, "model.promote") && <RejectCandidateButton version={n} />}
              {can(ctx.role, "model.promote") && <PromoteButton version={n} activeVersion={run?.active_version ?? null} disabled={!gate?.passed || sameCreator} />}
            </div>
          </div>
          {sameCreator && can(ctx.role, "model.promote") && <p className="mt-3 text-[12px] text-muted-foreground">This workspace requires a different person to promote a model you trained.</p>}
        </div>
      )}
      {canRollbackHere && (
        <Callout title="This version can serve again" className="mb-8" action={<RollbackButton version={n} activeVersion={run?.active_version ?? null} />}>
          Its artifact is kept with a SHA-256 checksum that is verified before it is restored.
        </Callout>
      )}

      {metrics ? (
        <MetricStrip
          items={[
            { label: "Accuracy", value: <span title={String(metrics.accuracy)}>{pct2(metrics.accuracy)}</span>, sub: parent?.comparable ? <>{ptsSigned(parent.accuracy_change)} vs {v(parent.version)}</> : "no comparable parent", tone: parent?.comparable ? (parent.accuracy_change > 0 ? "ok" : parent.accuracy_change < 0 ? "bad" : undefined) : undefined },
            { label: "Macro F1", value: <span title={String(metrics.f1)}>{pct2(metrics.f1)}</span>, sub: parent?.comparable ? `${ptsSigned(parent.f1_change)} vs parent` : `precision ${pct2(metrics.precision)} · recall ${pct2(metrics.recall)}` },
            { label: "Error rate", value: <span title={String(metrics.error_rate)}>{pct2(metrics.error_rate)}</span>, sub: `majority baseline ${pct2(metrics.majority_baseline_error)}` },
            { label: "Validation rows", value: num(ev!.n_validation), sub: `rows ${num(ev!.validation_interval[0])}–${num(ev!.validation_interval[1])} · withheld` },
          ]}
        />
      ) : (
        <MetricStrip
          items={[
            { label: "Reference error", value: pct2(m.reference_error), sub: m.reference_method ?? "chronological hold-out" },
            { label: "Training rows", value: num(model.n_train), sub: model.train_start != null ? `rows ${num(model.train_start)}–${num(model.train_end)}` : "—" },
            { label: "Validation", value: gate ? (gate.passed ? "passed" : "failed") : "—", sub: gate ? `${gate.checks.filter((c) => c.passed).length} of ${gate.checks.length} checks` : "not recorded" },
            { label: "Seed", value: exact(model.seed), sub: m.dataset ?? model.run_id },
          ]}
        />
      )}

      {parent && !parent.comparable && (
        <Callout tone="warn" title="Not directly comparable with its parent" className="mt-8">
          {parent.note}
        </Callout>
      )}

      {metrics && (
        <div className="grid gap-x-12 lg:grid-cols-[1.25fr_1fr]">
          <Section title="Validation metrics" description="Shown rounded; the exact stored values are in the right-hand column, the API and the exports.">
            <MetricsTable m={metrics} parent={parent?.comparable ? parent.metrics : null} />
          </Section>
          <Section title="Confusion matrix" description="Rows are true classes, columns are predictions, on the withheld validation rows.">
            <ConfusionMatrix labels={metrics.labels} matrix={metrics.confusion_matrix} />
          </Section>
        </div>
      )}

      {metrics && (
        <Section title="Per-class results">
          <DataTable
            caption="Per-class metrics"
            rows={metrics.per_class}
            rowKey={(c) => c.label}
            columns={[
              { key: "l", header: "Class", cell: (c) => <span className="font-mono">{c.label}</span> },
              { key: "p", header: "Precision", align: "right", cell: (c) => <span title={String(c.precision)}>{pct2(c.precision)}</span> },
              { key: "r", header: "Recall", align: "right", cell: (c) => <span title={String(c.recall)}>{pct2(c.recall)}</span> },
              { key: "f", header: "F1", align: "right", cell: (c) => <span title={String(c.f1)}>{pct2(c.f1)}</span> },
              { key: "s", header: "Support", align: "right", cell: (c) => num(c.support) },
            ]}
          />
        </Section>
      )}

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Validation evidence">
          {gate ? (
            <ul className="space-y-2">
              {gate.checks.map((c) => (
                <li key={c.check} className="text-[13px]">
                  <Status tone={c.passed ? "ok" : "bad"}>{c.check}</Status>
                  <p className="ml-4 mt-0.5 text-[12px] text-muted-foreground">{c.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">No validation gate recorded for this version.</p>
          )}
          {m.evaluations && m.evaluations.length > 1 && <p className="mt-3 text-[12px] text-muted-foreground">Validated {m.evaluations.length} times; the latest result is shown.</p>}
        </Section>

        <Section title="Configuration">
          <KV
            items={[
              ["Model", m.config?.model.type ?? m.model?.estimator ?? "—"],
              ["Hyperparameters", <span key="h" className="font-mono text-[12px]">{JSON.stringify(m.config ? (m.config.model.type === "random_forest" ? { n_estimators: m.config.model.n_estimators, max_depth: m.config.model.max_depth } : { alpha: m.config.model.alpha, epochs: m.config.model.epochs }) : m.model?.hyperparameters ?? {})}</span>],
              ["Preprocessing", m.config ? `${m.config.preprocessing.numeric_impute} imputation · ${m.config.preprocessing.scale ? "standardised" : "unscaled"} · max ${m.config.preprocessing.max_categories} categories` : "default pipeline"],
              ["Data", m.config ? (m.config.scope === "run" ? `stream ${m.config.run_id} · last ${num(m.config.train_window)} rows` : `${m.config.dataset} · ${m.config.size} · first ${num(m.config.initial_window)} rows · target ${m.config.target_column ?? "target"}`) : m.dataset ?? model.run_id],
              ["Validation split", m.config ? String(m.config.validation_fraction) : "—"],
              ["Seed", exact(model.seed)],
              ["Note", m.config?.note || "—"],
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Artifact">
          <KV
            items={[
              ["File", <span key="a" className="break-all font-mono text-[12px]">{model.artifact ?? "not kept (never promoted)"}</span>],
              ["SHA-256", <span key="s" className="break-all font-mono text-[12px]">{model.sha256 ?? "—"}</span>],
              ["Dataset SHA-256", <span key="d" className="break-all font-mono text-[12px]">{ev?.dataset_sha256 ?? "—"}</span>],
              ["Training rows", `${num(model.n_train)}${model.train_start != null ? ` (rows ${num(model.train_start)}–${num(model.train_end)})` : ""}`],
              ["Features", ev ? num(ev.feature_count) : num(m.model?.features?.length)],
              ["Classes", (ev?.classes ?? m.model?.classes ?? []).join(", ") || "—"],
              ["Training time", ev ? `${ev.training_seconds} s` : "—"],
              ["Validation time", ev ? `${ev.validation_seconds} s` : "—"],
              ["Job", m.job ? <span key="j" className="font-mono">{m.job}</span> : "—"],
            ]}
          />
        </Section>
        <Section title="History" description="Immutable audit events for this version.">
          <Timeline items={timelineFromEvents(events.slice().reverse()).map((t) => ({ id: t.id, title: t.title, tone: t.tone, tag: t.tag, when: when(t.created), meta: t.actor }))} empty="No events recorded." />
          {m.reviews && m.reviews.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-[12.5px]">
              {m.reviews.map((r, i) => (
                <li key={i}>
                  <Tag>{r.action}</Tag> {r.by} ({r.role}) · {when(r.at)}
                  {r.reason && <span className="text-muted-foreground"> · “{r.reason}”</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {logs.length > 0 && (
        <Section title="Training log">
          <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-subtle px-4 py-2 font-mono text-[11.5px] leading-relaxed">
            {logs.map((l) => (
              <div key={l.id} className={l.level === "stage" ? "font-semibold" : l.level === "error" ? "text-bad" : undefined}>
                <span className="text-muted-foreground">{l.created.slice(11, 19)}</span> {l.level === "stage" ? `— ${l.message}` : l.message}
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="mt-10">
        <Explainer title="Raw record (as stored)">
          <pre className="max-h-[420px] overflow-auto rounded-md bg-subtle p-3 font-mono text-[11.5px]">{JSON.stringify(model, null, 2)}</pre>
        </Explainer>
      </div>
    </Reveal>
  );
}
