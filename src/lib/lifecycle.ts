/**
 * Application lifecycle (L1 -> L2 -> L4) backed by SQLite.
 *
 * Guarantees
 * - Approval and enforcement live here, in deterministic code. The agent layer
 *   can only *prepare* a request; `execute` requires explicit human approval
 *   unless bounded autonomy is switched on, and then its limits are enforced.
 * - Idempotency: batch processing is keyed by the expected stream position,
 *   decisions by (run, position, version, settings hash), and every decision
 *   can be approved at most once (UNIQUE constraint), so double clicks and
 *   repeated requests cannot repeat work.
 * - Only artifacts registered in SQLite with a matching SHA-256 are loaded.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { DEFAULT_SETTINGS, MODELS_DIR, replaceSettings, safeChild, settingsFrom, type Settings } from "./config";
import { dumps, loads, now, store, type Store } from "./db";
import { loadDataset } from "./datasets";
import { actionCosts, costTrace, justification, rankActions, realizationFactor, sensitivity, type Action,
  type Outcome, type Ranking } from "./economics";
import { frameSha256, range, type Frame } from "./ml/frame";
import { describe, initialModel, loadArtifact, predict, saveArtifact, shadowEvaluate, validationGate, type Evidence,
  type ModelBundle } from "./ml/models";
import { schemaIssues, unseenCategoryRate } from "./ml/preprocess";
import { classificationMetrics, driftStatus, evaluationTrigger, newMonitor, psi, psiSummary, updateWithLabels,
  type MonitorState } from "./monitoring";
import { Rng } from "./rng";

export class LifecycleError extends Error {}
export class ApprovalError extends Error {}

export type Telemetry = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface RunState {
  monitor: MonitorState;
  post_update: null | { old_version: number; from_row: number; predicted: number; decision: string;
    old_errors: number; new_errors: number; n: number };
  outcomes: (Outcome & { decision?: string; version?: number; n?: number; completed_batch?: number })[];
  last_telemetry: Telemetry | null;
}

export interface Run {
  id: string;
  created: string;
  updated: string;
  dataset: string;
  size_label: string;
  n_rows: number;
  seed: number;
  data_sha256: string;
  status: string;
  position: number;
  batch_index: number;
  last_update_batch: number;
  last_eval_batch: number;
  spent: number;
  evaluation_spent: number;
  autonomous_actions: number;
  active_version: number;
  monitor_state: RunState;
  settings: Settings;
}

export interface Decision extends Ranking {
  id: string;
  run_id: string;
  dataset: string;
  position: number;
  batch_index: number;
  version: number;
  created: string;
  requested_by: string;
  settings_hash: string;
  trigger_reasons: string[];
  monitoring: Record<string, unknown>;
  evaluation: { charged: boolean; cost: ReturnType<typeof actionCosts> | null; note: string | null;
    plan: Record<string, unknown> | null };
  candidates: Partial<Record<"full" | "partial", { artifact: string; sha256: string }>>;
  sensitivity: ReturnType<typeof sensitivity>;
  justification: string;
  status?: string;
  outcome?: string | null;
  resolved?: string | null;
}

export interface ExecutionResult {
  status: string;
  outcome: string;
  [key: string]: unknown;
}

const caches = globalThis as unknown as {
  __rwFrames?: Map<string, Frame>;
  __rwModels?: Map<string, ModelBundle>;
  __rwMasks?: Map<string, Uint8Array>;
};
const FRAMES = (caches.__rwFrames ??= new Map());
const MODELS = (caches.__rwModels ??= new Map());
const MASKS = (caches.__rwMasks ??= new Map());

export function clearCaches(): void {
  FRAMES.clear();
  MODELS.clear();
  MASKS.clear();
}

function hashSettings(settings: Settings): string {
  return crypto.createHash("sha256").update(dumps(settings)).digest("hex").slice(0, 16);
}

function parseRun(row: Record<string, unknown> | undefined): Run | null {
  if (!row) return null;
  return { ...(row as unknown as Run), monitor_state: loads(row.monitor_state), settings: loads(row.settings) };
}

/** Which rows ever receive a label. Deterministic per (seed, row); shared by the app and the benchmark. */
export function labelMask(nRows: number, seed: number, fraction: number): Uint8Array {
  const key = `${nRows}|${seed}|${fraction}`;
  const hit = MASKS.get(key);
  if (hit) return hit;
  const mask = new Uint8Array(nRows);
  if (fraction >= 1) mask.fill(1);
  else {
    const rng = new Rng(seed * 104_729 + 3);
    for (let i = 0; i < nRows; i++) mask[i] = rng.random() < fraction ? 1 : 0;
  }
  if (MASKS.size > 8) MASKS.clear();
  MASKS.set(key, mask);
  return mask;
}

const fmtVersion = (v: number) => `v${String(v).padStart(3, "0")}`;

export class Lifecycle {
  readonly db: Store;
  readonly modelsDir: string;
  /** Promotion gate; replaceable in tests. */
  gate = validationGate;

  constructor(db: Store = store(), modelsDir: string = MODELS_DIR) {
    this.db = db;
    this.modelsDir = modelsDir;
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  // ------------------------------------------------------------- settings
  settings(): Settings {
    return settingsFrom(this.db.getSetting<Record<string, unknown>>("active", { ...DEFAULT_SETTINGS }));
  }

  saveSettings(settings: Settings, actor = "user"): void {
    const previous = this.db.getSetting<Record<string, unknown>>("active", { ...DEFAULT_SETTINGS });
    const changed = Object.fromEntries(Object.entries(settings).filter(([k, v]) => dumps(previous[k]) !== dumps(v)));
    this.db.tx(() => {
      this.db.putSetting("active", settings);
      const stale = this.db.run("UPDATE decisions SET status='stale', resolved=?, outcome='settings changed' " +
        "WHERE status='pending'", now()).changes;
      this.db.event("settings_saved", { changed, stale_decisions: stale }, null, actor);
    });
  }

  // --------------------------------------------------------------- recovery
  /** Mark work that was in flight when the process stopped. Nothing is resumed automatically. */
  recover(): { interrupted_executions: number } {
    return this.db.tx(() => {
      const n = this.db.run("UPDATE decisions SET status='interrupted', resolved=?, " +
        "outcome='application stopped during execution; candidate not promoted' WHERE status='executing'", now()).changes;
      if (n) this.db.event("recovered_interrupted_executions", { count: n });
      return { interrupted_executions: n };
    });
  }

  // ------------------------------------------------------------------- data
  path(name: string): string {
    return safeChild(this.modelsDir, name);
  }

  frame(run: Run): Frame {
    const key = `${run.dataset}|${run.size_label}|${run.seed}`;
    if (!FRAMES.has(key)) {
      const frame = loadDataset(run.dataset, run.size_label === "full" ? null : run.n_rows, run.seed);
      if (frameSha256(frame) !== run.data_sha256) {
        throw new LifecycleError("Cached dataset differs from the one this run started with; start a new run");
      }
      FRAMES.clear();
      FRAMES.set(key, frame);
    }
    return FRAMES.get(key)!;
  }

  model(version: number): ModelBundle {
    const row = this.db.one<{ artifact: string | null; sha256: string | null }>(
      "SELECT artifact, sha256 FROM models WHERE version=?", version);
    if (!row?.artifact) throw new LifecycleError(`Model ${fmtVersion(version)} has no artifact`);
    const key = `${version}|${row.sha256}`;
    if (!MODELS.has(key)) {
      if (MODELS.size > 6) MODELS.clear();
      MODELS.set(key, loadArtifact(this.path(row.artifact), row.sha256)[0]);
    }
    return MODELS.get(key)!;
  }

  activeRun(): Run | null {
    return parseRun(this.db.one("SELECT * FROM runs WHERE status='active' ORDER BY created DESC LIMIT 1"));
  }

  run(runId: string): Run | null {
    return parseRun(this.db.one("SELECT * FROM runs WHERE id=?", runId));
  }

  // ------------------------------------------------------------- start run
  startRun(dataset: string, size = "standard", seed: number | null = null, actor = "user"): Run {
    let settings = this.settings();
    if (seed !== null) settings = replaceSettings(settings, { seed: Math.trunc(seed) });
    const frame = loadDataset(dataset, size, settings.seed);
    if (frame.length < settings.initial_size + settings.batch_size) {
      throw new LifecycleError("Stream too short for the initial window plus one batch");
    }
    const [model, ref] = initialModel(frame, settings);
    const runId = crypto.randomBytes(5).toString("hex");
    const monitor = newMonitor(settings, ref.reference_error, ref.reference_n, model.psi_reference);
    const state: RunState = { monitor, post_update: null, outcomes: [], last_telemetry: null };
    const sha = frameSha256(frame);
    this.db.tx(() => {
      this.db.run("UPDATE runs SET status='closed', updated=? WHERE status='active'", now());
      this.db.run("UPDATE decisions SET status='stale', resolved=?, outcome='run closed' WHERE status='pending'", now());
      this.db.run("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", runId, now(), now(), dataset, size,
        frame.length, settings.seed, sha, "active", settings.initial_size, 0, 0, 0, 0, 0, 0, null, dumps(state),
        dumps(settings));
      const version = this.register(runId, model, "initial", null, {
        reference_error: ref.reference_error, reference_method: ref.method, settings, dataset, size });
      this.db.run("UPDATE runs SET active_version=? WHERE id=?", version, runId);
      this.db.event("run_started", { dataset, size, rows: frame.length, seed: settings.seed, version,
        reference_error: ref.reference_error }, runId, actor);
      this.db.putSetting("active", settings);
    });
    FRAMES.clear();
    FRAMES.set(`${dataset}|${size}|${settings.seed}`, frame);
    return this.run(runId)!;
  }

  /** Insert a registry row and write `model_vNNN.json` (call inside a transaction). */
  private register(runId: string, model: ModelBundle, action: string, parent: number | null,
    metadata: Record<string, unknown>): number {
    const cur = this.db.run("INSERT INTO models(run_id,created,artifact,sha256,parent_version,action,status," +
      "train_start,train_end,n_train,seed,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", runId, now(), null, null, parent,
      action, "active", model.train_start, model.trained_until, model.n_train, model.seed, "{}");
    const version = Number(cur.lastInsertRowid);
    const name = `model_v${String(version).padStart(3, "0")}.json`;
    const meta = { ...metadata, version, action, parent_version: parent, model: describe(model), created: now() };
    const sha = saveArtifact(model, this.path(name), meta);
    this.db.run("UPDATE models SET artifact=?, sha256=?, metadata=? WHERE version=?", name, sha, dumps(meta), version);
    if (parent !== null) this.db.run("UPDATE models SET status='archived' WHERE version=? AND status='active'", parent);
    return version;
  }

  // --------------------------------------------------------- process batch
  /**
   * Predict the next batch, reveal due labels, update monitoring. A request whose
   * `expectedPosition` no longer matches the run (a repeat or second click) is a no-op.
   */
  processBatch(runId: string, expectedPosition: number, actor = "user"): Telemetry {
    const settings = this.settings();
    const telemetry = this.db.tx((): Telemetry => {
      const run = parseRun(this.db.one("SELECT * FROM runs WHERE id=?", runId));
      if (!run || run.status !== "active") throw new LifecycleError("Run is not active");
      if (run.position !== expectedPosition) return { noop: true, position: run.position };
      const frame = this.frame(run);
      const start = run.position;
      if (start >= frame.length) throw new LifecycleError("End of stream reached");
      const stop = Math.min(start + settings.batch_size, frame.length);
      const b = run.batch_index;
      const version = run.active_version;
      const model = this.model(version);
      const batch = range(start, stop);
      const t0 = performance.now();
      const pred = predict(model, frame, batch); // 1. predict first
      const inferenceMs = performance.now() - t0;
      const mask = labelMask(frame.length, run.seed, settings.label_fraction);
      const insert = this.db.db.prepare("INSERT INTO predictions VALUES (?,?,?,?,?,?,?,NULL,NULL)");
      batch.forEach((r, i) => insert.run(runId, r, b, version, pred[i], mask[r], b + settings.label_delay_batches));
      const due = this.db.all<{ row: number; prediction: string }>("SELECT row, prediction FROM predictions WHERE " +
        "run_id=? AND label_available=1 AND revealed_batch IS NULL AND due_batch<=? ORDER BY row", runId, b);
      const rows = due.map((d) => d.row); // 2. reveal eligible labels
      const yRev = rows.map((r) => frame.target[r]);
      const pRev = due.map((d) => d.prediction);
      const errors = pRev.map((p, i) => (p !== yRev[i] ? 1 : 0));
      const reveal = this.db.db.prepare("UPDATE predictions SET revealed_batch=?, error=? WHERE run_id=? AND row=?");
      rows.forEach((r, i) => reveal.run(b, errors[i], runId, r));
      const state = run.monitor_state;
      const monitor = state.monitor;
      const signals = updateWithLabels(monitor, errors, settings, rows);
      monitor.predictions_since_update += batch.length;
      const post = state.post_update;
      if (post && rows.length) { // post-update counterfactual check
        const keepIdx = rows.map((r, i) => [r, i] as const).filter(([r]) => r >= post.from_row);
        if (keepIdx.length) {
          const keep = keepIdx.map(([r]) => r);
          const old = predict(this.model(post.old_version), frame, keep);
          keep.forEach((r, j) => {
            const truth = frame.target[r];
            if (old[j] !== truth) post.old_errors += 1;
            if (pRev[keepIdx[j][1]] !== truth) post.new_errors += 1;
          });
          post.n += keep.length;
        }
        if (post.n >= settings.post_update_window) {
          const outcome = { decision: post.decision, version, predicted_reduction: post.predicted,
            realized_reduction: (post.old_errors - post.new_errors) / post.n, n: post.n, completed_batch: b };
          state.outcomes.push(outcome);
          state.post_update = null;
          this.db.event("post_update_outcome", outcome, runId);
        }
      }
      const psiValues = psi(monitor.psi_reference, frame, batch);
      const psiInfo = psiSummary(psiValues, settings.psi_threshold);
      const status = driftStatus(signals, psiInfo, monitor, settings);
      const metrics = classificationMetrics(yRev, pRev, model.classes);
      const issues = schemaIssues(frame, model.schema);
      const pending = (this.db.one<{ n: number }>("SELECT COUNT(*) AS n FROM predictions WHERE run_id=? AND " +
        "label_available=1 AND revealed_batch IS NULL", runId)?.n) ?? 0;
      const trace = costTrace(settings, b + 1);
      const multiplier = trace[trace.length - 1];
      const sinceUpdate = b - run.last_update_batch;
      const tel: Telemetry = {
        batch_index: b, start_row: start, end_row: stop, version, predicted: batch.length, labels_revealed: rows.length,
        labels_pending: pending, label_fraction_setting: settings.label_fraction,
        ...Object.fromEntries(Object.entries(metrics).map(([k, v]) => [`batch_${k}`, v])),
        rolling_error: signals.rolling_error, rolling_error_ci: signals.rolling_error_ci, rolling_n: signals.rolling_n,
        reference_error: monitor.reference_error, degradation: signals.degradation,
        adwin_error_increase: signals.adwin_error_increase, adwin_detections: signals.adwin_detections.length,
        ddm_status: signals.ddm_status, change_row: signals.change_row, learning_debt: monitor.learning_debt,
        learning_debt_cost: monitor.learning_debt * settings.error_value,
        psi: Object.fromEntries(Object.entries(psiValues).map(([k, v]) => [k, v.psi])), max_psi: psiInfo.max_psi,
        max_psi_feature: psiInfo.max_feature, shifted_features: psiInfo.shifted, psi_reliable: psiInfo.reliable,
        ...status, unseen_category_rate: unseenCategoryRate(frame, batch, model.schema, model.vocabulary),
        schema_issues: issues, model_age_batches: sinceUpdate,
        predictions_since_update: monitor.predictions_since_update, labels_since_update: monitor.labels_since_update,
        inference_ms: inferenceMs, price_multiplier: multiplier, spent: run.spent, created: now(),
      };
      const [fire, reasons] = evaluationTrigger(monitor, tel, settings, sinceUpdate + 1, b - run.last_eval_batch + 1,
        actionCosts("partial", settings, 0, multiplier).total);
      Object.assign(tel, { evaluation_suggested: fire, trigger_reasons: reasons });
      state.last_telemetry = tel;
      this.db.run("INSERT INTO batches VALUES (?,?,?,?,?,?,?)", runId, b, start, stop, version, now(), dumps(tel));
      this.db.run("UPDATE runs SET position=?, batch_index=?, monitor_state=?, updated=? WHERE id=?", stop, b + 1,
        dumps(state), now(), runId);
      const stale = this.db.run("UPDATE decisions SET status='stale', resolved=?, outcome='stream advanced' " +
        "WHERE run_id=? AND status='pending'", now(), runId).changes;
      this.db.event("batch_processed", { batch: b, rows: [start, stop], status: status.status, labels: rows.length,
        stale_decisions: stale }, runId, actor);
      return tel;
    });
    if (settings.autonomy && !telemetry.noop) telemetry.autonomy = this.autonomousStep(runId);
    return telemetry;
  }

  // --------------------------------------------------------------- evaluate
  /**
   * Shadow-evaluate full and partial candidates and rank all actions. Repeated
   * requests for the same (run, position, version, settings) return the stored
   * decision and are never charged twice.
   */
  evaluate(runId: string, actor = "user"): Decision {
    const settings = this.settings();
    const run = this.run(runId);
    if (!run || run.status !== "active") throw new LifecycleError("Run is not active");
    const key = crypto.createHash("sha256")
      .update(`${runId}|${run.position}|${run.active_version}|${hashSettings(settings)}`).digest("hex").slice(0, 16);
    const existing = this.db.one<{ payload: string }>("SELECT payload FROM decisions WHERE id=?", key);
    if (existing) return loads<Decision>(existing.payload);
    const state = run.monitor_state;
    const frame = this.frame(run);
    const monitor = state.monitor;
    const b = run.batch_index;
    const trace = costTrace(settings, Math.max(b, 1));
    const multiplier = trace[Math.max(b - 1, 0)];
    const revealed = this.db.all<{ row: number }>("SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS " +
      "NOT NULL ORDER BY row", runId).map((r) => r.row);
    const eligible = [...range(0, run.settings.initial_size), ...revealed];
    const evalCost = actionCosts("evaluation", settings, Math.min(eligible.length, settings.train_window), multiplier);
    const telemetry = state.last_telemetry || {};
    const incumbent = this.model(run.active_version);
    const reasons: string[] = telemetry.trigger_reasons || [];
    let charged = false;
    let shadow: ReturnType<typeof shadowEvaluate> | null = null;
    let note: string | null = null;
    if (monitor.labels_since_update < settings.min_evidence) {
      note = `only ${monitor.labels_since_update} new labels since the last update (minimum ${settings.min_evidence})`;
    } else if (run.spent + evalCost.total > settings.budget) {
      note = "evaluation overhead would exceed the cumulative budget";
    } else {
      shadow = shadowEvaluate(frame, eligible, incumbent, settings, monitor.change_row);
      charged = true;
    }
    const evidence: Partial<Record<"full" | "partial", Evidence>> = shadow ? shadow.evidence
      : { full: { compatible: false, n: 0, reason: note! }, partial: { compatible: false, n: 0, reason: note! } };
    const context = {
      spent: run.spent + (charged ? evalCost.total : 0), batches_since_update: b - run.last_update_batch,
      horizon: settings.horizon_predictions, price_multiplier: multiplier, batch_index: b,
      realization: realizationFactor(state.outcomes, settings),
    };
    const ranking = rankActions(evidence, context, settings);
    const candidates: Decision["candidates"] = {};
    if (shadow) {
      for (const [action, candidate] of Object.entries(shadow.candidates) as ["full" | "partial", ModelBundle][]) {
        const name = `candidate_${key}_${action}.json`;
        candidates[action] = { artifact: name, sha256: saveArtifact(candidate, this.path(name), { decision: key, action }) };
      }
    }
    const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, telemetry[k] ?? null]));
    const decision: Decision = {
      id: key, run_id: runId, dataset: run.dataset, position: run.position, batch_index: b,
      version: run.active_version, created: now(), requested_by: actor, settings_hash: hashSettings(settings),
      trigger_reasons: reasons.length ? reasons : ["manual request"],
      monitoring: pick(["status", "rolling_error", "rolling_error_ci", "reference_error", "degradation",
        "adwin_error_increase", "ddm_status", "learning_debt", "learning_debt_cost", "max_psi", "max_psi_feature",
        "shifted_features", "labels_since_update", "model_age_batches", "change_row"]),
      evaluation: { charged, cost: charged ? evalCost : null, note, plan: shadow ? shadow.plan : null },
      candidates, ...ranking, sensitivity: sensitivity(evidence, context, settings), justification: "",
    };
    decision.justification = justification(decision);
    return this.db.tx(() => {
      const again = this.db.one<{ payload: string }>("SELECT payload FROM decisions WHERE id=?", key);
      if (again) return loads<Decision>(again.payload);
      const current = parseRun(this.db.one("SELECT * FROM runs WHERE id=?", runId))!;
      if (current.position !== run.position || current.active_version !== run.active_version) {
        this.cleanupCandidates(key);
        throw new LifecycleError("The stream changed during evaluation; evaluate again");
      }
      if (charged) {
        this.db.run("UPDATE runs SET spent=spent+?, evaluation_spent=evaluation_spent+?, last_eval_batch=?, " +
          "updated=? WHERE id=?", evalCost.total, evalCost.total, b, now(), runId);
        const st = current.monitor_state;
        st.monitor.labels_since_evaluation = 0;
        this.db.run("UPDATE runs SET monitor_state=? WHERE id=?", dumps(st), runId);
      }
      this.db.run("INSERT INTO decisions VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)", key, runId, now(), run.position, b,
        run.active_version, ranking.recommended, "pending", dumps(decision));
      this.db.event("decision_created", { decision: key, recommended: ranking.recommended,
        evaluation_charged: charged ? evalCost.total : 0,
        nets: Object.fromEntries(ranking.ranked.map((r) => [r.action, r.net_value])) }, runId, actor);
      return decision;
    });
  }

  decision(decisionId: string): Decision | null {
    const row = this.db.one<{ payload: string; status: string; outcome: string | null; resolved: string | null }>(
      "SELECT * FROM decisions WHERE id=?", decisionId);
    if (!row) return null;
    return { ...loads<Decision>(row.payload), status: row.status, outcome: row.outcome, resolved: row.resolved };
  }

  latestDecision(runId?: string): Decision | null {
    const row = runId
      ? this.db.one<{ id: string }>("SELECT id FROM decisions WHERE run_id=? ORDER BY created DESC, rowid DESC LIMIT 1", runId)
      : this.db.one<{ id: string }>("SELECT id FROM decisions ORDER BY created DESC, rowid DESC LIMIT 1");
    return row ? this.decision(row.id) : null;
  }

  // ---------------------------------------------------------------- execute
  /**
   * Approve and carry out one action for one decision. Order: approval/limits ->
   * guardrail re-check -> artifact integrity -> chronological validation gate ->
   * promotion. Any failure is recorded.
   */
  execute(decisionId: string, action: Action, actor: string, approved = false, mode: "manual" | "autonomous" = "manual",
    requestId: number | null = null): ExecutionResult {
    if (!["defer", "partial", "full"].includes(action)) throw new LifecycleError("Unknown action");
    if (mode !== "manual" && mode !== "autonomous") throw new LifecycleError("Unknown execution mode");
    if (typeof actor !== "string" || !actor.trim()) throw new LifecycleError("An approver is required");
    const settings = this.settings();
    // Staleness is committed before refusing (a throw inside the transaction would roll it back).
    const loaded = this.db.tx(() => {
      const row = this.db.one<{ status: string; payload: string; run_id: string; position: number; version: number }>(
        "SELECT * FROM decisions WHERE id=?", decisionId);
      if (!row) return { error: "Unknown decision" };
      if (row.status !== "pending") return { error: `Decision already ${row.status}; it cannot be executed again` };
      const decision = loads<Decision>(row.payload);
      const run = parseRun(this.db.one("SELECT * FROM runs WHERE id=?", row.run_id))!;
      if (run.status !== "active" || run.position !== row.position || run.active_version !== row.version) {
        this.db.run("UPDATE decisions SET status='stale', resolved=?, outcome='state changed' WHERE id=?", now(), decisionId);
        return { error: "Decision is stale: the stream or model changed after it was made" };
      }
      if (decision.settings_hash !== hashSettings(settings)) {
        this.db.run("UPDATE decisions SET status='stale', resolved=?, outcome='settings changed' WHERE id=?", now(),
          decisionId);
        return { error: "Decision is stale: settings changed after it was made" };
      }
      return { decision, run, choice: decision.ranked.find((r) => r.action === action)! };
    });
    if ("error" in loaded) throw new LifecycleError(loaded.error);
    const { decision, run, choice } = loaded;
    if (mode === "manual" && !approved) throw new ApprovalError("Explicit approval is required before execution");
    if (mode === "autonomous") {
      if (!settings.autonomy) throw new ApprovalError("Bounded autonomy is disabled");
      if (run.autonomous_actions >= settings.autonomy_max_actions) {
        throw new ApprovalError("Autonomous action limit reached for this run");
      }
      if (choice.total_cost > settings.autonomy_max_cost) {
        throw new ApprovalError("Action cost exceeds the autonomous spending limit");
      }
    }
    this.db.tx(() => {
      try {
        this.db.run("INSERT INTO approvals(decision_id,action,actor,mode,created) VALUES (?,?,?,?,?)", decisionId, action,
          actor.trim().slice(0, 80), mode, now());
      } catch {
        throw new LifecycleError("This decision already has an approval; duplicate execution prevented");
      }
      const updated = this.db.run("UPDATE decisions SET status='executing' WHERE id=? AND status='pending'", decisionId);
      if (!updated.changes) throw new LifecycleError("Decision is no longer pending");
      if (requestId !== null) {
        this.db.run("UPDATE execution_requests SET status='approved' WHERE id=? AND decision_id=?", requestId, decisionId);
      }
      this.db.event("approval", { decision: decisionId, action, mode, agent_request: requestId }, run.id, actor);
    });
    try {
      return this.carryOut(decision, choice, run, settings, actor, mode);
    } catch (exc) {
      this.resolve(decisionId, "failed", `execution error: ${(exc as Error).message}`, run.id, actor);
      throw exc;
    }
  }

  private resolve(decisionId: string, status: string, outcome: string, runId: string, actor: string,
    detail: Record<string, unknown> = {}): ExecutionResult {
    this.db.tx(() => {
      this.db.run("UPDATE decisions SET status=?, resolved=?, outcome=? WHERE id=?", status, now(), outcome, decisionId);
      this.db.run("UPDATE approvals SET outcome=?, detail=? WHERE decision_id=?", status, dumps(detail), decisionId);
      this.db.event(`decision_${status}`, { decision: decisionId, outcome, ...detail }, runId, actor);
    });
    this.cleanupCandidates(decisionId);
    return { status, outcome, ...detail };
  }

  private carryOut(decision: Decision, choice: Decision["ranked"][number], run: Run, settings: Settings, actor: string,
    mode: string): ExecutionResult {
    const did = decision.id;
    if (choice.action === "defer") return this.resolve(did, "deferred", "approved to keep the current model", run.id, actor);
    // Guardrails are re-checked deterministically with the stored evidence.
    const context = { ...decision.context, spent: run.spent, batches_since_update: run.batch_index - run.last_update_batch };
    const evidence = Object.fromEntries((["partial", "full"] as const).map((a) =>
      [a, decision.ranked.find((x) => x.action === a)!.evidence as Evidence]));
    const current = rankActions(evidence, context, settings).ranked.find((r) => r.action === choice.action)!;
    const failed = current.guardrails.filter((g) => !g.passed);
    if (failed.length) {
      return this.resolve(did, "rejected", `blocked by guardrails: ${failed.map((g) => g.name).join(", ")}`, run.id, actor,
        { guardrails: failed });
    }
    const info = decision.candidates[choice.action as "full" | "partial"];
    if (!info) return this.resolve(did, "rejected", "no candidate artifact", run.id, actor);
    const [candidate] = loadArtifact(this.path(info.artifact), info.sha256);
    // Recompute the chronological hold-out comparison from stored data.
    const frame = this.frame(run);
    const ev = choice.evidence as Evidence;
    const [lo, hi] = ev.holdout_interval!;
    const holdout = this.db.all<{ row: number }>("SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS NOT " +
      "NULL AND row>=? AND row<? ORDER BY row", run.id, lo, hi).map((r) => r.row);
    const truth = holdout.map((r) => frame.target[r]);
    const incM = classificationMetrics(truth, predict(this.model(run.active_version), frame, holdout));
    const candM = classificationMetrics(truth, predict(candidate, frame, holdout));
    const rechecked: Evidence = { ...ev, n: holdout.length, incumbent_error: incM.error ?? 0,
      candidate_error: candM.error ?? 0, incumbent_f1: incM.f1 ?? 0, candidate_f1: candM.f1 ?? 0,
      reduction: (incM.error ?? 0) - (candM.error ?? 0) };
    const gate = this.gate(rechecked, settings);
    if (!gate.passed) {
      this.db.run("INSERT INTO models(run_id,created,artifact,sha256,parent_version,action,status,train_start,train_end," +
        "n_train,seed,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", run.id, now(), null, null, run.active_version,
        choice.action, "rejected", candidate.train_start, candidate.trained_until, candidate.n_train, candidate.seed,
        dumps({ decision: did, validation: gate, evidence: rechecked }));
      return this.resolve(did, "rejected", "validation gate failed", run.id, actor, { validation: gate });
    }
    const version = this.db.tx(() => {
      const live = parseRun(this.db.one("SELECT * FROM runs WHERE id=?", run.id))!;
      if (live.position !== run.position || live.active_version !== run.active_version) {
        throw new LifecycleError("Run changed during execution");
      }
      const v = this.register(run.id, candidate, choice.action, run.active_version, {
        decision: did, approved_by: actor, mode, validation: gate, evidence: rechecked, simulated_cost: choice.costs,
        reference_error: rechecked.candidate_error, settings, dataset: run.dataset });
      const state = live.monitor_state;
      state.monitor = newMonitor(settings, rechecked.candidate_error!, rechecked.n, candidate.psi_reference);
      state.post_update = { old_version: run.active_version, from_row: run.position, predicted: rechecked.reduction!,
        decision: did, old_errors: 0, new_errors: 0, n: 0 };
      this.db.run("UPDATE runs SET active_version=?, spent=spent+?, last_update_batch=?, autonomous_actions=" +
        "autonomous_actions+?, monitor_state=?, updated=? WHERE id=?", v, current.total_cost, run.batch_index,
        mode === "autonomous" ? 1 : 0, dumps(state), now(), run.id);
      return v;
    });
    return this.resolve(did, "promoted", `promoted as ${fmtVersion(version)}`, run.id, actor,
      { version, validation: gate, cost: current.total_cost });
  }

  private cleanupCandidates(decisionId: string): void {
    for (const action of ["full", "partial"]) {
      try {
        fs.rmSync(this.path(`candidate_${decisionId}_${action}.json`), { force: true });
      } catch {
        // best effort
      }
    }
  }

  // --------------------------------------------------------------- rollback
  rollback(version: number, actor: string, approved = false, reason = ""): { status: string; version: number } {
    if (!approved) throw new ApprovalError("Rollback requires explicit approval");
    if (!actor || !actor.trim()) throw new LifecycleError("An approver is required");
    const settings = this.settings();
    const run = this.activeRun();
    if (!run) throw new LifecycleError("No active run");
    const row = this.db.one<{ status: string; artifact: string | null; metadata: string }>(
      "SELECT * FROM models WHERE version=? AND run_id=?", version, run.id);
    if (!row || !["archived", "rolled_back"].includes(row.status) || !row.artifact) {
      throw new LifecycleError("Choose an archived version from the active run");
    }
    const model = this.model(version); // verifies the checksum
    const meta = loads<Record<string, unknown>>(row.metadata) || {};
    this.db.tx(() => {
      const live = parseRun(this.db.one("SELECT * FROM runs WHERE id=?", run.id))!;
      this.db.run("UPDATE models SET status='rolled_back' WHERE version=?", live.active_version);
      this.db.run("UPDATE models SET status='active' WHERE version=?", version);
      const state = live.monitor_state;
      state.monitor = newMonitor(settings, Number(meta.reference_error ?? state.monitor.reference_error), 100,
        model.psi_reference);
      state.post_update = null;
      this.db.run("UPDATE runs SET active_version=?, last_update_batch=?, monitor_state=?, updated=? WHERE id=?", version,
        live.batch_index, dumps(state), now(), run.id);
      this.db.run("UPDATE decisions SET status='stale', resolved=?, outcome='rollback' WHERE run_id=? AND status='pending'",
        now(), run.id);
      this.db.event("rollback", { from_version: live.active_version, to_version: version, reason: reason.slice(0, 500) },
        run.id, actor.trim().slice(0, 80));
    });
    return { status: "rolled_back", version };
  }

  // ---------------------------------------------------- agent requests
  createRequest(decisionId: string, action: Action, rationale: string, preparedBy: string,
    reportId: number | null = null): number {
    if (!["defer", "partial", "full"].includes(action)) throw new LifecycleError("Invalid action");
    if (!this.db.one("SELECT status FROM decisions WHERE id=?", decisionId)) throw new LifecycleError("Unknown decision");
    return this.db.tx(() => {
      const cur = this.db.run("INSERT INTO execution_requests(decision_id,action,prepared_by,rationale,status,created," +
        "report_id) VALUES (?,?,?,?,?,?,?)", decisionId, action, preparedBy.slice(0, 80), String(rationale).slice(0, 1000),
        "awaiting_approval", now(), reportId);
      this.db.event("execution_request_prepared", { decision: decisionId, action,
        note: "not executed; requires human approval" }, null, preparedBy.slice(0, 80));
      return Number(cur.lastInsertRowid);
    });
  }

  dismissRequest(requestId: number, actor: string): void {
    this.db.tx(() => {
      this.db.run("UPDATE execution_requests SET status='dismissed' WHERE id=? AND status='awaiting_approval'", requestId);
      this.db.event("execution_request_dismissed", { request: requestId }, null, actor);
    });
  }

  // --------------------------------------------------------------- autonomy
  /** Bounded autonomy: evaluate when monitoring suggests it, then execute only if every limit passes. */
  autonomousStep(runId: string): Record<string, unknown> {
    const settings = this.settings();
    const run = this.run(runId)!;
    const telemetry = run.monitor_state.last_telemetry || {};
    if (!settings.autonomy) return { acted: false, reason: "autonomy disabled" };
    if (run.autonomous_actions >= settings.autonomy_max_actions) return { acted: false, reason: "autonomous action limit reached" };
    if (!telemetry.evaluation_suggested) return { acted: false, reason: "monitoring did not request an evaluation" };
    const decision = this.evaluate(runId, "bounded-autonomy");
    const top = decision.ranked[0];
    if (top.action === "defer") {
      this.db.event("autonomy_held", { decision: decision.id, reason: "defer recommended" }, runId, "bounded-autonomy");
      return { acted: false, reason: "defer recommended", decision: decision.id };
    }
    if (top.total_cost > settings.autonomy_max_cost) {
      this.db.event("autonomy_held", { decision: decision.id, reason: "cost above autonomy limit" }, runId,
        "bounded-autonomy");
      return { acted: false, reason: "cost above autonomy limit; awaiting human approval", decision: decision.id };
    }
    const result = this.execute(decision.id, top.action, "bounded-autonomy policy", false, "autonomous");
    return { acted: true, decision: decision.id, ...result };
  }

  // ------------------------------------------------------------- read models
  telemetry(runId: string): Telemetry[] {
    return this.db.all<{ telemetry: string }>("SELECT telemetry FROM batches WHERE run_id=? ORDER BY batch_index", runId)
      .map((r) => loads<Telemetry>(r.telemetry));
  }

  registry(runId?: string): Record<string, any>[] { // eslint-disable-line @typescript-eslint/no-explicit-any
    const sql = "SELECT version, run_id, created, artifact, sha256, parent_version, action, status, train_start, " +
      "train_end, n_train, seed, metadata FROM models " + (runId ? "WHERE run_id=? " : "") + "ORDER BY version DESC";
    return (runId ? this.db.all(sql, runId) : this.db.all(sql)).map((r) => ({ ...r, metadata: loads(r.metadata) || {} }));
  }

  labelSummary(runId: string): { predicted: number; available: number; revealed: number } {
    const row = this.db.one<Record<string, number | null>>("SELECT COUNT(*) AS predicted, SUM(label_available) AS " +
      "available, SUM(CASE WHEN revealed_batch IS NOT NULL THEN 1 ELSE 0 END) AS revealed FROM predictions WHERE run_id=?",
      runId) || {};
    return { predicted: Number(row.predicted || 0), available: Number(row.available || 0), revealed: Number(row.revealed || 0) };
  }
}

const globalLife = globalThis as unknown as { __rwLife?: Lifecycle };

/** Process-wide lifecycle; recovers interrupted executions the first time it is created. */
export function lifecycle(): Lifecycle {
  if (!globalLife.__rwLife) {
    globalLife.__rwLife = new Lifecycle();
    globalLife.__rwLife.recover();
  }
  return globalLife.__rwLife;
}
