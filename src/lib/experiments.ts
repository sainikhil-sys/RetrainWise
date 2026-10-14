/**
 * Benchmark harness: replay identical streams and cost traces under six policies.
 *
 *   never              keep the initial model
 *   calendar           full retrain every `calendar_every_batches` batches (cost-unaware)
 *   drift_triggered    full retrain on an ADWIN error-increase alarm or DDM drift (cost-unaware)
 *   cara_ct_inspired   full retrain when accumulated staleness cost >= current full-retrain cost
 *                      (inspired by Cara-CT of Mahadevan & Mathioudakis; NOT an exact re-implementation)
 *   retrainwise        monitoring trigger -> chronological shadow evaluation -> economic ranking
 *                      with guardrails -> validation gate -> promote or defer
 *   hindsight_oracle   exact dynamic programme over {defer, full retrain} at evenly spaced
 *                      checkpoints using realised (future) errors. Optimal only within that
 *                      action space; partial updates and evaluation overhead are excluded.
 *
 * Online policies only see labels that have been revealed (label delay and
 * availability apply identically). Reported accuracy scores every prediction
 * against its true label offline.
 */
import fs from "node:fs";
import path from "node:path";
import { RESULTS_DIR, REGIMES, SAMPLE_SIZES, replaceSettings, validateSettings, type Settings } from "./config";
import { dumps } from "./db";
import { loadDataset } from "./datasets";
import { actionCosts, costTrace, rankActions, realizationFactor, type Costs, type Outcome } from "./economics";
import { labelMask } from "./lifecycle";
import { range, type Frame } from "./ml/frame";
import { initialModel, predict, recentWindow, shadowEvaluate, trainFull, validationGate, type Evidence, type ModelBundle,
  type ReferenceInfo } from "./ml/models";
import { classificationMetrics, driftStatus, evaluationTrigger, newMonitor, psi, psiSummary,
  updateWithLabels } from "./monitoring";

export const POLICIES = ["never", "calendar", "drift_triggered", "cara_ct_inspired", "retrainwise", "hindsight_oracle"] as const;
export type Policy = (typeof POLICIES)[number];
export const POLICY_LABELS: Record<Policy, string> = {
  never: "Never retrain", calendar: "Calendar", drift_triggered: "Drift-triggered",
  cara_ct_inspired: "Cost-aware (CARA-CT-inspired)", retrainwise: "RetrainWise",
  hindsight_oracle: "Hindsight oracle (full-retrain DP)",
};
const COMPONENTS = ["compute", "engineering", "validation", "deployment_risk", "evaluation"] as const;

export class Cancelled extends Error {}

type Cancel = () => boolean;
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export function batchStarts(nRows: number, settings: Settings): number[] {
  const out: number[] = [];
  for (let s = settings.initial_size; s < nRows; s += settings.batch_size) out.push(s);
  return out;
}

/** Baseline full retrain plus a reference error from a chronological 80/20 probe. */
function trainWithReference(frame: Frame, rows: number[], settings: Settings): [ModelBundle, number, number] {
  const model = trainFull(frame, rows, settings);
  const cut = Math.floor(rows.length * 0.8);
  const probe = trainFull(frame, rows.slice(0, cut), settings);
  const tail = rows.slice(cut);
  const ref = classificationMetrics(tail.map((r) => frame.target[r]), predict(probe, frame, tail));
  return [model, ref.error ?? 0, ref.n];
}

class Ledger {
  spent = 0;
  components: Record<(typeof COMPONENTS)[number], number> = { compute: 0, engineering: 0, validation: 0,
    deployment_risk: 0, evaluation: 0 };

  charge(costs: Costs, evaluation = false): void {
    if (evaluation) this.components.evaluation += costs.total;
    else for (const k of ["compute", "engineering", "validation", "deployment_risk"] as const) this.components[k] += costs[k];
    this.spent += costs.total;
  }
}

type Counts = { full: number; partial: number; evaluations: number; rejected: number; blocked: number;
  budget_violations: number };
export type Summary = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type TraceRow = Record<string, unknown>;

function summarize(y: string[], pred: string[], ledger: Ledger, counts: Counts, settings: Settings): Summary {
  const m = classificationMetrics(y, pred);
  let errors = 0;
  for (let i = 0; i < y.length; i++) if (y[i] !== pred[i]) errors += 1;
  const errorCost = errors * settings.error_value;
  return {
    scored_rows: y.length, accuracy: m.accuracy, error_rate: m.error, macro_f1: m.f1, errors,
    full_updates: counts.full, partial_updates: counts.partial, evaluations: counts.evaluations,
    rejected_actions: counts.rejected, blocked_actions: counts.blocked, budget_violations: counts.budget_violations,
    ...Object.fromEntries(Object.entries(ledger.components).map(([k, v]) => [`cost_${k}`, v])),
    operational_cost: ledger.spent, error_cost: errorCost, total_cost: ledger.spent + errorCost,
  };
}

/** Replay one stream under one online policy. Returns [summary, per-batch trace]. */
export async function simulate(frame: Frame, settings: Settings, policy: Policy, trace: number[] | null = null,
  cancel: Cancel = () => false, startState: [ModelBundle, ReferenceInfo] | null = null): Promise<[Summary, TraceRow[]]> {
  if (!POLICIES.includes(policy) || policy === "hindsight_oracle") {
    throw new Error(`simulate() handles online policies only, not ${policy}`);
  }
  validateSettings(settings);
  const t0 = performance.now();
  const n = frame.length;
  const starts = batchStarts(n, settings);
  if (!starts.length) throw new Error("Stream is shorter than the initial training window plus one batch");
  const prices = trace ?? costTrace(settings, starts.length);
  const [initModel, ref] = startState ?? initialModel(frame, settings);
  let model = initModel;
  let monitor = newMonitor(settings, ref.reference_error, ref.reference_n, model.psi_reference);
  const mask = labelMask(n, settings.seed, settings.label_fraction);
  const predictions: string[] = new Array(n).fill("");
  const pending: [number, number][] = [];
  let pendingHead = 0;
  const eligible = range(0, settings.initial_size);
  const ledger = new Ledger();
  const counts: Counts = { full: 0, partial: 0, evaluations: 0, rejected: 0, blocked: 0, budget_violations: 0 };
  const outcomes: Outcome[] = [];
  let tracker: null | { old: ModelBundle; from_row: number; predicted: number; old_errors: number; new_errors: number;
    n: number } = null;
  let lastUpdate = -1;
  let lastEval = -1;
  let decisionSeconds = 0;
  const rowsOut: TraceRow[] = [];
  for (let b = 0; b < starts.length; b++) {
    if (cancel()) throw new Cancelled("Benchmark cancelled");
    if (b % 4 === 0) await tick();
    const start = starts[b];
    const batch = range(start, Math.min(start + settings.batch_size, n));
    const pred = predict(model, frame, batch); // 1. predict first
    batch.forEach((r, i) => (predictions[r] = pred[i]));
    for (const r of batch) if (mask[r]) pending.push([r, b + settings.label_delay_batches]);
    const revealed: number[] = []; // 2. reveal eligible labels
    while (pendingHead < pending.length && pending[pendingHead][1] <= b) revealed.push(pending[pendingHead++][0]);
    revealed.sort((a, c) => a - c);
    const errors = revealed.map((r) => (predictions[r] !== frame.target[r] ? 1 : 0));
    eligible.push(...revealed);
    const signals = updateWithLabels(monitor, errors, settings, revealed);
    if (tracker && revealed.length) { // post-update counterfactual monitoring
      const rows = revealed.filter((r) => r >= tracker!.from_row);
      if (rows.length) {
        const old = predict(tracker.old, frame, rows);
        rows.forEach((r, i) => {
          if (old[i] !== frame.target[r]) tracker!.old_errors += 1;
          if (predictions[r] !== frame.target[r]) tracker!.new_errors += 1;
        });
        tracker.n += rows.length;
      }
      if (tracker.n >= settings.post_update_window) {
        outcomes.push({ predicted_reduction: tracker.predicted,
          realized_reduction: (tracker.old_errors - tracker.new_errors) / tracker.n, n: tracker.n });
        tracker = null;
      }
    }
    const psiInfo = psiSummary(psi(monitor.psi_reference, frame, batch), settings.psi_threshold);
    const status = driftStatus(signals, psiInfo, monitor, settings);
    const telemetry = { ...signals, ...status };
    const sinceUpdate = b - lastUpdate;
    let action = "defer";
    let reason = "";
    const multiplier = prices[Math.min(b, prices.length - 1)];
    const d0 = performance.now(); // 3. decide, learn or update
    if (policy === "calendar" || policy === "drift_triggered" || policy === "cara_ct_inspired") {
      const fullCost = actionCosts("full", settings, Math.min(eligible.length, settings.train_window), multiplier);
      const want = policy === "calendar" ? (b + 1) % settings.calendar_every_batches === 0
        : policy === "drift_triggered" ? signals.adwin_error_increase || signals.ddm_status === "drift"
          : monitor.learning_debt * settings.error_value >= fullCost.total;
      if (want && policy === "cara_ct_inspired" && ledger.spent + fullCost.total > settings.budget) {
        counts.blocked += 1;
        reason = "budget";
      } else if (want) {
        if (ledger.spent + fullCost.total > settings.budget) counts.budget_violations += 1;
        // Drift-triggered retraining uses ADWIN's post-change window; the others the fixed window.
        const change = policy === "drift_triggered" ? monitor.change_row : null;
        const [m, refErr, refN] = trainWithReference(frame, recentWindow(eligible, settings, change)[0], settings);
        model = m;
        ledger.charge(fullCost);
        counts.full += 1;
        action = "full";
        lastUpdate = b;
        monitor = newMonitor(settings, refErr, refN, model.psi_reference);
      }
    } else if (policy === "retrainwise") {
      const cheapest = actionCosts("partial", settings, 0, multiplier).total;
      const [fire, reasons] = evaluationTrigger(monitor, telemetry, settings, sinceUpdate, b - lastEval, cheapest);
      if (fire) {
        const evalCost = actionCosts("evaluation", settings, Math.min(eligible.length, settings.train_window), multiplier);
        if (ledger.spent + evalCost.total > settings.budget) {
          counts.blocked += 1;
          reason = "evaluation budget";
        } else {
          ledger.charge(evalCost, true);
          counts.evaluations += 1;
          lastEval = b;
          monitor.labels_since_evaluation = 0;
          const shadow = shadowEvaluate(frame, eligible, model, settings, monitor.change_row);
          const remaining = n - (start + batch.length);
          const decision = rankActions(shadow.evidence, {
            spent: ledger.spent, batches_since_update: sinceUpdate,
            horizon: Math.min(settings.horizon_predictions, remaining), price_multiplier: multiplier, batch_index: b,
            realization: realizationFactor(outcomes, settings) }, settings);
          const top = decision.ranked[0];
          const blockedUpdates = decision.ranked.filter((r) => r.action !== "defer" && (r.evidence as Evidence).compatible &&
            r.net_value > 0 && !r.feasible);
          if (top.action === "defer") {
            counts.blocked += blockedUpdates.length ? 1 : 0;
            reason = reasons.join("; ");
          } else {
            const ev = top.evidence as Evidence;
            const gate = validationGate(ev, settings);
            if (gate.passed) {
              tracker = { old: model, from_row: start + batch.length, predicted: ev.reduction!, old_errors: 0,
                new_errors: 0, n: 0 };
              model = shadow.candidates[top.action]!;
              ledger.charge(top.costs);
              counts[top.action] += 1;
              action = top.action;
              lastUpdate = b;
              monitor = newMonitor(settings, ev.candidate_error!, ev.n, model.psi_reference);
            } else {
              counts.rejected += 1;
              reason = "validation gate";
            }
          }
        }
      }
    }
    decisionSeconds += (performance.now() - d0) / 1000;
    let wrong = 0;
    batch.forEach((r, i) => (wrong += pred[i] !== frame.target[r] ? 1 : 0));
    rowsOut.push({ batch: b, end: start + batch.length, error: wrong / batch.length, rolling_error: signals.rolling_error,
      status: status.status, max_psi: psiInfo.max_psi, action, spent: ledger.spent,
      learning_debt: monitor.learning_debt, note: reason });
  }
  const scored = range(settings.initial_size, n);
  const summary = summarize(scored.map((r) => frame.target[r]), scored.map((r) => predictions[r]), ledger, counts, settings);
  Object.assign(summary, { runtime_seconds: (performance.now() - t0) / 1000, decision_seconds: decisionSeconds,
    realization_factor: realizationFactor(outcomes, settings).factor, realized_outcomes: outcomes.length });
  return [summary, rowsOut];
}

// ------------------------------------------------------------------- oracle
export function oracleWindows(settings: Settings): number[] {
  const tw = settings.train_window;
  return [...new Set([tw, Math.max(300, Math.floor(tw / 3)), Math.max(300, Math.floor(tw / 6))])].sort((a, b) => b - a);
}

interface OracleMatrix {
  checkpoints: number[];
  windows: number[];
  errors: Map<string, number[]>;
  preds: Map<string, string[]>;
  starts: number[];
  nTrain: Map<string, number>;
  seconds?: number;
}
const nodeKey = (c: number, w: number) => `${c}|${w}`;
const parseNode = (k: string) => k.split("|").map(Number) as [number, number];

/** Train every candidate model of the oracle's action space and record its per-batch errors on later batches. */
export async function oracleMatrix(frame: Frame, settings: Settings, startState: [ModelBundle, ReferenceInfo],
  cancel: Cancel = () => false): Promise<OracleMatrix> {
  const n = frame.length;
  const starts = batchStarts(n, settings);
  const nb = starts.length;
  const mask = labelMask(n, settings.seed, settings.label_fraction);
  const stride = nb > 1 ? Math.max(1, Math.ceil((nb - 1) / settings.oracle_max_checkpoints)) : 1;
  const checkpoints: number[] = [];
  for (let c = stride; c < nb; c += stride) checkpoints.push(c);
  const windows = oracleWindows(settings);
  const models = new Map<string, ModelBundle>([[nodeKey(0, 0), startState[0]]]);
  const nTrain = new Map<string, number>();
  for (const c of checkpoints) {
    if (cancel()) throw new Cancelled("Benchmark cancelled");
    await tick();
    // Labels revealed by the end of batch c-1, exactly as an online policy would see them.
    const eligible = range(0, settings.initial_size);
    for (let b = 0; b < c; b++) {
      if (b + settings.label_delay_batches <= c - 1) {
        for (let r = starts[b]; r < Math.min(starts[b] + settings.batch_size, n); r++) if (mask[r]) eligible.push(r);
      }
    }
    for (const w of windows) {
      const rows = eligible.slice(-w);
      if (w !== windows[0] && rows.length < w) continue; // shorter window identical to a longer one
      try {
        models.set(nodeKey(c, w), trainFull(frame, rows, settings));
        nTrain.set(nodeKey(c, w), rows.length);
      } catch {
        // e.g. single-class window
      }
    }
  }
  const errors = new Map<string, number[]>();
  const preds = new Map<string, string[]>();
  for (const [key, model] of models) {
    await tick();
    const lo = starts[parseNode(key)[0]];
    const p = predict(model, frame, range(lo, n));
    preds.set(key, p);
    errors.set(key, starts.map((s) => {
      if (s < lo) return 0;
      let e = 0;
      for (let r = s; r < Math.min(s + settings.batch_size, n); r++) if (p[r - lo] !== frame.target[r]) e += 1;
      return e;
    }));
  }
  return { checkpoints, windows, errors, preds, starts, nTrain };
}

/** Exact DP over the oracle action space using hindsight (future labels). */
export function oracle(frame: Frame, settings: Settings, matrix: OracleMatrix, trace: number[]): [Summary, TraceRow[]] {
  const t0 = performance.now();
  const { starts } = matrix;
  const nb = starts.length;
  const v = settings.error_value;
  const cum = new Map<string, number[]>();
  for (const [k, e] of matrix.errors) {
    const c = [0];
    for (const x of e) c.push(c[c.length - 1] + x);
    cum.set(k, c);
  }
  const seg = (node: string, b: number) => (cum.get(node)![b] - cum.get(node)![parseNode(node)[0]]) * v;
  const cost = new Map<string, Costs>();
  for (const [k, rows] of matrix.nTrain) {
    cost.set(k, actionCosts("full", settings, rows, trace[Math.min(parseNode(k)[0] - 1, trace.length - 1)]));
  }
  const best = new Map<string, [number, string | null]>([[nodeKey(0, 0), [0, null]]]);
  for (const c of matrix.checkpoints) {
    const here = [...cost.keys()].filter((k) => parseNode(k)[0] === c);
    const earlier = [...best.keys()].filter((p) => parseNode(p)[0] < c);
    if (!here.length || !earlier.length) continue;
    let carry: [number, string] = [Number.POSITIVE_INFINITY, ""];
    for (const p of earlier) {
      const value = best.get(p)![0] + seg(p, c);
      if (value < carry[0]) carry = [value, p];
    }
    for (const k of here) best.set(k, [carry[0] + cost.get(k)!.total, carry[1]]);
  }
  let final: [number, string] = [Number.POSITIVE_INFINITY, ""];
  for (const p of best.keys()) {
    const value = best.get(p)![0] + seg(p, nb);
    if (value < final[0]) final = [value, p];
  }
  const schedule: string[] = [];
  let node: string | null = final[1];
  while (node && node !== nodeKey(0, 0)) {
    schedule.push(node);
    node = best.get(node)![1];
  }
  schedule.sort((a, b) => parseNode(a)[0] - parseNode(b)[0]);
  const pred: string[] = new Array(frame.length).fill("");
  const segments = [nodeKey(0, 0), ...schedule];
  segments.forEach((nd, i) => {
    const lo = starts[parseNode(nd)[0]];
    const hi = i + 1 < segments.length ? starts[parseNode(segments[i + 1])[0]] : frame.length;
    const p = matrix.preds.get(nd)!;
    for (let r = lo; r < hi; r++) pred[r] = p[r - lo];
  });
  const ledger = new Ledger();
  let violations = 0;
  for (const k of schedule) {
    if (ledger.spent + cost.get(k)!.total > settings.budget) violations += 1;
    ledger.charge(cost.get(k)!);
  }
  const counts: Counts = { full: schedule.length, partial: 0, evaluations: 0, rejected: 0, blocked: 0,
    budget_violations: violations };
  const scored = range(settings.initial_size, frame.length);
  const summary = summarize(scored.map((r) => frame.target[r]), scored.map((r) => pred[r]), ledger, counts, settings);
  Object.assign(summary, { runtime_seconds: (performance.now() - t0) / 1000, decision_seconds: 0,
    realization_factor: null, realized_outcomes: 0, oracle_checkpoints: matrix.checkpoints.length,
    oracle_windows: matrix.windows, oracle_models: matrix.preds.size,
    oracle_schedule: schedule.map(parseNode), oracle_objective: final[0] });
  const byBatch = new Map(schedule.map((k) => [parseNode(k)[0] - 1, k]));
  const rows: TraceRow[] = [];
  let spent = 0;
  starts.forEach((s, b) => {
    const hi = Math.min(s + settings.batch_size, frame.length);
    const k = byBatch.get(b);
    if (k) spent += cost.get(k)!.total;
    let wrong = 0;
    for (let r = s; r < hi; r++) if (pred[r] !== frame.target[r]) wrong += 1;
    rows.push({ batch: b, end: hi, error: wrong / (hi - s), action: k ? `full (window ${parseNode(k)[1]})` : "defer", spent });
  });
  return [summary, rows];
}

// ---------------------------------------------------------------- benchmark
export interface BenchmarkOptions {
  datasets?: string[];
  size?: string;
  seeds?: number[];
  regimes?: string[];
  policies?: Policy[];
  settings: Settings;
  prefix?: string;
  progress?: (fraction: number, message: string) => void;
  cancel?: Cancel;
  write?: boolean;
  outDir?: string;
}

export async function benchmark(opts: BenchmarkOptions): Promise<{ summary: Summary[]; wall_seconds: number;
  files: string[] }> {
  const { datasets = ["synthetic"], size = "small", seeds = [42], regimes = ["balanced"], policies = [...POLICIES],
    prefix = "results", progress = () => {}, cancel = () => false, write = true, outDir = RESULTS_DIR } = opts;
  const base = validateSettings(opts.settings);
  if (!(size in SAMPLE_SIZES)) throw new Error(`size must be one of ${Object.keys(SAMPLE_SIZES).join(", ")}`);
  const bad = policies.filter((p) => !POLICIES.includes(p));
  if (bad.length || !policies.length || !datasets.length || !seeds.length || !regimes.length ||
    regimes.some((r) => !(REGIMES as readonly string[]).includes(r))) {
    throw new Error(`Invalid experiment configuration ${bad.join(", ")}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error("prefix may contain only letters, digits, '_' and '-'");
  const total = datasets.length * seeds.length * regimes.length * policies.length;
  let done = 0;
  const rows: Summary[] = [];
  const details: { summary: Summary; trace: TraceRow[] }[] = [];
  const started = performance.now();
  for (const name of datasets) {
    for (const seed of seeds) {
      const frame = loadDataset(name, size, seed);
      const cfg0 = replaceSettings(base, { seed, autonomy: false });
      progress(done / total, `${name} seed ${seed}: training initial model`);
      await tick();
      const startState = initialModel(frame, cfg0);
      let matrix: OracleMatrix | null = null;
      for (const regime of regimes) {
        for (const policy of policies) {
          if (cancel()) throw new Cancelled("Benchmark cancelled");
          const cfg = replaceSettings(cfg0, { regime: regime as Settings["regime"] });
          const trace = costTrace(cfg, batchStarts(frame.length, cfg).length);
          progress(done / total, `${name} seed ${seed} ${regime}: ${POLICY_LABELS[policy]}`);
          let summary: Summary;
          let traceRows: TraceRow[];
          if (policy === "hindsight_oracle") {
            if (!matrix) {
              const m0 = performance.now();
              matrix = await oracleMatrix(frame, cfg, startState, cancel);
              matrix.seconds = (performance.now() - m0) / 1000;
            }
            [summary, traceRows] = oracle(frame, cfg, matrix, trace);
            summary.runtime_seconds += matrix.seconds ?? 0;
          } else {
            [summary, traceRows] = await simulate(frame, cfg, policy, trace, cancel, startState);
          }
          summary = { dataset: name, policy, policy_label: POLICY_LABELS[policy], regime, seed, size, rows: frame.length,
            batch_size: cfg.batch_size, initial_size: cfg.initial_size, label_fraction: cfg.label_fraction,
            label_delay_batches: cfg.label_delay_batches, cost_trace: cfg.cost_trace_kind, error_value: cfg.error_value,
            horizon_predictions: cfg.horizon_predictions, ...summary };
          rows.push(summary);
          details.push({ summary, trace: traceRows });
          done += 1;
          progress(done / total, `completed ${done}/${total}`);
        }
      }
    }
  }
  const wall = (performance.now() - started) / 1000;
  const files: string[] = [];
  if (write) {
    fs.mkdirSync(outDir, { recursive: true });
    const summaryFile = path.join(outDir, `${prefix}_summary.csv`);
    fs.writeFileSync(summaryFile, toCsv(rows.map(({ oracle_schedule: _s, ...r }) => r)));
    const detailsFile = path.join(outDir, `${prefix}_details.json`);
    fs.writeFileSync(detailsFile, dumps({ configuration: { datasets, size, rows_per_size: SAMPLE_SIZES[size], seeds,
      regimes, policies, settings: base }, runs: details, wall_seconds: wall, notes: [
      "Costs are simulated USD from the pricing snapshot; deployment risk is an expected cost.",
      "Accuracy scores every prediction offline; online policies only use revealed labels.",
      "hindsight_oracle is optimal only over {defer, full retrain} on its checkpoint grid."] }));
    const aggFile = path.join(outDir, `${prefix}_aggregate.csv`);
    fs.writeFileSync(aggFile, toCsv(aggregate(rows)));
    files.push(path.basename(summaryFile), path.basename(aggFile), path.basename(detailsFile));
  }
  return { summary: rows, wall_seconds: wall, files };
}

// ---------------------------------------------------------------- results
export function toCsv(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const fmt = (v: unknown) => {
    if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => fmt(r[c])).join(","))].join("\n") + "\n";
}

export function parseCsv(text: string): Record<string, string | number | null>[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => {
    const values = split(l);
    return Object.fromEntries(header.map((h, i) => {
      const v = values[i] ?? "";
      if (v === "") return [h, null];
      const num = Number(v);
      return [h, Number.isFinite(num) && /^[-+0-9.eE]+$/.test(v) ? num : v];
    }));
  });
}

const AGG_METRICS = ["accuracy", "macro_f1", "full_updates", "partial_updates", "evaluations", "rejected_actions",
  "blocked_actions", "budget_violations", "operational_cost", "error_cost", "total_cost", "runtime_seconds",
  "decision_seconds"];

/** Mean / std over seeds per (dataset, regime, policy), plus TCO relative to the best online policy. */
export function aggregate(summary: Summary[]): Summary[] {
  const groups = new Map<string, Summary[]>();
  for (const r of summary) {
    const k = `${r.dataset}|${r.regime}|${r.policy}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Summary[] = [];
  for (const [k, rows] of groups) {
    const [dataset, regime, policy] = k.split("|");
    const item: Summary = { dataset, regime, policy, seeds: rows.length };
    for (const m of AGG_METRICS) {
      const vals = rows.map((r) => Number(r[m])).filter(Number.isFinite);
      const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      const std = vals.length > 1 && mean !== null
        ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1)) : null;
      item[`${m}_mean`] = mean;
      item[`${m}_std`] = std;
    }
    out.push(item);
  }
  const regimeOrder = (r: string) => (REGIMES as readonly string[]).indexOf(r);
  const policyOrder = (p: string) => (POLICIES as readonly string[]).indexOf(p);
  out.sort((a, b) => (a.dataset < b.dataset ? -1 : a.dataset > b.dataset ? 1 : 0) || regimeOrder(a.regime) -
    regimeOrder(b.regime) || policyOrder(a.policy) - policyOrder(b.policy));
  for (const r of out) {
    const online = out.filter((o) => o.dataset === r.dataset && o.regime === r.regime && o.policy !== "hindsight_oracle");
    const best = Math.min(...online.map((o) => o.total_cost_mean));
    r.best_online_tco = best;
    r.tco_vs_best_online_pct = Number.isFinite(best) && best ? 100 * (r.total_cost_mean / best - 1) : null;
  }
  return out;
}
