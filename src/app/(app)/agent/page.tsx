import { ActionForm, QuerySelect, Submit } from "@/components/client";
import { Badge, DataTable, Header } from "@/components/ui";
import { ollamaStatus } from "@/lib/agent";
import { requireUser } from "@/lib/auth/session";
import { markdownToHtml } from "@/lib/format";
import { lifecycle } from "@/lib/lifecycle";
import { explainAction } from "../actions";

interface Report {
  id: number;
  mode: string;
  model: string | null;
  status: string;
  created: string;
  iterations: number;
  duration_seconds: number;
  report: string;
  error: string | null;
}

export default async function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const life = lifecycle();
  const cfg = life.settings();
  const run = life.activeRun();
  const status = await ollamaStatus();
  const models = status.models.length ? status.models : [cfg.ollama_model];
  const preferred = models.find((m) => m === cfg.ollama_model || m.startsWith(`${cfg.ollama_model}:`)) ?? models[0];
  const d = run ? life.latestDecision(run.id) : null;
  const reports = life.db.all<Report>("SELECT * FROM agent_reports ORDER BY id DESC LIMIT 8");
  const params = await searchParams;
  const kinds = life.db.all<{ kind: string }>("SELECT DISTINCT kind FROM events ORDER BY kind").map((r) => r.kind);
  const kind = kinds.includes(params.kind) ? params.kind : "";
  const events = kind
    ? life.db.all("SELECT id, created, kind, run_id, actor, payload FROM events WHERE kind=? ORDER BY id DESC LIMIT 500", kind)
    : life.db.all("SELECT id, created, kind, run_id, actor, payload FROM events ORDER BY id DESC LIMIT 500");
  return (
    <>
      <Header title="Agent and audit" subtitle="Explanations with tool evidence, approvals, execution outcomes and the full audit log." />
      <ActionForm action={explainAction} className="card stack">
        <div className="form-grid">
          <label>Explanation mode
            <select name="mode" defaultValue={cfg.agent_mode}>
              <option value="deterministic">Deterministic (no LLM)</option>
              <option value="ollama">Local Ollama (optional)</option>
            </select>
          </label>
          <label>Ollama model
            <select name="model" defaultValue={preferred}>{models.map((m) => <option key={m}>{m}</option>)}</select>
          </label>
          <div style={{ alignSelf: "end" }}>
            {status.available ? <Badge tone="good">Ollama reachable · {status.models.length} model(s)</Badge>
              : <Badge tone="warn">Ollama not reachable — deterministic fallback will be used</Badge>}
          </div>
        </div>
        <div><Submit disabled={!d} pendingText="Gathering tool evidence…">🤖 Generate explanation for the latest decision</Submit></div>
        {!d ? <p className="muted">Create a decision in Decision analysis first.</p> : null}
      </ActionForm>
      {reports.map((r, i) => {
        const calls = life.db.all("SELECT created, tool, arguments, status, result FROM agent_tool_calls WHERE report_id=? ORDER BY id", r.id);
        return (
          <details key={r.id} open={i === 0}>
            <summary>Report #{r.id} · {r.mode}{r.model ? ` (${r.model})` : ""} · {r.status} · {r.created} · {r.iterations}{" "}
              iteration(s) · {r.duration_seconds.toFixed(1)}s</summary>
            <div className="report" dangerouslySetInnerHTML={{ __html: markdownToHtml(r.report) }} />
            {r.error ? <p className="muted">Error: {r.error}</p> : null}
            {calls.length ? <><h4>Tool evidence</h4><DataTable rows={calls} /></> : null}
          </details>
        );
      })}
      <h2>Approvals and execution outcomes</h2>
      <DataTable rows={life.db.all("SELECT * FROM approvals ORDER BY id DESC LIMIT 50")} empty="No approvals yet." />
      <h2>Audit log</h2>
      <div className="row" style={{ alignItems: "end" }}>
        <div style={{ minWidth: 260 }}>
          <QuerySelect name="kind" label="Filter event kind" value={kind} options={[["", "All events"], ...kinds.map((k) => [k, k] as [string, string])]} />
        </div>
        <a className="button" href={`/api/audit${kind ? `?kind=${encodeURIComponent(kind)}` : ""}`}>Export audit log (JSON)</a>
      </div>
      <div style={{ marginTop: 10 }}><DataTable rows={events} /></div>
    </>
  );
}
