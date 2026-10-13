import "server-only";

import { getDb, parseJson } from "./db";
import { DEFAULT_SETTINGS } from "./settings-meta";
import type {
  AgentReport,
  ApprovalRow,
  CostRecord,
  Decision,
  DecisionRow,
  EventRow,
  ExecutionRequest,
  JobRow,
  LabelSummary,
  ModelRow,
  ProbeRow,
  Run,
  Settings,
  Telemetry,
  ToolCall,
} from "./types";

type Raw = Record<string, unknown>;

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key='active'").get() as { value: string } | undefined;
  return { ...DEFAULT_SETTINGS, ...parseJson<Partial<Settings>>(row?.value, {}) };
}

type MonitorState = {
  monitor?: Raw & { rolling?: number[] };
  post_update?: Run["post_update"];
  outcomes?: Run["outcomes"];
  monitoring_spent?: number;
};

function toRun(row: Raw | undefined): Run | null {
  if (!row) return null;
  const state = parseJson<MonitorState>(row.monitor_state, {});
  const m = state.monitor ?? {};
  return {
    id: String(row.id),
    created: String(row.created),
    updated: String(row.updated),
    dataset: String(row.dataset),
    size_label: String(row.size_label),
    n_rows: Number(row.n_rows),
    seed: Number(row.seed),
    data_sha256: String(row.data_sha256),
    status: String(row.status),
    position: Number(row.position),
    batch_index: Number(row.batch_index),
    last_update_batch: Number(row.last_update_batch),
    last_eval_batch: Number(row.last_eval_batch),
    spent: Number(row.spent),
    evaluation_spent: Number(row.evaluation_spent),
    autonomous_actions: Number(row.autonomous_actions),
    active_version: row.active_version == null ? null : Number(row.active_version),
    monitor: {
      reference_error: Number(m.reference_error ?? 0),
      reference_n: Number(m.reference_n ?? 0),
      learning_debt: Number(m.learning_debt ?? 0),
      labels_since_update: Number(m.labels_since_update ?? 0),
      labels_since_evaluation: Number(m.labels_since_evaluation ?? 0),
      predictions_since_update: Number(m.predictions_since_update ?? 0),
      adwin_alarms: Number(m.adwin_alarms ?? 0),
      ddm_drifts: Number(m.ddm_drifts ?? 0),
      change_row: m.change_row == null ? null : Number(m.change_row),
      rolling_n: Array.isArray(m.rolling) ? m.rolling.length : 0,
    },
    post_update: state.post_update ?? null,
    outcomes: state.outcomes ?? [],
    monitoring_spent: Number(state.monitoring_spent ?? 0),
    settings: { ...DEFAULT_SETTINGS, ...parseJson<Partial<Settings>>(row.settings, {}) },
  };
}

export async function getActiveRun(): Promise<Run | null> {
  const db = await getDb();
  return toRun(db.prepare("SELECT * FROM runs WHERE status='active' ORDER BY created DESC LIMIT 1").get() as Raw | undefined);
}

export async function listRuns(limit = 20) {
  const db = await getDb();
  return db
    .prepare(
      "SELECT id, created, updated, dataset, size_label, n_rows, seed, status, position, batch_index, spent, active_version FROM runs ORDER BY created DESC LIMIT ?",
    )
    .all(limit) as Array<{
    id: string;
    created: string;
    updated: string;
    dataset: string;
    size_label: string;
    n_rows: number;
    seed: number;
    status: string;
    position: number;
    batch_index: number;
    spent: number;
    active_version: number | null;
  }>;
}

export async function getTelemetry(runId: string): Promise<Telemetry[]> {
  const db = await getDb();
  const rows = db.prepare("SELECT telemetry FROM batches WHERE run_id=? ORDER BY batch_index").all(runId) as { telemetry: string }[];
  return rows.map((r) => parseJson<Telemetry>(r.telemetry, {} as Telemetry));
}

export async function getLabelSummary(runId: string): Promise<LabelSummary> {
  const db = await getDb();
  const row = db
    .prepare(
      "SELECT COUNT(*) AS predicted, COALESCE(SUM(label_available),0) AS available, " +
        "COALESCE(SUM(CASE WHEN revealed_batch IS NOT NULL THEN 1 ELSE 0 END),0) AS revealed FROM predictions WHERE run_id=?",
    )
    .get(runId) as LabelSummary;
  return { predicted: Number(row.predicted), available: Number(row.available), revealed: Number(row.revealed) };
}

function toDecision(row: Raw | undefined): Decision | null {
  if (!row) return null;
  const payload = parseJson<Decision>(row.payload, {} as Decision);
  return { ...payload, status: String(row.status), outcome: (row.outcome as string) ?? null, resolved: (row.resolved as string) ?? null };
}

export async function getDecision(id: string): Promise<Decision | null> {
  const db = await getDb();
  return toDecision(db.prepare("SELECT * FROM decisions WHERE id=?").get(id) as Raw | undefined);
}

export async function getLatestDecision(runId: string): Promise<Decision | null> {
  const db = await getDb();
  return toDecision(
    db.prepare("SELECT * FROM decisions WHERE run_id=? ORDER BY created DESC, rowid DESC LIMIT 1").get(runId) as Raw | undefined,
  );
}

export async function listDecisions(runId: string, limit = 50): Promise<DecisionRow[]> {
  const db = await getDb();
  return db
    .prepare(
      "SELECT id, created, position, batch_index, version, recommended, status, outcome, resolved FROM decisions " +
        "WHERE run_id=? ORDER BY created DESC, rowid DESC LIMIT ?",
    )
    .all(runId, limit) as DecisionRow[];
}

export async function getRegistry(runId: string): Promise<ModelRow[]> {
  const db = await getDb();
  const rows = db.prepare("SELECT * FROM models WHERE run_id=? ORDER BY version DESC").all(runId) as Raw[];
  return rows.map((r) => ({ ...(r as unknown as ModelRow), metadata: parseJson<ModelRow["metadata"]>(r.metadata, {}) }));
}

export async function getEvents(opts: { limit?: number; kinds?: string[]; runId?: string; actor?: string } = {}): Promise<EventRow[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.kinds && opts.kinds.length) {
    where.push(`kind IN (${opts.kinds.map(() => "?").join(",")})`);
    args.push(...opts.kinds);
  }
  if (opts.runId) {
    where.push("run_id=?");
    args.push(opts.runId);
  }
  if (opts.actor) {
    where.push("actor=?");
    args.push(opts.actor);
  }
  const sql = `SELECT id, created, kind, run_id, actor, payload FROM events ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`;
  args.push(Math.max(1, Math.min(opts.limit ?? 100, 5000)));
  const rows = db.prepare(sql).all(...args) as Raw[];
  return rows.map((r) => ({ ...(r as unknown as EventRow), payload: parseJson<Record<string, unknown>>(r.payload, {}) }));
}

export async function getEventKinds(): Promise<{ kind: string; n: number }[]> {
  const db = await getDb();
  return db.prepare("SELECT kind, COUNT(*) AS n FROM events GROUP BY kind ORDER BY kind").all() as { kind: string; n: number }[];
}

export async function getEventActors(): Promise<string[]> {
  const db = await getDb();
  return (db.prepare("SELECT DISTINCT actor FROM events ORDER BY actor").all() as { actor: string }[]).map((r) => r.actor);
}

export async function getApprovals(limit = 50): Promise<ApprovalRow[]> {
  const db = await getDb();
  const rows = db.prepare("SELECT * FROM approvals ORDER BY id DESC LIMIT ?").all(limit) as Raw[];
  return rows.map((r) => ({ ...(r as unknown as ApprovalRow), detail: parseJson<Record<string, unknown> | null>(r.detail, null) }));
}

export async function getRequests(status?: string): Promise<ExecutionRequest[]> {
  const db = await getDb();
  if (status) return db.prepare("SELECT * FROM execution_requests WHERE status=? ORDER BY id DESC").all(status) as ExecutionRequest[];
  return db.prepare("SELECT * FROM execution_requests ORDER BY id DESC LIMIT 50").all() as ExecutionRequest[];
}

export async function getReports(limit = 10): Promise<AgentReport[]> {
  const db = await getDb();
  return db.prepare("SELECT * FROM agent_reports ORDER BY id DESC LIMIT ?").all(limit) as AgentReport[];
}

export async function getToolCalls(reportIds: number[]): Promise<ToolCall[]> {
  if (!reportIds.length) return [];
  const db = await getDb();
  const rows = db
    .prepare(`SELECT * FROM agent_tool_calls WHERE report_id IN (${reportIds.map(() => "?").join(",")}) ORDER BY id`)
    .all(...reportIds) as Raw[];
  return rows.map((r) => ({
    ...(r as unknown as ToolCall),
    arguments: parseJson<Record<string, unknown>>(r.arguments, {}),
    result: parseJson<unknown>(r.result, null),
  }));
}

export async function getJobs(limit = 10): Promise<JobRow[]> {
  const db = await getDb();
  const rows = db.prepare("SELECT * FROM jobs ORDER BY created DESC LIMIT ?").all(limit) as Raw[];
  return rows.map((r) => ({
    ...(r as unknown as JobRow),
    payload: parseJson<JobRow["payload"]>(r.payload, { datasets: [], policies: [], regimes: [], seeds: [], size: "" }),
    result: parseJson<JobRow["result"]>(r.result, null),
  }));
}

export async function getCounts() {
  const db = await getDb();
  const one = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
  return {
    runs: one("SELECT COUNT(*) AS n FROM runs"),
    decisions: one("SELECT COUNT(*) AS n FROM decisions"),
    models: one("SELECT COUNT(*) AS n FROM models"),
    events: one("SELECT COUNT(*) AS n FROM events"),
    reports: one("SELECT COUNT(*) AS n FROM agent_reports"),
    toolCalls: one("SELECT COUNT(*) AS n FROM agent_tool_calls"),
    approvals: one("SELECT COUNT(*) AS n FROM approvals"),
  };
}

/** Probe results (engine/staleness.py) for a run; tolerates databases created before the table existed. */
export async function getProbes(runId: string, limit = 500): Promise<ProbeRow[]> {
  const db = await getDb();
  try {
    return (db.prepare("SELECT * FROM probes WHERE run_id=? ORDER BY id DESC LIMIT ?").all(runId, limit) as ProbeRow[]).reverse();
  } catch {
    return [];
  }
}

export async function getCostSummary(runId: string): Promise<{ byKind: { kind: string; total: number; n: number }[]; recent: CostRecord[] }> {
  const db = await getDb();
  try {
    const byKind = db.prepare("SELECT kind, SUM(amount) AS total, COUNT(*) AS n FROM cost_records WHERE run_id=? GROUP BY kind ORDER BY total DESC").all(runId) as { kind: string; total: number; n: number }[];
    const recent = (db.prepare("SELECT * FROM cost_records WHERE run_id=? ORDER BY id DESC LIMIT 25").all(runId) as Raw[]).map((r) => ({
      ...(r as unknown as CostRecord),
      detail: parseJson<Record<string, unknown>>(r.detail, {}),
    }));
    return { byKind, recent };
  } catch {
    return { byKind: [], recent: [] };
  }
}
