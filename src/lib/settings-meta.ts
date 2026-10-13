import type { Settings } from "./types";

/** Mirrors engine/config.py defaults. The Python engine remains the authority on validation. */
export const DEFAULT_SETTINGS: Settings = {
  seed: 42,
  batch_size: 500,
  initial_size: 1000,
  label_delay_batches: 0,
  label_fraction: 1.0,
  estimator: "sgd_logistic",
  sgd_alpha: 1e-4,
  sgd_epochs: 15,
  train_window: 3000,
  validation_fraction: 0.3,
  f1_tolerance: 0.02,
  rolling_window: 1000,
  psi_bins: 10,
  psi_threshold: 0.2,
  adwin_delta: 0.002,
  ddm_min_instances: 30,
  degradation_margin: 0.02,
  max_batches_between_evaluations: 10,
  post_update_window: 500,
  probe_mode: "adaptive",
  probe_every: 2,
  probe_min_interval: 1,
  probe_max_interval: 6,
  probe_window: 500,
  probe_folds: 5,
  probe_epochs: 3,
  probe_min_labels: 50,
  probe_baseline_probes: 2,
  probe_drift_sd: 0.01,
  monitoring_budget: 300.0,
  partial_recovery_prior: 0.5,
  full_recovery_prior: 0.9,
  recovery_prior_weight: 2.0,
  benefit_basis: "probe",
  regime: "balanced",
  cost_trace_kind: "diurnal",
  cost_trace_custom: [1.0],
  horizon_predictions: 5000,
  error_value: 1.0,
  engineer_hourly_rate: 80.0,
  incident_cost: 1000.0,
  realization_prior: 0.7,
  realization_prior_weight: 2.0,
  min_evidence: 150,
  cooldown_batches: 2,
  min_benefit: 10.0,
  min_confidence: 0.8,
  action_limit: 1000.0,
  budget: 3000.0,
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

export type FieldMeta = {
  key: keyof Settings;
  label: string;
  help: string;
  kind: "int" | "float" | "money" | "select" | "toggle" | "text" | "list" | "fraction";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  unit?: string;
};

export type FieldGroup = { id: string; title: string; description: string; simulated?: boolean; fields: FieldMeta[] };

export const SETTINGS_GROUPS: FieldGroup[] = [
  {
    id: "economics",
    title: "Economics",
    description:
      "How RetrainWise prices actions and values accuracy. All dollar amounts are assumed values for a simulated cost model, not billing data.",
    simulated: true,
    fields: [
      {
        key: "regime",
        label: "Cost regime",
        help: "Pricing profile from pricing_snapshot.json: cheap (small CPU, automated), balanced (mid-size CPU, engineer review) or expensive (GPU, regulated sign-off).",
        kind: "select",
        options: [
          { value: "cheap", label: "Cheap" },
          { value: "balanced", label: "Balanced" },
          { value: "expensive", label: "Expensive" },
        ],
      },
      { key: "error_value", label: "Value of avoiding one error", help: "Assumed dollar value of one prediction error avoided. Multiplies the expected benefit.", kind: "money", min: 0, max: 1_000_000, step: 0.1 },
      { key: "horizon_predictions", label: "Prediction horizon", help: "How many future predictions the expected error-rate reduction is assumed to persist for.", kind: "int", min: 1, max: 10_000_000, step: 500, unit: "predictions" },
      {
        key: "cost_trace_kind",
        label: "Compute price trace",
        help: "How the compute price varies over time: flat, a diurnal cycle, spot-like jumps or your own multipliers.",
        kind: "select",
        options: [
          { value: "flat", label: "Flat" },
          { value: "diurnal", label: "Diurnal" },
          { value: "spot", label: "Spot-like" },
          { value: "custom", label: "Custom" },
        ],
      },
      { key: "cost_trace_custom", label: "Custom price multipliers", help: "Comma-separated positive multipliers used when the trace is 'custom' (1–1000 values, repeated over batches).", kind: "list" },
      { key: "engineer_hourly_rate", label: "Engineer hourly rate", help: "Assumed labour cost for engineering and validation hours.", kind: "money", min: 0, max: 10_000, step: 5 },
      { key: "incident_cost", label: "Incident cost", help: "Assumed cost of a bad deployment. Deployment-risk cost = incident probability × this value.", kind: "money", min: 0, max: 10_000_000, step: 100 },
      { key: "realization_prior", label: "Realisation prior", help: "Share of the hold-out gain expected to survive in production before any update has been measured (0–1.5).", kind: "float", min: 0, max: 1.5, step: 0.05 },
      { key: "realization_prior_weight", label: "Prior weight", help: "How many measured updates the prior is worth when blending it with observed outcomes.", kind: "float", min: 0, max: 100, step: 0.5 },
    ],
  },
  {
    id: "guardrails",
    title: "Budgets and guardrails",
    description: "Hard limits every update must pass, both when it is recommended and again just before it runs.",
    simulated: true,
    fields: [
      { key: "budget", label: "Cumulative budget", help: "Maximum simulated spend per run, including shadow-evaluation overhead.", kind: "money", min: 0, max: 1e9, step: 100 },
      { key: "action_limit", label: "Per-action spending limit", help: "No single update may cost more than this.", kind: "money", min: 0, max: 1e9, step: 50 },
      { key: "min_benefit", label: "Minimum expected benefit", help: "Updates whose expected benefit is below this are blocked.", kind: "money", min: 0, max: 1e9, step: 5 },
      { key: "min_confidence", label: "Required P(net value > 0)", help: "Confidence that the net expected value is positive, from the hold-out uncertainty.", kind: "float", min: 0.5, max: 0.99, step: 0.01 },
      { key: "min_evidence", label: "Minimum evidence", help: "Minimum number of new labels (and hold-out labels) before candidates are trained or promoted.", kind: "int", min: 1, max: 100_000, step: 10, unit: "labels" },
      { key: "cooldown_batches", label: "Cooldown", help: "Batches that must pass after an update before another one is allowed.", kind: "int", min: 0, max: 1000, step: 1, unit: "batches" },
      { key: "max_batches_between_evaluations", label: "Max batches between evaluations", help: "A periodic staleness check is suggested after this many batches without an evaluation.", kind: "int", min: 1, max: 1000, step: 1, unit: "batches" },
      { key: "f1_tolerance", label: "Validation macro-F1 tolerance", help: "The validation gate rejects a candidate whose hold-out macro-F1 falls more than this below the incumbent's.", kind: "float", min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    id: "probe",
    title: "Probe model and staleness",
    description:
      "A cheap probe model trained on recent labels is scored next to the deployed model on the same new labels. The difference-in-differences of their errors estimates avoidable staleness. Probes cost (simulated) money, so they are scheduled by value of information within a monitoring budget.",
    simulated: true,
    fields: [
      {
        key: "probe_mode",
        label: "Probe scheduling",
        help: "Adaptive: probe when the expected value of information exceeds the probe cost (plus min/max intervals). Fixed: probe every N batches.",
        kind: "select",
        options: [
          { value: "adaptive", label: "Adaptive (value of information)" },
          { value: "fixed", label: "Fixed frequency" },
        ],
      },
      { key: "probe_every", label: "Fixed probe frequency", help: "With fixed scheduling, probe every N batches.", kind: "int", min: 1, max: 1000, step: 1, unit: "batches" },
      { key: "probe_min_interval", label: "Minimum probe interval", help: "Adaptive scheduling never probes more often than this.", kind: "int", min: 1, max: 1000, step: 1, unit: "batches" },
      { key: "probe_max_interval", label: "Maximum probe interval", help: "Adaptive scheduling always probes at least this often (unless the monitoring budget is spent).", kind: "int", min: 1, max: 1000, step: 1, unit: "batches" },
      { key: "monitoring_budget", label: "Monitoring budget", help: "Total simulated spend allowed for probes in one run. Probes stop when it is used up.", kind: "money", min: 0, max: 1e9, step: 10 },
      { key: "probe_window", label: "Probe training window", help: "Most recent labelled rows each probe is trained on (cross-fitted: never the rows it is scored on).", kind: "int", min: 100, max: 1_000_000, step: 100, unit: "rows" },
      { key: "probe_folds", label: "Cross-fitting folds", help: "New labels are split into this many interleaved folds; each fold is scored by a probe trained on the other folds plus earlier rows, so the probe is fresh but never sees the rows it is scored on.", kind: "int", min: 2, max: 20, step: 1 },
      { key: "probe_epochs", label: "Probe epochs", help: "SGD epochs for the probe. Fewer epochs = cheaper but weaker probe; the baseline gap absorbs that difference.", kind: "int", min: 1, max: 200, step: 1 },
      { key: "probe_min_labels", label: "Minimum labels per probe", help: "New labels from the current model version needed to score a probe.", kind: "int", min: 10, max: 100_000, step: 10, unit: "labels" },
      { key: "probe_baseline_probes", label: "Baseline probes", help: "Probes pooled right after a deployment to measure the normal deployed-vs-probe gap.", kind: "int", min: 1, max: 50, step: 1 },
      { key: "probe_drift_sd", label: "Belief drift per batch", help: "How quickly uncertainty about avoidable error grows between probes (standard deviation per batch).", kind: "float", min: 0, max: 1, step: 0.005 },
      { key: "partial_recovery_prior", label: "Partial-update recovery prior", help: "Share of the avoidable error an incremental update is expected to recover before any has been measured.", kind: "float", min: 0, max: 1.5, step: 0.05 },
      { key: "full_recovery_prior", label: "Full-retrain recovery prior", help: "Share of the avoidable error a full retrain is expected to recover before any has been measured.", kind: "float", min: 0, max: 1.5, step: 0.05 },
      { key: "recovery_prior_weight", label: "Recovery prior weight", help: "How many measured updates each prior is worth when learning recovery ratios.", kind: "float", min: 0, max: 100, step: 0.5 },
    ],
  },
  {
    id: "monitoring",
    title: "Monitoring and evidence",
    description: "Windows and thresholds for the drift detectors and the rolling error estimate.",
    fields: [
      { key: "rolling_window", label: "Rolling window", help: "Number of most recent labelled predictions used for the rolling error and its 95% Wilson interval.", kind: "int", min: 10, max: 100_000, step: 100, unit: "labels" },
      { key: "psi_threshold", label: "PSI threshold", help: "Population Stability Index above which a feature counts as shifted (0.2 is a common rule of thumb).", kind: "float", min: 0.01, max: 5, step: 0.05 },
      { key: "psi_bins", label: "PSI bins", help: "Quantile bins fixed from each model's training window.", kind: "int", min: 2, max: 50, step: 1 },
      { key: "adwin_delta", label: "ADWIN delta", help: "ADWIN confidence parameter; smaller values mean fewer, more certain alarms.", kind: "float", min: 0.000001, max: 0.5, step: 0.0005 },
      { key: "ddm_min_instances", label: "DDM warm-up", help: "Labels DDM needs before it can raise warnings or drift.", kind: "int", min: 1, max: 10_000, step: 5, unit: "labels" },
      { key: "degradation_margin", label: "Degradation margin", help: "Sustained degradation = rolling-error lower CI bound above reference error + this margin.", kind: "float", min: 0, max: 1, step: 0.01 },
      { key: "post_update_window", label: "Post-update window", help: "Labels used to measure the realised gain of a promoted model against the model it replaced.", kind: "int", min: 10, max: 100_000, step: 50, unit: "labels" },
    ],
  },
  {
    id: "stream",
    title: "Stream and labels",
    description: "Batch size and label availability apply to the next batch. Initial size and seed apply to new runs.",
    fields: [
      { key: "batch_size", label: "Batch size", help: "Rows predicted per batch.", kind: "int", min: 10, max: 100_000, step: 50, unit: "rows" },
      { key: "initial_size", label: "Initial training rows", help: "Rows used to train the first model of a new run.", kind: "int", min: 50, max: 1_000_000, step: 100, unit: "rows" },
      { key: "label_delay_batches", label: "Label delay", help: "Batches between a prediction and the arrival of its true label.", kind: "int", min: 0, max: 100, step: 1, unit: "batches" },
      { key: "label_fraction", label: "Label availability", help: "Share of predictions that ever receive a label (sampled reproducibly from the seed).", kind: "fraction", min: 0.01, max: 1, step: 0.05 },
      { key: "seed", label: "Default seed", help: "Controls SGD randomness, label sampling, cost traces and the synthetic generator.", kind: "int", min: 0, max: 2_147_483_647, step: 1 },
    ],
  },
  {
    id: "model",
    title: "Model",
    description: "scikit-learn SGDClassifier (logistic loss). Full retraining fits a new model; incremental updates call partial_fit.",
    fields: [
      { key: "train_window", label: "Full-retrain window", help: "Most recent labelled rows used by full retraining (or rows since an ADWIN change point).", kind: "int", min: 100, max: 1_000_000, step: 100, unit: "rows" },
      { key: "validation_fraction", label: "Hold-out fraction", help: "Share of the window kept back as the chronological hold-out that no compared model trains on.", kind: "float", min: 0.05, max: 0.6, step: 0.05 },
      { key: "sgd_alpha", label: "SGD alpha", help: "L2 regularisation strength.", kind: "float", min: 0.0000001, max: 1, step: 0.0001 },
      { key: "sgd_epochs", label: "SGD epochs", help: "Passes over the training rows for a full retrain.", kind: "int", min: 1, max: 200, step: 1 },
      { key: "calendar_every_batches", label: "Calendar interval (benchmarks)", help: "How often the calendar baseline retrains in experiments.", kind: "int", min: 1, max: 1000, step: 1, unit: "batches" },
      { key: "oracle_max_checkpoints", label: "Oracle checkpoints (benchmarks)", help: "Size of the hindsight oracle's decision grid.", kind: "int", min: 1, max: 500, step: 5 },
    ],
  },
  {
    id: "agent",
    title: "Agent and bounded autonomy",
    description:
      "The agent explains decisions and can only prepare a request. With bounded autonomy on, a batch that triggers evaluation may execute the top action automatically, but only within the limits below and only if every guardrail and the validation gate pass.",
    fields: [
      {
        key: "agent_mode",
        label: "Default explanation mode",
        help: "Deterministic uses no language model. Ollama calls a local model with read-only tools.",
        kind: "select",
        options: [
          { value: "deterministic", label: "Deterministic (no LLM)" },
          { value: "ollama", label: "Local Ollama" },
        ],
      },
      { key: "ollama_model", label: "Ollama model tag", help: "A local tool-calling model, for example llama3.1 or qwen2.5.", kind: "text" },
      { key: "agent_max_iterations", label: "Agent max iterations", help: "Tool-calling rounds before the agent must answer (1–12).", kind: "int", min: 1, max: 12, step: 1 },
      { key: "agent_timeout_seconds", label: "Agent time budget", help: "Total seconds for one explanation (5–600).", kind: "int", min: 5, max: 600, step: 5, unit: "s" },
      { key: "autonomy", label: "Bounded autonomy", help: "Off by default. When on, the engine may act without a click, but never beyond these limits.", kind: "toggle" },
      { key: "autonomy_max_actions", label: "Max autonomous actions per run", help: "After this many automatic actions, approval is required again.", kind: "int", min: 0, max: 100, step: 1 },
      { key: "autonomy_max_cost", label: "Max autonomous action cost", help: "More expensive actions always wait for a human.", kind: "money", min: 0, max: 1_000_000, step: 10 },
    ],
  },
];
