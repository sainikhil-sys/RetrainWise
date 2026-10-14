import { ActionForm, Submit } from "@/components/client";
import { Alert, DataTable, Header } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { ACTION_LABELS, type Action } from "@/lib/economics";
import { decisionTone, money, num, version } from "@/lib/format";
import { lifecycle } from "@/lib/lifecycle";
import { approveRequestAction, dismissRequestAction, executeAction, rollbackAction } from "../actions";

export default async function LifecyclePage() {
  const user = await requireUser();
  const life = lifecycle();
  const cfg = life.settings();
  const run = life.activeRun();
  const header = <Header title="Model lifecycle" subtitle="Approve updates, see validation outcomes, inspect the registry, promote or roll back." />;
  if (!run) return <>{header}<Alert>Start a run in <strong>Data and simulation</strong> first.</Alert></>;
  const d = life.latestDecision(run.id);
  const requests = life.db.all<{ id: number; decision_id: string; action: Action; rationale: string }>(
    "SELECT * FROM execution_requests WHERE status='awaiting_approval' ORDER BY id DESC");
  const registry = life.registry(run.id);
  const decisions = life.db.all("SELECT id, created, position, version, recommended, status, outcome, resolved FROM decisions " +
    "WHERE run_id=? ORDER BY created DESC", run.id);
  const { outcomes, post_update: post } = run.monitor_state;
  const archived = registry.filter((r) => ["archived", "rolled_back"].includes(r.status) && r.artifact);
  return (
    <>
      {header}
      <h2>Approve an action</h2>
      {d && d.status === "pending" ? (
        <ActionForm action={executeAction} className="card stack">
          <input type="hidden" name="decision_id" value={d.id} />
          <div className="choices">
            {d.ranked.map((r, i) => (
              <label key={r.action} className="inline">
                <input type="radio" name="action" value={r.action} defaultChecked={i === 0} />
                {r.label} · net {money(r.net_value)} · {r.feasible ? "feasible" : "blocked by guardrails"}
              </label>
            ))}
          </div>
          <p className="muted">Approving as <strong>{user.email}</strong></p>
          <label className="inline"><input type="checkbox" name="approve" /> I approve this action. Guardrails and the
            validation gate are still enforced.</label>
          <div><Submit pendingText="Re-checking guardrails, verifying the artifact, validating on the hold-out…">
            Execute approved action</Submit></div>
        </ActionForm>
      ) : d ? (
        <Alert tone={decisionTone(d.status)}>Latest decision <code>{d.id}</code> is <strong>{d.status}</strong>
          ({d.outcome ?? ""}). Evaluate options again in Decision analysis to get a fresh decision.</Alert>
      ) : <Alert>No decision yet. Evaluate options in Decision analysis.</Alert>}
      {requests.length ? (
        <>
          <h2>Agent-prepared requests (not executed)</h2>
          {requests.map((req) => (
            <div key={req.id} className="card row" style={{ marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                Request #{req.id}: <strong>{ACTION_LABELS[req.action]}</strong> for decision <code>{req.decision_id}</code>
                <div className="muted"><em>Rationale:</em> {req.rationale}</div>
              </div>
              <ActionForm action={approveRequestAction}>
                <input type="hidden" name="request_id" value={req.id} />
                <input type="hidden" name="decision_id" value={req.decision_id} />
                <input type="hidden" name="action" value={req.action} />
                <Submit pendingText="Executing…">Approve</Submit>
              </ActionForm>
              <ActionForm action={dismissRequestAction}>
                <input type="hidden" name="request_id" value={req.id} />
                <Submit className="" pendingText="Dismissing…">Dismiss</Submit>
              </ActionForm>
            </div>
          ))}
        </>
      ) : null}
      <h2>Registry</h2>
      <DataTable rows={registry.map((r) => ({ version: version(r.version), created: r.created, action: r.action, status: r.status,
        parent: r.parent_version ? version(r.parent_version) : null, train_start: r.train_start, train_end: r.train_end,
        n_train: r.n_train, reference_error: num(r.metadata?.reference_error, 4),
        validation: r.metadata?.validation?.passed ?? null, approved_by: r.metadata?.approved_by ?? null,
        sha256: r.sha256 ? String(r.sha256).slice(0, 12) : null }))} />
      <h2>Decisions and outcomes</h2>
      <DataTable rows={decisions} />
      <h2>Post-update monitoring</h2>
      {post ? (
        <Alert>Tracking {version(run.active_version)} against retired {version(post.old_version)} on new labels: {post.n} /{" "}
          {cfg.post_update_window} labels, errors new {post.new_errors} vs old {post.old_errors}.</Alert>
      ) : null}
      {outcomes.length ? (
        <>
          <DataTable rows={outcomes as Record<string, unknown>[]} />
          <p className="muted">Realised reduction = (retired model errors - new model errors) / labels on the same new rows.
            These outcomes calibrate the realisation factor used in future benefit estimates.</p>
        </>
      ) : !post ? <p className="muted">No completed post-update measurements yet.</p> : null}
      <h2>Rollback</h2>
      {archived.length ? (
        <ActionForm action={rollbackAction} className="card stack">
          <div className="form-grid">
            <label>Restore version
              <select name="version">{archived.map((r) => <option key={r.version} value={r.version}>{version(r.version)}</option>)}</select>
            </label>
            <label>Reason<input name="reason" maxLength={500} /></label>
          </div>
          <p className="muted">Approving as <strong>{user.email}</strong></p>
          <label className="inline"><input type="checkbox" name="approve" /> I approve rolling back the active model</label>
          <div><Submit className="danger" pendingText="Rolling back…">Roll back</Submit></div>
        </ActionForm>
      ) : <p className="muted">No archived versions to roll back to.</p>}
    </>
  );
}
