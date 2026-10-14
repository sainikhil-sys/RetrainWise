/**
 * Model lifecycle primitives: full training, incremental updates,
 * chronological shadow evaluation, the validation gate and checksummed artifacts.
 *
 * Leakage rules enforced here:
 * - every model records `trained_until` (one past the last stream row it has
 *   learned from) and incremental updates refuse rows before it;
 * - shadow candidates are evaluated only on a chronological hold-out made of
 *   the most recent labelled rows that neither the incumbent nor the candidate saw;
 * - the candidate that is promoted is exactly the one that was validated.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { Settings } from "../config";
import { classificationMetrics, psiReference, type PsiReference } from "../monitoring";
import type { Frame } from "./frame";
import { categoryVocabulary, encode, fitTransformer, inferSchema, schemaIssues, type Schema,
  type Transformer } from "./preprocess";
import { fitSgd, partialFitSgd, predictSgd, type SgdState } from "./sgd";

export const ARTIFACT_FORMAT = "retrainwise-model-v2";

export interface ModelBundle {
  transformer: Transformer;
  estimator: SgdState;
  schema: Schema;
  classes: string[];
  vocabulary: Record<string, string[]>;
  train_start: number;
  train_end: number;
  trained_until: number;
  n_train: number;
  seed: number;
  hyperparameters: Record<string, unknown>;
  psi_reference: PsiReference;
  history: { kind: string; rows: number; interval: [number, number] }[];
}

export function predict(model: ModelBundle, frame: Frame, rows: number[]): string[] {
  if (!rows.length) return [];
  return predictSgd(model.estimator, encode(model.transformer, frame, rows));
}

export function describe(model: ModelBundle): Record<string, unknown> {
  return {
    estimator: "SGD logistic regression", classes: model.classes, features: model.schema.features,
    numeric: model.schema.numeric, categorical: model.schema.categorical,
    train_interval: [model.train_start, model.train_end], trained_until: model.trained_until,
    n_train: model.n_train, seed: model.seed, hyperparameters: model.hyperparameters, lineage: model.history,
  };
}

function isChronological(rows: number[]): boolean {
  for (let i = 1; i < rows.length; i++) if (rows[i] <= rows[i - 1]) return false;
  return true;
}

/** Fit preprocessing and a fresh estimator on `rows` only (stream indices in chronological order). */
export function trainFull(frame: Frame, rows: number[], settings: Settings, seed?: number): ModelBundle {
  if (rows.length < 20) throw new Error("Full training needs at least 20 labelled rows");
  if (!isChronological(rows)) throw new Error("Training rows must be in chronological order");
  const s = seed ?? settings.seed;
  const y = rows.map((r) => frame.target[r]);
  if (new Set(y).size < 2) throw new Error("Training window contains a single class; full retraining is not possible");
  const schema = inferSchema(frame);
  const transformer = fitTransformer(frame, rows, schema);
  const estimator = fitSgd(encode(transformer, frame, rows), y, { alpha: settings.sgd_alpha, epochs: settings.sgd_epochs,
    seed: s });
  const start = rows[0];
  const end = rows[rows.length - 1] + 1;
  return {
    transformer, estimator, schema, classes: estimator.classes, vocabulary: categoryVocabulary(frame, rows, schema),
    train_start: start, train_end: end, trained_until: end, n_train: rows.length, seed: s,
    hyperparameters: { loss: "log_loss", alpha: settings.sgd_alpha, epochs: settings.sgd_epochs },
    psi_reference: psiReference(frame, rows, settings.psi_bins),
    history: [{ kind: "full", rows: rows.length, interval: [start, end] }],
  };
}

/** Genuine incremental learning: one SGD pass over new rows with preprocessing frozen. Returns a new bundle. */
export function partialUpdate(model: ModelBundle, frame: Frame, rows: number[]): ModelBundle {
  if (!rows.length) throw new Error("No new labelled rows for an incremental update");
  if (rows[0] < model.trained_until) throw new Error("Incremental rows overlap data the model already learned from");
  if (!isChronological(rows)) throw new Error("Incremental rows must be chronological");
  const issues = schemaIssues(frame, model.schema);
  if (issues.missing_columns.length) {
    throw new Error(`Schema changed (missing ${issues.missing_columns.join(", ")}); full retraining required`);
  }
  const y = rows.map((r) => frame.target[r]);
  const estimator = partialFitSgd(model.estimator, encode(model.transformer, frame, rows), y);
  const end = rows[rows.length - 1] + 1;
  return {
    ...model, estimator, trained_until: end, n_train: model.n_train + rows.length,
    history: [...model.history, { kind: "partial", rows: rows.length, interval: [rows[0], end] }],
  };
}

export interface ReferenceInfo {
  reference_error: number;
  reference_n: number;
  method: string;
}

/**
 * Train the first model on the initial window. The reference error comes from
 * a chronological 80/20 split of that window; the deployed model is then fit
 * on the whole window (so the estimate is slightly pessimistic).
 */
export function initialModel(frame: Frame, settings: Settings): [ModelBundle, ReferenceInfo] {
  const n = Math.min(settings.initial_size, frame.length);
  const rows = Array.from({ length: n }, (_, i) => i);
  const cut = Math.floor(n * 0.8);
  const probe = trainFull(frame, rows.slice(0, cut), settings);
  const tail = rows.slice(cut);
  const m = classificationMetrics(tail.map((r) => frame.target[r]), predict(probe, frame, tail));
  return [trainFull(frame, rows, settings), { reference_error: m.error ?? 0, reference_n: m.n,
    method: "chronological 80/20 split of the initial window" }];
}

// ------------------------------------------------------------ shadow evaluation
export const MIN_POST_CHANGE_ROWS = 300;

/** Rows for full retraining: labelled rows since an ADWIN change point when there are enough, else the last window. */
export function recentWindow(eligible: number[], settings: Settings, changeRow: number | null = null): [number[], string] {
  const sorted = [...eligible].sort((a, b) => a - b);
  if (changeRow !== null && changeRow !== undefined) {
    const post = sorted.filter((r) => r >= changeRow);
    if (post.length >= MIN_POST_CHANGE_ROWS) {
      return [post.slice(-settings.train_window), `post-change window (rows >= ${changeRow})`];
    }
  }
  return [sorted.slice(-settings.train_window), `last ${settings.train_window} labelled rows`];
}

export type WindowPlan =
  | { ok: false; reason: string; fresh: number }
  | { ok: true; holdout: number[]; full_rows: number[]; partial_rows: number[]; fresh: number; window_basis: string };

/** Choose chronological train / hold-out rows from labels revealed so far. */
export function planWindows(eligible: number[], incumbent: ModelBundle, settings: Settings,
  changeRow: number | null = null): WindowPlan {
  const sorted = [...eligible].sort((a, b) => a - b);
  const [window, basis] = recentWindow(sorted, settings, changeRow);
  const fresh = sorted.filter((r) => r >= incumbent.trained_until);
  const target = Math.ceil(settings.validation_fraction * window.length);
  const holdoutN = fresh.length >= 2 * target ? target : Math.floor(fresh.length / 2);
  if (holdoutN < 20) {
    return { ok: false, reason: `only ${fresh.length} labelled rows newer than the incumbent's training data`,
      fresh: fresh.length };
  }
  const holdout = fresh.slice(-holdoutN);
  const start = holdout[0];
  return { ok: true, holdout, full_rows: window.filter((r) => r < start), partial_rows: fresh.filter((r) => r < start),
    fresh: fresh.length, window_basis: basis };
}

export interface Evidence {
  compatible: boolean;
  n: number;
  reason?: string;
  train_rows?: number;
  train_interval?: [number, number] | null;
  holdout_interval?: [number, number];
  incumbent_error?: number;
  candidate_error?: number;
  incumbent_f1?: number;
  candidate_f1?: number;
  reduction?: number;
  reduction_se?: number;
  reduction_ci?: [number, number];
  discordant?: number;
  fit_seconds?: number;
}

function paired(incumbentErr: boolean[], candidateErr: boolean[]) {
  const n = incumbentErr.length;
  const diff = incumbentErr.map((e, i) => Number(e) - Number(candidateErr[i]));
  const mean = diff.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(diff.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1)) : 1;
  const se = Math.max(sd / Math.sqrt(n), 0.5 / n); // floor avoids false certainty on tiny/identical samples
  return { reduction: mean, reduction_se: se, reduction_ci: [mean - 1.96 * se, mean + 1.96 * se] as [number, number],
    discordant: diff.filter((d) => d !== 0).length };
}

export interface ShadowResult {
  candidates: Partial<Record<"full" | "partial", ModelBundle>>;
  evidence: Record<"full" | "partial", Evidence>;
  plan: Record<string, unknown>;
}

/** Train full and partial candidates and score them, with the incumbent, on the same untouched hold-out. */
export function shadowEvaluate(frame: Frame, eligible: number[], incumbent: ModelBundle, settings: Settings,
  changeRow: number | null = null): ShadowResult {
  const plan = planWindows(eligible, incumbent, settings, changeRow);
  const result: ShadowResult = { candidates: {}, evidence: {} as ShadowResult["evidence"],
    plan: { ok: plan.ok, fresh: plan.fresh, ...(plan.ok ? { window_basis: plan.window_basis } : { reason: plan.reason }) } };
  if (!plan.ok) {
    for (const action of ["full", "partial"] as const) result.evidence[action] = { compatible: false, n: 0, reason: plan.reason };
    return result;
  }
  const hy = plan.holdout.map((r) => frame.target[r]);
  const incPred = predict(incumbent, frame, plan.holdout);
  const incErr = incPred.map((p, i) => p !== hy[i]);
  const incM = classificationMetrics(hy, incPred);
  const holdoutInterval: [number, number] = [plan.holdout[0], plan.holdout[plan.holdout.length - 1] + 1];
  Object.assign(result.plan, { holdout_interval: holdoutInterval, holdout_n: plan.holdout.length,
    incumbent_error: incM.error, incumbent_f1: incM.f1 });
  const builders = {
    full: () => trainFull(frame, plan.full_rows, settings),
    partial: () => partialUpdate(incumbent, frame, plan.partial_rows),
  };
  for (const action of ["full", "partial"] as const) {
    const rows = action === "full" ? plan.full_rows : plan.partial_rows;
    const started = performance.now();
    let evidence: Evidence;
    try {
      const candidate = builders[action]();
      const pred = predict(candidate, frame, plan.holdout);
      const candM = classificationMetrics(hy, pred);
      evidence = {
        compatible: true, n: plan.holdout.length, train_rows: rows.length,
        train_interval: rows.length ? [rows[0], rows[rows.length - 1] + 1] : null, holdout_interval: holdoutInterval,
        incumbent_error: incM.error ?? 0, candidate_error: candM.error ?? 0, incumbent_f1: incM.f1 ?? 0,
        candidate_f1: candM.f1 ?? 0, ...paired(incErr, pred.map((p, i) => p !== hy[i])),
      };
      result.candidates[action] = candidate;
    } catch (exc) {
      evidence = { compatible: false, n: plan.holdout.length, train_rows: rows.length, reason: (exc as Error).message };
    }
    evidence.fit_seconds = (performance.now() - started) / 1000;
    result.evidence[action] = evidence;
  }
  return result;
}

export interface GateCheck {
  check: string;
  passed: boolean;
  detail: string;
}

/** Deterministic promotion gate applied to the chronological hold-out. */
export function validationGate(evidence: Evidence, settings: Settings): { passed: boolean; checks: GateCheck[] } {
  if (!evidence.compatible) {
    return { passed: false, checks: [{ check: "candidate available", passed: false, detail: evidence.reason || "" }] };
  }
  const e = evidence as Required<Evidence>;
  const checks: GateCheck[] = [
    { check: "hold-out error lower than incumbent", passed: e.reduction > 0,
      detail: `${e.candidate_error.toFixed(4)} vs ${e.incumbent_error.toFixed(4)}` },
    { check: `macro-F1 not lower by more than ${settings.f1_tolerance}`,
      passed: e.candidate_f1 >= e.incumbent_f1 - settings.f1_tolerance,
      detail: `${e.candidate_f1.toFixed(4)} vs ${e.incumbent_f1.toFixed(4)}` },
    { check: "hold-out size >= minimum evidence", passed: e.n >= settings.min_evidence, detail: `${e.n} labels` },
  ];
  return { passed: checks.every((c) => c.passed), checks };
}

// ------------------------------------------------------------------ artifacts
export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Persist model + preprocessing + schema + classes + metadata as JSON; return its SHA-256. */
export function saveArtifact(model: ModelBundle, file: string, metadata: Record<string, unknown>): string {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ format: ARTIFACT_FORMAT, model, metadata }));
  fs.renameSync(tmp, file);
  return sha256File(file);
}

/** Load only artifacts this application wrote: the registry checksum must match before parsing. */
export function loadArtifact(file: string, expectedSha256: string | null | undefined): [ModelBundle, Record<string, unknown>] {
  if (!fs.existsSync(file)) throw new Error(`Model artifact ${file.split(/[\\/]/).pop()} is missing`);
  if (!expectedSha256 || sha256File(file) !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${file.split(/[\\/]/).pop()}; refusing to load`);
  }
  const payload = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!payload || payload.format !== ARTIFACT_FORMAT || !payload.model?.estimator) {
    throw new Error("Unrecognised artifact format");
  }
  return [payload.model as ModelBundle, payload.metadata ?? {}];
}
