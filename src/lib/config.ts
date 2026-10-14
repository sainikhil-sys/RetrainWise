/**
 * Validated, serializable settings for RetrainWise.
 *
 * All monetary values are *assumed* USD used by the simulated cost model.
 * Nothing here talks to a billing account. The active settings are stored in
 * SQLite (see lifecycle.ts).
 */
import path from "node:path";

export const DATA_DIR = path.resolve(process.env.RETRAINWISE_DATA_DIR || path.join(process.cwd(), "data"));
export const DB_PATH = path.join(DATA_DIR, "retrainwise.db");
export const MODELS_DIR = path.join(DATA_DIR, "models");
export const DATASETS_DIR = path.join(DATA_DIR, "datasets");
export const RESULTS_DIR = path.join(DATA_DIR, "results");
export const LOG_PATH = path.join(DATA_DIR, "retrainwise.log");

export const REGIMES = ["cheap", "balanced", "expensive"] as const;
export const COST_TRACE_KINDS = ["flat", "diurnal", "spot", "custom"] as const;
export const AGENT_MODES = ["deterministic", "ollama"] as const;
export const ESTIMATORS = ["sgd_logistic"] as const;

export type Regime = (typeof REGIMES)[number];
export type CostTraceKind = (typeof COST_TRACE_KINDS)[number];
export type AgentMode = (typeof AGENT_MODES)[number];

/** Experiment sample sizes: rows taken from the start of the source-ordered stream (null = all). */
export const SAMPLE_SIZES: Record<string, number | null> = { small: 5_000, standard: 20_000, full: null };
export type SizeLabel = keyof typeof SAMPLE_SIZES;

export interface Settings {
  // Stream and reproducibility
  seed: number;
  batch_size: number;
  initial_size: number;
  label_delay_batches: number;
  label_fraction: number;
  // Model
  estimator: string;
  sgd_alpha: number;
  sgd_epochs: number;
  train_window: number;
  validation_fraction: number;
  f1_tolerance: number;
  // Monitoring
  rolling_window: number;
  psi_bins: number;
  psi_threshold: number;
  adwin_delta: number;
  ddm_min_instances: number;
  degradation_margin: number;
  max_batches_between_evaluations: number;
  post_update_window: number;
  // Economics
  regime: Regime;
  cost_trace_kind: CostTraceKind;
  cost_trace_custom: number[];
  horizon_predictions: number;
  error_value: number;
  engineer_hourly_rate: number;
  incident_cost: number;
  realization_prior: number;
  realization_prior_weight: number;
  // Guardrails
  min_evidence: number;
  cooldown_batches: number;
  min_benefit: number;
  min_confidence: number;
  action_limit: number;
  budget: number;
  // Baselines (benchmark only)
  calendar_every_batches: number;
  oracle_max_checkpoints: number;
  // Agent and autonomy
  agent_mode: AgentMode;
  ollama_model: string;
  agent_timeout_seconds: number;
  agent_max_iterations: number;
  autonomy: boolean;
  autonomy_max_actions: number;
  autonomy_max_cost: number;
}

export const DEFAULT_SETTINGS: Settings = {
  seed: 42,
  batch_size: 500,
  initial_size: 1_000,
  label_delay_batches: 0,
  label_fraction: 1.0,
  estimator: "sgd_logistic",
  sgd_alpha: 1e-4,
  sgd_epochs: 15,
  train_window: 3_000,
  validation_fraction: 0.3,
  f1_tolerance: 0.02,
  rolling_window: 1_000,
  psi_bins: 10,
  psi_threshold: 0.2,
  adwin_delta: 0.002,
  ddm_min_instances: 30,
  degradation_margin: 0.02,
  max_batches_between_evaluations: 10,
  post_update_window: 500,
  regime: "balanced",
  cost_trace_kind: "diurnal",
  cost_trace_custom: [1.0],
  horizon_predictions: 5_000,
  error_value: 1.0,
  engineer_hourly_rate: 80.0,
  incident_cost: 1_000.0,
  realization_prior: 0.7,
  realization_prior_weight: 2.0,
  min_evidence: 150,
  cooldown_batches: 2,
  min_benefit: 10.0,
  min_confidence: 0.8,
  action_limit: 1_000.0,
  budget: 3_000.0,
  calendar_every_batches: 10,
  oracle_max_checkpoints: 60,
  agent_mode: "deterministic",
  ollama_model: "llama3.1",
  agent_timeout_seconds: 240,
  agent_max_iterations: 6,
  autonomy: false,
  autonomy_max_actions: 3,
  autonomy_max_cost: 200.0,
};

const INTEGER_FIELDS: (keyof Settings)[] = [
  "seed", "batch_size", "initial_size", "label_delay_batches", "sgd_epochs", "train_window", "rolling_window",
  "psi_bins", "ddm_min_instances", "max_batches_between_evaluations", "post_update_window", "horizon_predictions",
  "min_evidence", "cooldown_batches", "calendar_every_batches", "oracle_max_checkpoints", "agent_timeout_seconds",
  "agent_max_iterations", "autonomy_max_actions",
];

export class SettingsError extends Error {}

function fail(message: string): never {
  throw new SettingsError(message);
}

export function validateSettings(s: Settings): Settings {
  for (const [key, value] of Object.entries(s)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      fail(`${key} must be finite and non-negative (got ${value})`);
    }
  }
  for (const key of INTEGER_FIELDS) {
    if (!Number.isInteger(s[key])) fail(`${key} must be an integer`);
  }
  if (typeof s.autonomy !== "boolean") fail("autonomy must be true or false");
  if (s.batch_size < 10 || s.batch_size > 100_000) fail("batch_size must be between 10 and 100000");
  if (s.initial_size < 50) fail("initial_size must be at least 50");
  if (s.train_window < 100) fail("train_window must be at least 100");
  if (s.validation_fraction < 0.05 || s.validation_fraction > 0.6) fail("validation_fraction must be between 0.05 and 0.6");
  if (!(s.label_fraction > 0 && s.label_fraction <= 1)) fail("label_fraction must be in (0, 1]");
  if (!(s.adwin_delta > 0 && s.adwin_delta < 1)) fail("adwin_delta must be in (0, 1)");
  if (!(s.min_confidence > 0 && s.min_confidence < 1)) fail("min_confidence must be in (0, 1)");
  if (s.realization_prior < 0 || s.realization_prior > 1.5) fail("realization_prior must be in [0, 1.5]");
  if (s.sgd_alpha <= 0 || s.sgd_epochs < 1) fail("sgd_alpha must be positive and sgd_epochs at least 1");
  if (s.psi_bins < 2 || s.psi_bins > 50) fail("psi_bins must be between 2 and 50");
  if (Math.min(s.rolling_window, s.horizon_predictions, s.min_evidence, s.calendar_every_batches,
    s.oracle_max_checkpoints, s.agent_max_iterations, s.agent_timeout_seconds) < 1) {
    fail("windows, horizon, evidence and limits must be at least 1");
  }
  if (s.agent_max_iterations > 12 || s.agent_timeout_seconds > 600) {
    fail("agent limits too large (max 12 iterations, 600 seconds)");
  }
  if (!REGIMES.includes(s.regime)) fail(`regime must be one of ${REGIMES.join(", ")}`);
  if (!COST_TRACE_KINDS.includes(s.cost_trace_kind)) fail(`cost_trace_kind must be one of ${COST_TRACE_KINDS.join(", ")}`);
  if (!AGENT_MODES.includes(s.agent_mode)) fail(`agent_mode must be one of ${AGENT_MODES.join(", ")}`);
  if (!(ESTIMATORS as readonly string[]).includes(s.estimator)) fail(`estimator must be one of ${ESTIMATORS.join(", ")}`);
  const trace = s.cost_trace_custom;
  if (!Array.isArray(trace) || trace.length === 0 || trace.length > 1_000 ||
    trace.some((v) => typeof v !== "number" || !Number.isFinite(v) || v <= 0)) {
    fail("cost_trace_custom needs 1-1000 positive finite multipliers");
  }
  const name = s.ollama_model;
  if (typeof name !== "string" || name.length === 0 || name.length > 80 || !/^[A-Za-z0-9._:\-/]+$/.test(name)) {
    fail("ollama_model must be a short model tag such as llama3.1");
  }
  return s;
}

/** Build settings from a partial object, rejecting unknown keys and wrong types. */
export function settingsFrom(data: Partial<Record<string, unknown>> | null | undefined): Settings {
  const input = { ...(data || {}) };
  const unknown = Object.keys(input).filter((k) => !(k in DEFAULT_SETTINGS));
  if (unknown.length) fail(`Unknown settings: ${unknown.sort().join(", ")}`);
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    const expected = typeof (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
    if (key === "cost_trace_custom") {
      if (!Array.isArray(value)) fail("cost_trace_custom must be a list of numbers");
      out[key] = value.map(Number);
    } else if (expected === "number") {
      const num = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
      if (typeof num !== "number" || Number.isNaN(num)) fail(`${key} must be a number`);
      out[key] = num;
    } else if (expected === "boolean") {
      if (typeof value !== "boolean") fail(`${key} must be true or false`);
      out[key] = value;
    } else {
      if (typeof value !== "string") fail(`${key} must be text`);
      out[key] = value;
    }
  }
  return validateSettings(out as unknown as Settings);
}

export function replaceSettings(s: Settings, changes: Partial<Settings>): Settings {
  return settingsFrom({ ...s, ...changes });
}

/** Resolve a bare file name inside a directory; reject traversal. */
export function safeChild(dir: string, name: string): string {
  if (typeof name !== "string" || !name || path.basename(name) !== name || name.startsWith(".")) {
    throw new Error(`Unsafe file name: ${JSON.stringify(name)}`);
  }
  const full = path.resolve(dir, name);
  if (path.dirname(full) !== path.resolve(dir)) throw new Error(`Unsafe file name: ${JSON.stringify(name)}`);
  return full;
}
