import { GitBranch } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { StartDemoButton } from "@/components/actions";
import { RollbackButton } from "@/components/model-actions";
import { Reveal } from "@/components/motion";
import { Callout, DataTable, EmptyState, Explainer, KV, MetricStrip, PageHeader, Section, Status, Tag, type Tone } from "@/components/rw";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/authz";
import { ACTION_LABELS, ACTION_SHORT } from "@/lib/catalog";
import { money, num, pct, signed, when } from "@/lib/format";
import { v } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { getActiveRun, getApprovals, getLatestDecision, getRegistry, getRequests, getSettings, listDecisions } from "@/lib/queries";
import type { ModelRow } from "@/lib/types";

export const metadata: Metadata = { title: "Model lifecycle" };
export const dynamic = "force-dynamic";

function modelTone(s: ModelRow["status"]): Tone {
  return s === "active" ? "info" : s === "rejected" ? "bad" : s === "candidate" ? "warn" : "neutral";
}
function decisionTone(s: string): Tone {
  return s === "pending" ? "info" : s === "promoted" || s === "deferred" ? "ok" : s === "rejected" || s === "failed" ? "bad" : s === "stale" ? "warn" : "neutral";
}
const actionName = (a: string) => (a === "initial" ? "initial training" : a === "trained" ? "trained model" : a === "partial" ? "partial update" : a === "full" ? "full retrain" : a);
const pts = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${signed(x * 100, d)} pts`);

export default async function LifecyclePage() {
  const ctx = await requirePage("/lifecycle");
  const ws = ctx.workspace.id;
  const [settings, run] = await Promise.all([getSettings(ws), getActiveRun(ws)]);

  if (!run) {
    return (
      <Reveal>
        <PageHeader title="Model lifecycle" description="Approve, validate, promote and roll back model versions." />
        <EmptyState icon={GitBranch} title="No active stream" action={can(ctx.role, "stream.operate") ? <StartDemoButton regime={ctx.workspace.defaultRegime} /> : undefined} className="py-16">
          The lifecycle is tracked per stream. Start one in Data &amp; streams.
        </EmptyState>
      </Reveal>
    );
  }

  const [decision, registry, requests, decisions, approvals] = await Promise.all([
    getLatestDecision(ws, run.id),
    getRegistry(ws, run.id),
    getRequests(ws, "awaiting_approval"),
    listDecisions(ws, run.id, 30),
    getApprovals(ws, 30),
  ]);
  const active = registry.find((m) => m.version === run.active_version);
  const canRollback = can(ctx.role, "model.rollback");
  const isViewer = ctx.role === "viewer";
  const visible = isViewer ? registry.filter((m) => m.status !== "candidate" && m.status !== "rejected") : registry;
  const rollbackable = registry.filter((m) => m.status === "archived" || m.status === "rolled_back").filter((m) => m.artifact);
  const rejected = registry.filter((m) => m.status === "rejected");
  const post = run.post_update;
  const age = run.batch_index - run.last_update_batch;

  return (
    <Reveal>
      <PageHeader
        title="Model lifecycle"
        description={
          active
            ? `${v(active.version)} is in production (${actionName(active.action)}). It has been running for ${age} batch${age === 1 ? "" : "es"}.`
            : "No model is in production for this stream."
        }
        actions={
          <Button variant="secondary" asChild>
            <Link href="/models">All models</Link>
          </Button>
        }
      />

      <MetricStrip
        items={[
          { label: "Production model", value: v(run.active_version), sub: active ? `${actionName(active.action)} · ${when(active.created)}` : "—" },
          { label: "Reference error", value: pct(active?.metadata.reference_error), sub: active?.metadata.reference_method ?? "chronological hold-out", info: "Error of the production model on its own withheld chronological validation window. Monitoring compares against it." },
          { label: "Versions this stream", value: num(registry.length), sub: `${rollbackable.length} available for rollback · ${rejected.length} rejected` },
          { label: "Awaiting approval", value: num(requests.length + (decision?.status === "pending" ? 1 : 0)), sub: decision?.status === "pending" ? `decision ${decision.id} is open` : "no open decision", tone: requests.length ? "warn" : undefined },
        ]}
      />

      {(decision?.status === "pending" || requests.length > 0) && (
        <Section title="Waiting for a decision">
          <div className="space-y-3">
            {decision?.status === "pending" && (
              <Callout
                tone="info"
                title={`Decision ${decision.id}: ${decision.recommended === "defer" ? "keep the existing model" : ACTION_LABELS[decision.recommended]} recommended`}
                action={
                  <Button size="sm" asChild>
                    <Link href="/decisions">Review</Link>
                  </Button>
                }
              >
                Made at row {num(decision.position)} for {v(decision.version)}. Nothing changes in production until an approver accepts an action.
              </Callout>
            )}
            {requests.map((r) => (
              <Callout key={r.id} title={`Request #${r.id}: ${ACTION_LABELS[r.action]}`} action={<Button size="sm" variant="secondary" asChild><Link href="/decisions">Open</Link></Button>}>
                {r.prepared_by} · {when(r.created)} · “{r.rationale}”
              </Callout>
            ))}
          </div>
        </Section>
      )}

      <div className="grid gap-x-12 lg:grid-cols-[1.25fr_1fr]">
        <Section
          title="Post-update monitoring"
          description="After a promotion the new model and the one it replaced predict the same new rows. Realised gain divided by the avoidable error estimated at decision time is the recovery ratio that calibrates future partial-vs-full choices."
        >
          {post ? (
            <>
              <p className="text-[13.5px]">
                Tracking <Tag tone="info">{v(run.active_version)}</Tag> against retired <Tag>{v(post.old_version)}</Tag> from row {num(post.from_row)}.
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={post.n} aria-valuemax={settings.post_update_window} aria-label="Post-update labels collected">
                <div className="h-full bg-foreground" style={{ width: `${Math.min(100, (post.n / Math.max(1, settings.post_update_window)) * 100)}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {num(post.n)} of {num(settings.post_update_window)} labels collected
              </p>
              <KV
                className="mt-4"
                columns={2}
                items={[
                  ["New model errors", num(post.new_errors)],
                  ["Retired model errors", num(post.old_errors)],
                  ["Predicted reduction", pts(post.predicted, 1)],
                  ["Observed so far", post.n ? pts((post.old_errors - post.new_errors) / post.n, 1) : "—"],
                ]}
              />
            </>
          ) : (
            <p className="text-[13.5px] text-muted-foreground">No update is being tracked right now.</p>
          )}
          {run.outcomes.length > 0 && (
            <div className="mt-6">
              <DataTable
                caption="Measured outcomes"
                rows={run.outcomes.slice().reverse()}
                rowKey={(o) => `${o.version}-${o.completed_batch}`}
                columns={[
                  { key: "v", header: "Version", cell: (o) => v(o.version) },
                  { key: "a", header: "Action", cell: (o) => (o.action ? ACTION_SHORT[o.action] : "—") },
                  { key: "p", header: "Predicted", align: "right", cell: (o) => pts(o.predicted_reduction) },
                  { key: "r", header: "Realised", align: "right", cell: (o) => <span className={o.realized_reduction < 0 ? "text-bad" : undefined}>{pts(o.realized_reduction)}</span> },
                  { key: "rr", header: "Recovery", align: "right", cell: (o) => (o.recovery_ratio != null ? o.recovery_ratio.toFixed(2) : "—") },
                  { key: "n", header: "Labels", align: "right", mobile: false, cell: (o) => num(o.n) },
                ]}
              />
            </div>
          )}
        </Section>

        <Section title="Rollback" description="Restore an archived version of this stream. The artifact checksum is verified before it serves again.">
          {!canRollback ? (
            <p className="text-[13px] text-muted-foreground">Rollback requires the Approver or Admin role.</p>
          ) : rollbackable.length ? (
            <ul className="divide-y divide-border border-y border-border">
              {rollbackable.slice(0, 6).map((m) => (
                <li key={m.version} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-[13px]">
                    <span className="font-mono">{v(m.version)}</span> <span className="text-muted-foreground">· {actionName(m.action)} · ref. error {pct(m.metadata.reference_error)}</span>
                  </span>
                  <RollbackButton version={m.version} activeVersion={run.active_version} size="sm" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">No archived version to roll back to yet.</p>
          )}
        </Section>
      </div>

      <Section title="Version history" description={isViewer ? "Approved versions of this stream." : "Every version of this stream with its checksum, lineage, training interval and validation result."}>
        <DataTable
          caption="Model versions"
          rows={visible}
          rowKey={(m) => m.version}
          onRowHref={(m) => `/models/${m.version}`}
          columns={[
            { key: "v", header: "Version", cell: (m) => <span className="font-mono">{v(m.version)}</span> },
            { key: "s", header: "Status", cell: (m) => <Tag tone={modelTone(m.status)}>{m.status.replace("_", " ")}</Tag> },
            { key: "a", header: "Origin", cell: (m) => actionName(m.action) },
            { key: "p", header: "Parent", cell: (m) => (m.parent_version ? v(m.parent_version) : "—") },
            { key: "t", header: "Trained on rows", mobile: false, cell: (m) => (m.train_start != null ? `${num(m.train_start)}–${num(m.train_end)}` : "—") },
            { key: "r", header: "Ref. error", align: "right", cell: (m) => pct(m.metadata.reference_error) },
            { key: "g", header: "Validation", cell: (m) => (m.metadata.validation ? <Status tone={m.metadata.validation.passed ? "ok" : "bad"}>{m.metadata.validation.passed ? "passed" : "failed"}</Status> : <span className="text-muted-foreground">—</span>) },
            { key: "sha", header: "SHA-256", mobile: false, cell: (m) => <span className="font-mono text-[11.5px] text-muted-foreground">{m.sha256 ? `${m.sha256.slice(0, 12)}…` : "—"}</span> },
            { key: "c", header: "Created", mobile: false, cell: (m) => when(m.created) },
          ]}
        />
      </Section>

      <div className="grid gap-x-12 lg:grid-cols-2">
        <Section title="Decisions and outcomes">
          <DataTable
            caption="Decisions"
            rows={decisions}
            rowKey={(d) => d.id}
            empty="No decisions yet."
            columns={[
              { key: "id", header: "Decision", cell: (d) => <span className="font-mono">{d.id}</span> },
              { key: "r", header: "Recommended", cell: (d) => ACTION_SHORT[d.recommended] },
              { key: "s", header: "Status", cell: (d) => <Tag tone={decisionTone(d.status)}>{d.status}</Tag> },
              { key: "o", header: "Outcome", mobile: false, cell: (d) => <span className="text-[12px] text-ink-2">{d.outcome ?? "—"}</span> },
            ]}
          />
        </Section>
        <Section title="Approvals" description="Who approved what, with the outcome. Approvals cannot be edited.">
          <DataTable
            caption="Approvals"
            rows={approvals}
            rowKey={(a) => a.id}
            empty="No approvals yet."
            columns={[
              { key: "a", header: "Action", cell: (a) => ACTION_SHORT[a.action] },
              { key: "by", header: "Approved by", cell: (a) => a.actor },
              { key: "m", header: "Mode", cell: (a) => a.mode },
              { key: "o", header: "Outcome", mobile: false, cell: (a) => <span className="text-[12px] text-ink-2">{a.outcome ?? "—"}</span> },
              { key: "c", header: "When", mobile: false, cell: (a) => when(a.created) },
            ]}
          />
        </Section>
      </div>

      {!isViewer && rejected.length > 0 && (
        <Section title="Rejected candidates" description="Candidates that failed the chronological validation gate or were rejected by an approver. They never served traffic.">
          <DataTable
            caption="Rejected candidates"
            rows={rejected}
            rowKey={(m) => m.version}
            onRowHref={(m) => `/models/${m.version}`}
            columns={[
              { key: "v", header: "Version", cell: (m) => <span className="font-mono">{v(m.version)}</span> },
              { key: "a", header: "Origin", cell: (m) => actionName(m.action) },
              { key: "why", header: "Failed checks", cell: (m) => <span className="text-[12px] text-ink-2">{m.metadata.validation?.checks.filter((c) => !c.passed).map((c) => c.check).join(", ") || m.metadata.reviews?.at(-1)?.reason || "—"}</span> },
              { key: "c", header: "Created", mobile: false, cell: (m) => when(m.created) },
            ]}
          />
        </Section>
      )}

      <div className="mt-10">
        <Explainer title="What chronological validation means">
          A candidate is trained only on rows that arrived before a withheld window and is scored on that window, alongside the production model. It is promoted only if it is not worse beyond tolerance ({pct(settings.f1_tolerance)} macro-F1), its checksum matches and an approver accepts. Simulated cost of each action is shown in Decision analysis ({money(run.spent)} spent on this stream).
        </Explainer>
      </div>
    </Reveal>
  );
}
