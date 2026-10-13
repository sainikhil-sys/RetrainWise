/** Static catalogue mirrored from the Python engine (datasets.py, experiments.py, config.py). */

export const DATASETS = ["synthetic", "electricity", "airlines", "covertype"] as const;
export type DatasetName = (typeof DATASETS)[number];

export const SIZES = { small: 5000, standard: 20000, full: null } as const;
export type SizeName = keyof typeof SIZES;

export const REGIMES = ["cheap", "balanced", "expensive"] as const;

export const POLICIES = ["never", "calendar", "drift_triggered", "cara_ct_inspired", "retrainwise", "hindsight_oracle"] as const;
export type Policy = (typeof POLICIES)[number];

export const POLICY_LABELS: Record<Policy, string> = {
  never: "Never retrain",
  calendar: "Calendar-based",
  drift_triggered: "Drift-triggered",
  cara_ct_inspired: "Cost-aware (CARA-CT-inspired)",
  retrainwise: "RetrainWise",
  hindsight_oracle: "Hindsight oracle (full-retrain DP)",
};

export const POLICY_HELP: Record<Policy, string> = {
  never: "Keeps the initial model forever. The floor any policy should beat.",
  calendar: "Retrains fully every N batches (Settings → calendar interval), ignoring cost and evidence.",
  drift_triggered: "Retrains fully on an ADWIN error-increase alarm or DDM drift, ignoring cost.",
  cara_ct_inspired: "Cost-aware baseline inspired by CARA-CT: retrains fully when accumulated staleness cost reaches the current full-retrain cost (within budget).",
  retrainwise: "This system: a cheap probe model estimates avoidable staleness by difference-in-differences (probes scheduled by value of information); the renewal rule and monitoring decide when to evaluate; keep / partial / full is chosen by net expected value with learned recovery ratios and guardrails.",
  hindsight_oracle: "Uses future labels to choose the best defer/full schedule on a checkpoint grid. Not achievable online; an upper reference.",
};

export const POLICY_COLORS: Record<Policy, string> = {
  retrainwise: "#2dd4bf",
  calendar: "#f59e0b",
  drift_triggered: "#60a5fa",
  cara_ct_inspired: "#c084fc",
  never: "#f472b6",
  hindsight_oracle: "#94a3b8",
};

export const ACTION_LABELS = {
  defer: "Keep the existing model",
  partial: "Incremental / partial update",
  full: "Full retraining",
} as const;

export const ACTION_SHORT = { defer: "Keep", partial: "Partial", full: "Full retrain" } as const;

export const DATASET_INFO: Record<DatasetName, { title: string; blurb: string; kind: "synthetic" | "real" }> = {
  synthetic: {
    title: "Synthetic drift stream",
    blurb: "Generated locally with known abrupt, gradual, recurring and covariate-only drift points. Works fully offline.",
    kind: "synthetic",
  },
  electricity: {
    title: "Electricity (Elec2)",
    blurb: "Australian NSW electricity market, 30-minute observations in chronological order. Predict price up/down.",
    kind: "real",
  },
  airlines: {
    title: "Airlines",
    blurb: "Flight delay prediction replayed in source order (a classic drift benchmark stream).",
    kind: "real",
  },
  covertype: {
    title: "Covertype",
    blurb: "Forest cover type from cartographic variables (7 classes), replayed in UCI file order.",
    kind: "real",
  },
};
