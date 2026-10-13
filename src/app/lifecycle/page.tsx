import { Archive, Boxes, GitBranch, Gauge, ShieldCheck, Undo2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ApproveForm, RegistryDetails, RequestRow, RollbackForm } from "@/components/lifecycle-forms";
import { Alert, Badge, Card, CardBody, CardHeader, EmptyState, Explainer, PageHeader, ProgressBar, Table, Td, Th } from "@/components/ui";
import { ACTION_LABELS, ACTION_SHORT } from "@/lib/catalog";
import { decisionTone, money, num, pct, signed, version, when } from "@/lib/format";
import { getActiveRun, getApprovals, getLatestDecision, getRegistry, getRequests, getSettings, listDecisions } from "@/lib/queries";
import type { ModelRow } from "@/lib/types";

export const metadata: Metadata = { title: "Model lifecycle" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ModelRow["status"], "accent" | "neutral" | "warn" | "bad"> = { active: "accent", archived: "neutral", rolled_back: "warn", rejected: "bad" };
const ACTION_NAME: Record<string, string> = { initial: "Initial training", full: "Full retraining", partial: "Incremental update" };

export default async function LifecyclePage() {
  const [settings, run] = await Promise.all([getSettings(), getActiveRun()]);
  const header = (
    <PageHeader
      eyebrow="Model lifecycle"
      title="Approve, validate, promote — or roll back"
      description="Updates happen only after explicit approval. Before promotion the engine re-checks guardrails with current spend, verifies the candidate artifact's checksum and re-runs the chronological validation gate. Failed candidates are recorded as rejected and the active model stays in place."
    />
  );
  if (!run) {
    return (
      <>
        {header}
        <EmptyState icon={GitBranch} title="No active run" action={<Link href="/data" className="text-sm font-medium text-teal-300 hover:underline">Start a run →</Link>}>
          The registry, approvals and rollbacks belong to the active stream.
        </EmptyState>
      </>
    );
  }
  const [decision, registry, requests, decisions, approvals] = await Promise.all([getLatestDecision(run.id), getRegistry(run.id), getRequests("awaiting_approval"), listDecisions(run.id, 30), getApprovals(30)]);
  const runDecisionIds = new Set(decisions.map((d) => d.id));
  const runApprovals = approvals.filter((a) => runDecisionIds.has(a.decision_id));
  const versions = registry.filter((m) => m.status !== "rejected");
  const rejected = registry.filter((m) => m.status === "rejected");
  const rollbackable = registry.filter((m) => (m.status === "archived" || m.status === "rolled_back") && m.artifact).map((m) => ({ version: m.version, label: `${version(m.version)} · ${ACTION_NAME[m.action] ?? m.action} · ${m.status}` }));
  const post = run.post_update;
  const pending = decision?.status === "pending" ? decision : null;

  return (
    <>
      {header}

      <Card className="mb-6">
        <CardHeader title="Approve an action" icon={ShieldCheck} description={pending ? `Decision ${pending.id} (row ${num(pending.position)}, model ${version(pending.version)}) is waiting for a human decision.` : undefined} />
        <CardBody>
          {pending ? (
            <ApproveForm
              decisionId={pending.id}
              recommended={pending.recommended}
              options={(["defer", "partial", "full"] as const).map((a) => {
                const r = pending.ranked.find((x) => x.action === a)!;
                return { action: a, net: r.net_value, cost: r.total_cost, feasible: r.feasible, failed: r.guardrails.filter((g) => !g.passed) };
              })}
            />
          ) : decision ? (
            <Alert tone="neutral" title={`Latest decision ${decision.id} is ${decision.status}`}>
              {decision.outcome ?? ""}. Evaluate update options again in <Link className="text-teal-300 hover:underline" href="/decisions">Decision analysis</Link> to get a fresh decision.
            </Alert>
          ) : (
            <Alert tone="neutral">
              No decision yet. Evaluate update options in <Link className="text-teal-300 hover:underline" href="/decisions">Decision analysis</Link>.
            </Alert>
          )}
        </CardBody>
      </Card>

      {requests.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Agent-prepared requests" description="The agent can only prepare a request. Nothing happens until a person approves it here." />
          <CardBody className="space-y-3">
            {requests.map((r) => (
              <RequestRow key={r.id} req={r} pendingDecisionId={pending?.id ?? null} />
            ))}
          </CardBody>
        </Card>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Post-update monitoring" icon={Gauge} description="After a promotion, the new model and the model it replaced both predict the same new rows. The measured gain, divided by the avoidable error estimated at decision time, is the recovery ratio that calibrates future partial-vs-full choices." />
          <CardBody className="space-y-4">
            {post ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                  Tracking <Badge tone="accent">{version(run.active_version)}</Badge> against retired <Badge tone="neutral">{version(post.old_version)}</Badge>
                  <span className="text-slate-500">from row {num(post.from_row)}</span>
                </div>
                <ProgressBar value={post.n / settings.post_update_window} label={`${num(post.n)} of ${num(settings.post_update_window)} labels collected`} />
                <div className="grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="rounded-lg border border-slate-800 p-3">
                    <div className="text-xs text-slate-400">New model errors</div>
                    <div className="mt-1 text-lg font-semibold tabular text-slate-100">{post.new_errors}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 p-3">
                    <div className="text-xs text-slate-400">Retired model errors</div>
                    <div className="mt-1 text-lg font-semibold tabular text-slate-100">{post.old_errors}</div>
                  </div>
                  <div className="rounded-lg border border-slate-800 p-3">
                    <div className="text-xs text-slate-400">Predicted reduction</div>
                    <div className="mt-1 text-lg font-semibold tabular text-slate-100">{signed(post.predicted * 100, 1)} pts</div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-400">No update is being tracked right now.</p>
            )}
            {run.outcomes.length > 0 ? (
              <Table caption="Measured post-update outcomes">
                <thead>
                  <tr>
                    <Th>Version</Th>
                    <Th>Decision</Th>
                    <Th>Action</Th>
                    <Th align="right">Avoidable at decision</Th>
                    <Th align="right">Predicted reduction</Th>
                    <Th align="right">Realised reduction</Th>
                    <Th align="right">Recovery ratio</Th>
                    <Th align="right">Labels</Th>
                    <Th align="right">Completed at batch</Th>
                  </tr>
                </thead>
                <tbody>
                  {run.outcomes
                    .slice()
                    .reverse()
                    .map((o, i) => (
                      <tr key={i}>
                        <Td>{version(o.version)}</Td>
                        <Td mono>{o.decision ?? "—"}</Td>
                        <Td>{o.action ? ACTION_SHORT[o.action] : "—"}</Td>
                        <Td align="right">{o.avoidable != null ? `${signed(o.avoidable * 100, 2)} pts` : "—"}</Td>
                        <Td align="right">{signed(o.predicted_reduction * 100, 2)} pts</Td>
                        <Td align="right" className={o.realized_reduction > 0 ? "text-emerald-300" : "text-rose-300"}>
                          {signed(o.realized_reduction * 100, 2)} pts
                        </Td>
                        <Td align="right">{o.recovery_ratio != null ? o.recovery_ratio.toFixed(2) : "—"}</Td>
                        <Td align="right">{num(o.n)}</Td>
                        <Td align="right">{o.completed_batch}</Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            ) : (
              !post && <p className="text-xs text-slate-500">No completed post-update measurements yet.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Rollback" icon={Undo2} description="Restore an archived version of this run. Monitors restart against the restored model." />
          <CardBody>
            <RollbackForm versions={rollbackable} />
          </CardBody>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Model registry" icon={Boxes} description="Every version with its artifact checksum, lineage, training interval and validation result. Artifacts are loaded only when their SHA-256 matches this registry." />
        <CardBody>
          <Table caption="Model registry">
            <thead>
              <tr>
                <Th>Version</Th>
                <Th>Status</Th>
                <Th>How it was made</Th>
                <Th align="right">Parent</Th>
                <Th align="right">Training rows</Th>
                <Th align="right">Reference error</Th>
                <Th>Validation</Th>
                <Th>Approved by</Th>
                <Th>Artifact (SHA-256)</Th>
                <Th>Created</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {versions.map((m) => (
                <tr key={m.version} className={m.status === "active" ? "bg-teal-400/[0.05]" : undefined}>
                  <Td className="font-semibold text-slate-100">{version(m.version)}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[m.status]}>{m.status.replace("_", " ")}</Badge>
                  </Td>
                  <Td>{ACTION_NAME[m.action] ?? m.action}</Td>
                  <Td align="right">{version(m.parent_version)}</Td>
                  <Td align="right">
                    {num(m.train_start)}–{num(m.train_end)} ({num(m.n_train)})
                  </Td>
                  <Td align="right">{pct(m.metadata.reference_error, 2)}</Td>
                  <Td>{m.metadata.validation ? <Badge tone={m.metadata.validation.passed ? "good" : "bad"}>{m.metadata.validation.passed ? "passed" : "failed"}</Badge> : <span className="text-xs text-slate-500">initial</span>}</Td>
                  <Td>{m.metadata.approved_by ? `${m.metadata.approved_by}${m.metadata.mode === "autonomous" ? " (autonomy)" : ""}` : "—"}</Td>
                  <Td mono>
                    {m.artifact} <span className="text-slate-500">{m.sha256?.slice(0, 12)}…</span>
                  </Td>
                  <Td>{when(m.created)}</Td>
                  <Td>
                    <RegistryDetails json={JSON.stringify(m.metadata, null, 2)} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Rejected candidates" icon={Archive} description="Candidates that failed the chronological validation gate. They were never promoted; no artifact is kept." />
          <CardBody>
            {rejected.length ? (
              <div className="space-y-3">
                {rejected.map((m) => (
                  <div key={m.version} className="rounded-xl border border-rose-400/20 bg-rose-400/[0.04] p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="bad">rejected</Badge>
                      <span className="font-medium text-slate-100">{ACTION_NAME[m.action] ?? m.action}</span>
                      <span className="text-xs text-slate-500">
                        candidate #{m.version} · parent {version(m.parent_version)} · decision {m.metadata.decision} · {when(m.created)}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-slate-300">
                      {m.metadata.validation?.checks.map((c) => (
                        <li key={c.check} className={c.passed ? "text-slate-400" : "text-rose-200"}>
                          {c.passed ? "✓" : "✗"} {c.check} — {c.detail}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No rejected candidates in this run.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Decisions and outcomes" />
          <CardBody>
            <Table caption="Decisions and outcomes">
              <thead>
                <tr>
                  <Th>Decision</Th>
                  <Th>Recommended</Th>
                  <Th>Status</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => {
                  const a = runApprovals.find((x) => x.decision_id === d.id);
                  return (
                    <tr key={d.id}>
                      <Td mono>
                        {d.id}
                        <div className="font-sans text-[11px] text-slate-500">row {num(d.position)}</div>
                      </Td>
                      <Td>{ACTION_SHORT[d.recommended]}</Td>
                      <Td>
                        <Badge tone={decisionTone(d.status)}>{d.status}</Badge>
                      </Td>
                      <Td className="whitespace-normal text-xs">
                        {d.outcome ?? "—"}
                        {a && (
                          <div className="text-slate-500">
                            {ACTION_LABELS[a.action]} approved by {a.actor} ({a.mode})
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>

      <Explainer title="What does “chronological validation” mean?">
        <p>Candidates are trained only on labelled rows that come before a hold-out block of the newest labelled rows. The current model, the full-retrain candidate and the incremental candidate are all scored on that same block, which none of them trained on.</p>
        <p>The gate promotes a candidate only if its hold-out error is lower than the current model&apos;s, its macro-F1 is not lower by more than the tolerance ({settings.f1_tolerance}), and the hold-out has at least {settings.min_evidence} labels. The validated object itself is promoted — it is never refitted on the hold-out.</p>
        <p>Deployment is simulated: promotion is a registry swap on this computer, priced with assumed costs ({money(run.spent)} spent so far in this run).</p>
      </Explainer>
    </>
  );
}
