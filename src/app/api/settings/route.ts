import { z } from "zod";

import { body, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";
import { getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = route(async () => ({ settings: await getSettings() }));

const num = z.number().finite();
const SettingsBody = z.object({
  settings: z
    .object({
      seed: num.int().min(0).max(2_147_483_647),
      batch_size: num.int().min(10).max(100_000),
      initial_size: num.int().min(50),
      label_delay_batches: num.int().min(0),
      label_fraction: num.gt(0).max(1),
      estimator: z.literal("sgd_logistic"),
      sgd_alpha: num.positive(),
      sgd_epochs: num.int().min(1),
      train_window: num.int().min(100),
      validation_fraction: num.min(0.05).max(0.6),
      f1_tolerance: num.min(0),
      rolling_window: num.int().min(1),
      psi_bins: num.int().min(2).max(50),
      psi_threshold: num.min(0),
      adwin_delta: num.gt(0).lt(1),
      ddm_min_instances: num.int().min(0),
      degradation_margin: num.min(0),
      max_batches_between_evaluations: num.int().min(1),
      post_update_window: num.int().min(0),
      probe_mode: z.enum(["adaptive", "fixed"]),
      probe_every: num.int().min(1),
      probe_min_interval: num.int().min(1),
      probe_max_interval: num.int().min(1),
      probe_window: num.int().min(100),
      probe_folds: num.int().min(2).max(20),
      probe_epochs: num.int().min(1),
      probe_min_labels: num.int().min(10),
      probe_baseline_probes: num.int().min(1),
      probe_drift_sd: num.min(0),
      monitoring_budget: num.min(0),
      partial_recovery_prior: num.min(0).max(1.5),
      full_recovery_prior: num.min(0).max(1.5),
      recovery_prior_weight: num.min(0),
      regime: z.enum(["cheap", "balanced", "expensive"]),
      cost_trace_kind: z.enum(["flat", "diurnal", "spot", "custom"]),
      cost_trace_custom: z.array(num.positive()).min(1).max(1000),
      horizon_predictions: num.int().min(1),
      error_value: num.min(0),
      engineer_hourly_rate: num.min(0),
      incident_cost: num.min(0),
      realization_prior: num.min(0).max(1.5),
      realization_prior_weight: num.min(0),
      min_evidence: num.int().min(1),
      cooldown_batches: num.int().min(0),
      min_benefit: num.min(0),
      min_confidence: num.gt(0).lt(1),
      action_limit: num.min(0),
      budget: num.min(0),
      calendar_every_batches: num.int().min(1),
      oracle_max_checkpoints: num.int().min(1),
      agent_mode: z.enum(["deterministic", "ollama"]),
      ollama_model: z.string().regex(/^[A-Za-z0-9._:/-]{1,80}$/, "must be a short model tag such as llama3.1"),
      agent_timeout_seconds: num.int().min(1).max(600),
      agent_max_iterations: num.int().min(1).max(12),
      autonomy: z.boolean(),
      autonomy_max_actions: num.int().min(0),
      autonomy_max_cost: num.min(0),
    })
    .strict(),
});

/** Save validated settings. Pending decisions become stale (their assumptions changed). */
export const PUT = route(async (req) => {
  const b = await body(req, SettingsBody);
  return engineCall("save_settings", { settings: b.settings }, { timeoutMs: 60_000, dedupeKey: "settings" });
});
