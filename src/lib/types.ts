/** Shapes of the records the Python engine stores in SQLite (engine/database.py). */

export type Action = "defer" | "partial" | "full";
export type Regime = "cheap" | "balanced" | "expensive";

export type Settings = {
  seed: number;
  batch_size: number;
  initial_size: number;
  label_delay_batches: number;
  label_fraction: number;
  estimator: string;
  sgd_alpha: number;
  sgd_epochs: number;
  train_window: number;
  validation_fraction: number;
  f1_tolerance: number;
  rolling_window: number;
  psi_bins: number;
  psi_threshold: number;
  adwin_delta: number;
  ddm_min_instances: number;
  degradation_margin: number;
  max_batches_between_evaluations: number;
  post_update_window: number;
  probe_mode: "adaptive" | "fixed";
  probe_every: number;
  probe_min_interval: number;
  probe_max_interval: number;
  probe_window: number;
  probe_folds: number;
  probe_epochs: number;
  probe_min_labels: number;
  probe_baseline_probes: number;
  probe_drift_sd: number;
  monitoring_budget: number;
  partial_recovery_prior: number;
  full_recovery_prior: number;
  recovery_prior_weight: number;
  regime: Regime;
  cost_trace_kind: "flat" | "diurnal" | "spot" | "custom";
  cost_trace_custom: number[];
  horizon_predictions: number;
  error_value: number;
  engineer_hourly_rate: number;
  incident_cost: number;
  realization_prior: number;
  realization_prior_weight: number;
  min_evidence: number;
  cooldown_batches: number;
  min_benefit: number;
  min_confidence: number;
  action_limit: number;
  budget: number;
  calendar_every_batches: number;
  oracle_max_checkpoints: number;
  agent_mode: "deterministic" | "ollama";
  ollama_model: string;
  agent_timeout_seconds: number;
  agent_max_iterations: number;
  autonomy: boolean;
  autonomy_max_actions: number;
  autonomy_max_cost: number;
};

export type PostUpdate = {
  old_version: number;
  from_row: number;
  predicted: number;
  decision: string | null;
  old_errors: number;
  new_errors: number;
  n: number;
  action?: Action;
  avoidable?: number | null;
};

/** Difference-in-differences estimate from engine/staleness.py. */
export type StalenessEstimate = {
  available: boolean;
  did: number;
  se: number;
  ci: [number, number];
  rate: number;
  task_hardness: number;
  task_hardness_se: number;
  deployed_change: number;
  classification: string;
  n: number;
  gap: number;
  baseline_gap: number;
  deployed_error: number;
  probe_error: number;
  batch?: number;
};

export type Renewal =
  | { available: false; reason?: string }
  | { available: true; marginal: number; average: number; due: boolean; renewal_cost: number; cycle_predictions: number; cycle_avoidable_cost: number };

export type RecoveryRatio = { ratio: number; observations: number; prior?: number; ratios?: number[] };

export type ProbeRow = {
  id: number;
  run_id: string;
  batch_index: number;
  version: number;
  created: string;
  phase: "baseline" | "estimate";
  reason: string;
  voi: number | null;
  cost: number;
  n: number;
  train_rows: number;
  deployed_error: number;
  probe_error: number;
  gap: number;
  gap_se: number;
  baseline_gap: number | null;
  did: number | null;
  did_se: number | null;
  task_hardness: number | null;
  classification: string | null;
  fit_seconds: number;
};

export type CostRecord = { id: number; run_id: string; batch_index: number; created: string; kind: string; amount: number; detail: Record<string, unknown> };

export type Outcome = {
  decision: string | null;
  version: number;
  predicted_reduction: number;
  realized_reduction: number;
  n: number;
  completed_batch: number;
  action?: Action | null;
  avoidable?: number | null;
  recovery_ratio?: number;
};

export type Run = {
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
  active_version: number | null;
  monitor: {
    reference_error: number;
    reference_n: number;
    learning_debt: number;
    labels_since_update: number;
    labels_since_evaluation: number;
    predictions_since_update: number;
    adwin_alarms: number;
    ddm_drifts: number;
    change_row: number | null;
    rolling_n: number;
  };
  post_update: PostUpdate | null;
  outcomes: Outcome[];
  monitoring_spent: number;
  settings: Settings;
};

export type Telemetry = {
  batch_index: number;
  start_row: number;
  end_row: number;
  version: number;
  predicted: number;
  labels_revealed: number;
  labels_pending: number;
  label_fraction_setting: number;
  batch_n: number;
  batch_accuracy: number | null;
  batch_error: number | null;
  batch_precision: number | null;
  batch_recall: number | null;
  batch_f1: number | null;
  batch_error_ci: [number, number] | null;
  rolling_error: number | null;
  rolling_error_ci: [number, number] | null;
  rolling_n: number;
  reference_error: number;
  degradation: number | null;
  adwin_error_increase: boolean;
  adwin_detections: number;
  ddm_status: "stable" | "warning" | "drift";
  change_row: number | null;
  learning_debt: number;
  learning_debt_cost: number;
  psi: Record<string, number | null>;
  max_psi: number | null;
  max_psi_feature: string | null;
  shifted_features: string[];
  psi_reliable: boolean;
  status: string;
  covariate_signal: boolean;
  predictive_signal: boolean;
  sustained_degradation: boolean;
  unseen_category_rate: number | null;
  schema_issues: Record<string, unknown>;
  model_age_batches: number;
  predictions_since_update: number;
  labels_since_update: number;
  inference_ms: number;
  price_multiplier: number;
  spent: number;
  created: string;
  evaluation_suggested: boolean;
  trigger_reasons: string[];
  probe?: { ran: boolean; reason: string; voi: number | null; cost: number; fit_seconds?: number; phase?: string; n?: number; deployed_error?: number; probe_error?: number; gap?: number; se?: number; train_rows?: number };
  staleness?: Partial<StalenessEstimate> & { available: boolean; probes?: number; baseline_probes?: number; baseline?: { gap: number; se: number; n: number; deployed_error: number; probe_error: number; source?: string } | null };
  renewal?: Renewal;
  renewal_due?: boolean;
  monitoring_spent?: number;
  recovery?: Record<"partial" | "full", RecoveryRatio>;
};

export type Guardrail = { name: string; passed: boolean; detail: string };

export type CostItems = {
  compute: number;
  engineering: number;
  validation: number;
  deployment_risk: number;
  probe?: number;
  total: number;
  basis: Record<string, number | string>;
};

export type Evidence = {
  compatible?: boolean;
  n?: number;
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
};

export type RankedAction = {
  action: Action;
  label: string;
  rank: number;
  costs: CostItems;
  total_cost: number;
  expected_reduction: number;
  benefit: number;
  benefit_ci: [number, number];
  net_value: number;
  prob_positive: number | null;
  feasible: boolean;
  guardrails: Guardrail[];
  evidence: Evidence;
  basis?: "avoidable" | "holdout";
  recovery_ratio?: number | null;
};

export type Decision = {
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
  monitoring: Partial<Telemetry> & { labels_since_update?: number };
  evaluation: {
    charged: boolean;
    cost: CostItems | null;
    note: string | null;
    plan: {
      ok?: boolean;
      reason?: string;
      fresh?: number;
      window_basis?: string;
      holdout_interval?: [number, number];
      holdout_n?: number;
      incumbent_error?: number;
      incumbent_f1?: number;
    } | null;
  };
  candidates: Record<string, { artifact: string; sha256: string }>;
  ranked: RankedAction[];
  recommended: Action;
  context: {
    spent: number;
    batches_since_update: number;
    horizon: number;
    price_multiplier: number;
    realization: { factor?: number; observations?: number; prior?: number; ratios?: number[] };
    batch_index: number;
    avoidable?: (StalenessEstimate & { available: true }) | { available: false; reason?: string; baseline_probes?: number } | null;
    recovery?: Record<"partial" | "full", RecoveryRatio> | null;
    renewal?: Renewal | null;
  };
  probe_history?: Pick<ProbeRow, "batch_index" | "phase" | "n" | "deployed_error" | "probe_error" | "gap" | "did" | "did_se" | "task_hardness" | "classification" | "cost">[];
  assumptions: string[];
  sensitivity: { scenario: string; recommended: Action; net_partial: number; net_full: number }[];
  justification: string;
  status: string;
  outcome: string | null;
  resolved: string | null;
};

export type DecisionRow = {
  id: string;
  created: string;
  position: number;
  batch_index: number;
  version: number;
  recommended: Action;
  status: string;
  outcome: string | null;
  resolved: string | null;
};

export type ValidationGate = {
  passed: boolean;
  checks: { check: string; passed: boolean; detail: string }[];
};

export type ModelRow = {
  version: number;
  run_id: string;
  created: string;
  artifact: string | null;
  sha256: string | null;
  parent_version: number | null;
  action: string;
  status: "active" | "archived" | "rolled_back" | "rejected";
  train_start: number | null;
  train_end: number | null;
  n_train: number | null;
  seed: number | null;
  metadata: {
    reference_error?: number;
    reference_method?: string;
    validation?: ValidationGate;
    evidence?: Evidence;
    approved_by?: string;
    mode?: string;
    decision?: string;
    simulated_cost?: CostItems;
    dataset?: string;
    model?: {
      estimator?: string;
      classes?: string[];
      features?: string[];
      numeric?: string[];
      categorical?: string[];
      trained_until?: number;
      n_train?: number;
      hyperparameters?: Record<string, unknown>;
      lineage?: unknown[];
    };
    created?: string;
  };
};

export type EventRow = {
  id: number;
  created: string;
  kind: string;
  run_id: string | null;
  actor: string;
  payload: Record<string, unknown>;
};

export type ApprovalRow = {
  id: number;
  decision_id: string;
  action: Action;
  actor: string;
  mode: string;
  created: string;
  outcome: string | null;
  detail: Record<string, unknown> | null;
};

export type ExecutionRequest = {
  id: number;
  decision_id: string;
  action: Action;
  prepared_by: string;
  rationale: string;
  status: string;
  created: string;
  report_id: number | null;
};

export type AgentReport = {
  id: number;
  decision_id: string | null;
  created: string;
  mode: string;
  model: string | null;
  status: string;
  report: string;
  iterations: number;
  duration_seconds: number;
  error: string | null;
};

export type ToolCall = {
  id: number;
  report_id: number;
  created: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: string;
  result: unknown;
};

export type JobRow = {
  id: string;
  created: string;
  kind: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
  progress: number;
  message: string | null;
  cancel_requested: number;
  heartbeat: string | null;
  pid: number | null;
  payload: {
    datasets: string[];
    policies: string[];
    regimes: string[];
    seeds: number[];
    size: string;
  };
  result: { files: string[]; runs: number; wall_seconds: number } | null;
  error: string | null;
  finished: string | null;
};

export type LabelSummary = { predicted: number; available: number; revealed: number };
