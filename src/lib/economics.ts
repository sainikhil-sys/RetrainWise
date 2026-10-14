/**
 * Cost-benefit decision engine (L2).
 *
 *   expected benefit  = estimated error-rate reduction x predictions over horizon x value per avoided error
 *   total action cost = compute + engineering + validation + expected deployment-risk cost
 *   net expected value = expected benefit - total action cost        (defer = 0 reference)
 *
 * The error-rate reduction comes from chronological shadow evaluation, scaled
 * by a realisation factor learned from measured outcomes of previous updates.
 * All prices are simulated / assumed.
 */
import { replaceSettings, validateSettings, REGIMES, type Settings } from "./config";
import type { Evidence } from "./ml/models";
import snapshot from "./pricing_snapshot.json";
import { Rng } from "./rng";

export const ACTIONS = ["defer", "partial", "full"] as const;
export type Action = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<Action, string> = {
  defer: "Defer (keep current model)", partial: "Partial / incremental update", full: "Full retraining",
};
export const COST_KEYS = ["compute", "engineering", "validation", "deployment_risk"] as const;

interface Profile {
  compute_hours_per_10k_rows: number;
  engineer_hours: number;
  validation_hours: number;
  incident_probability: number;
}
export interface Pricing {
  label: string;
  captured: string;
  verification_status: string;
  currency: string;
  sources_to_check: string[];
  instances: Record<string, { provider: string; region: string; vcpu: number; memory_gib: number; gpu?: string;
    usd_per_hour: number }>;
  regimes: Record<string, { description: string; instance: string; full: Profile; partial: Profile; evaluation: Profile }>;
  notes: string[];
}

export function pricing(): Pricing {
  return snapshot as Pricing;
}

function finite(name: string, value: unknown, minimum?: number): number {
  if (typeof value !== "number") throw new Error(`${name} must be numeric`);
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  if (minimum !== undefined && value < minimum) throw new Error(`${name} must be >= ${minimum}`);
  return value;
}

// ----------------------------------------------------------------- cost traces
/** Deterministic compute-price multipliers per batch, shared by every policy replaying the same cell. */
export function costTrace(settings: Settings, nBatches: number): number[] {
  const n = Math.max(Math.trunc(nBatches), 1);
  const rng = new Rng(settings.seed * 7919 + 17);
  let trace: number[];
  if (settings.cost_trace_kind === "flat") {
    trace = new Array(n).fill(1);
  } else if (settings.cost_trace_kind === "diurnal") {
    trace = Array.from({ length: n }, (_, b) => 1 + 0.3 * Math.sin((2 * Math.PI * b) / 24) + rng.normal(0, 0.05));
  } else if (settings.cost_trace_kind === "spot") {
    let level = 0;
    trace = [];
    for (let i = 0; i < n; i++) {
      level = 0.8 * level + rng.normal(0, 0.25);
      const spike = rng.random() < 0.05 ? 3 : 1;
      trace.push(0.45 * Math.exp(level) * spike);
    }
  } else {
    const custom = settings.cost_trace_custom;
    trace = Array.from({ length: n }, (_, i) => custom[i % custom.length]);
  }
  return trace.map((v) => Math.min(5, Math.max(0.2, v)));
}

// ----------------------------------------------------------------------- costs
export interface Costs {
  compute: number;
  engineering: number;
  validation: number;
  deployment_risk: number;
  total: number;
  basis: Record<string, unknown>;
}

/** Itemised simulated cost of one action (or of a shadow "evaluation"). */
export function actionCosts(action: Action | "evaluation", settings: Settings, nTrainRows: number,
  multiplier = 1.0, prices: Pricing = pricing()): Costs {
  if (action === "defer") return { compute: 0, engineering: 0, validation: 0, deployment_risk: 0, total: 0, basis: {} };
  if (!["partial", "full", "evaluation"].includes(action)) throw new Error(`Unknown action ${action}`);
  const rows = finite("n_train_rows", nTrainRows, 0);
  const mult = finite("multiplier", multiplier, 0);
  const regime = prices.regimes[settings.regime];
  const profile = regime[action as "partial" | "full" | "evaluation"];
  const rate = prices.instances[regime.instance].usd_per_hour;
  const hours = profile.compute_hours_per_10k_rows * Math.max(0.25, rows / 10_000);
  const items = {
    compute: hours * rate * mult,
    engineering: profile.engineer_hours * settings.engineer_hourly_rate,
    validation: profile.validation_hours * settings.engineer_hourly_rate,
    deployment_risk: profile.incident_probability * settings.incident_cost,
  };
  return {
    ...items, total: items.compute + items.engineering + items.validation + items.deployment_risk,
    basis: { instance: regime.instance, usd_per_hour: rate, compute_hours: hours, price_multiplier: mult,
      engineer_hours: profile.engineer_hours, validation_hours: profile.validation_hours,
      incident_probability: profile.incident_probability, engineer_hourly_rate: settings.engineer_hourly_rate,
      incident_cost: settings.incident_cost },
  };
}

// ------------------------------------------------------------- realisation
export interface Outcome {
  predicted_reduction?: number | null;
  realized_reduction?: number | null;
  [key: string]: unknown;
}
export interface Realization {
  factor: number;
  observations?: number;
  prior?: number;
  ratios?: number[];
}

/** Shrunk mean of realised / predicted error reduction from past updates (prior 0.7 by default). */
export function realizationFactor(outcomes: Outcome[], settings: Settings): Realization {
  const ratios: number[] = [];
  for (const o of outcomes) {
    const p = o.predicted_reduction;
    const r = o.realized_reduction;
    if (p === null || p === undefined || r === null || r === undefined || p <= 0.005) continue;
    ratios.push(Math.min(1.5, Math.max(0, r / p)));
  }
  const w = settings.realization_prior_weight;
  const value = (w * settings.realization_prior + ratios.reduce((a, b) => a + b, 0)) / (w + ratios.length);
  return { factor: value, observations: ratios.length, prior: settings.realization_prior, ratios: ratios.slice(-10) };
}

function erf(x: number): number {
  // Abramowitz-Stegun 7.1.26 refined with a series near zero (|error| < 1e-7)
  const sign = Math.sign(x);
  const ax = Math.abs(x);
  if (ax < 0.5) {
    let sum = 0;
    let term = ax;
    for (let n = 0; n < 30; n++) {
      sum += term / (2 * n + 1);
      term *= (-ax * ax) / (n + 1);
    }
    return sign * (2 / Math.sqrt(Math.PI)) * sum;
  }
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
    Math.exp(-ax * ax);
  return sign * y;
}

export function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

// --------------------------------------------------------------------- ranking
export interface Guardrail {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RankedAction {
  action: Action;
  label: string;
  costs: Costs;
  total_cost: number;
  expected_reduction: number;
  benefit: number;
  benefit_ci: [number, number];
  net_value: number;
  prob_positive: number | null;
  feasible: boolean;
  guardrails: Guardrail[];
  evidence: Evidence | Record<string, never>;
  rank?: number;
}

export interface DecisionContext {
  spent?: number;
  batches_since_update?: number;
  horizon?: number;
  price_multiplier?: number;
  batch_index?: number;
  realization?: Realization;
  n_train_rows?: Partial<Record<Action, number>>;
}

export interface Ranking {
  ranked: RankedAction[];
  recommended: Action;
  context: DecisionContext;
  assumptions: string[];
}

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Rank defer / partial / full by net expected value with guardrails. */
export function rankActions(evidence: Partial<Record<"full" | "partial", Evidence>>, context: DecisionContext,
  settings: Settings, prices: Pricing = pricing()): Ranking {
  validateSettings(settings);
  const spent = finite("spent", context.spent ?? 0, 0);
  const since = finite("batches_since_update", context.batches_since_update ?? 0, 0);
  const horizon = finite("horizon", context.horizon ?? settings.horizon_predictions, 0);
  const multiplier = finite("price_multiplier", context.price_multiplier ?? 1, 0);
  const factor = finite("realization factor", context.realization?.factor ?? settings.realization_prior, 0);
  const rows: RankedAction[] = [];
  for (const action of ACTIONS) {
    if (action === "defer") {
      rows.push({ action, label: ACTION_LABELS.defer, costs: actionCosts("defer", settings, 0), total_cost: 0,
        expected_reduction: 0, benefit: 0, benefit_ci: [0, 0], net_value: 0, prob_positive: null, feasible: true,
        guardrails: [{ name: "reference action", passed: true,
          detail: "Defer is always available and has zero incremental value." }], evidence: {} });
      continue;
    }
    const ev: Evidence = { ...(evidence[action] ?? { compatible: false, n: 0, reason: "not evaluated" }) };
    const nRows = context.n_train_rows?.[action] ?? ev.train_rows ?? 0;
    const costs = actionCosts(action, settings, nRows, multiplier, prices);
    const total = costs.total;
    let expRed = 0;
    let benefit = 0;
    let net = -total;
    let prob = 0;
    let ci: [number, number] = [0, 0];
    if (ev.compatible) {
      const reduction = finite("reduction", ev.reduction);
      const se = finite("reduction_se", ev.reduction_se, 0);
      if (Math.abs(reduction) > 1 || se > 1) throw new Error("Error-rate reduction must be within [-1, 1]");
      expRed = reduction * factor;
      benefit = expRed * horizon * settings.error_value;
      const benefitSe = Math.max(se * factor * horizon * settings.error_value, 1e-9);
      net = benefit - total;
      prob = phi(net / benefitSe);
      ci = [benefit - 1.96 * benefitSe, benefit + 1.96 * benefitSe];
    }
    const guards: Guardrail[] = [
      { name: "candidate available / incremental compatibility", passed: Boolean(ev.compatible),
        detail: ev.reason || "candidate trained and scored" },
      { name: "minimum evidence", passed: (ev.n || 0) >= settings.min_evidence,
        detail: `${ev.n || 0} hold-out labels (minimum ${settings.min_evidence})` },
      { name: "cooldown", passed: since >= settings.cooldown_batches,
        detail: `${Math.trunc(since)} batches since last update (minimum ${settings.cooldown_batches})` },
      { name: "minimum expected benefit", passed: benefit >= settings.min_benefit,
        detail: `${money(benefit)} vs ${money(settings.min_benefit)}` },
      { name: "positive net expected value", passed: net > 0, detail: money(net) },
      { name: "confidence P(net > 0)", passed: prob >= settings.min_confidence,
        detail: `${prob.toFixed(2)} vs ${settings.min_confidence.toFixed(2)}` },
      { name: "action spending limit", passed: total <= settings.action_limit,
        detail: `${money(total)} vs ${money(settings.action_limit)}` },
      { name: "cumulative budget", passed: spent + total <= settings.budget,
        detail: `${money(spent)} spent + ${money(total)} vs ${money(settings.budget)}` },
    ];
    rows.push({ action, label: ACTION_LABELS[action], costs, total_cost: total, expected_reduction: expRed, benefit,
      benefit_ci: ci, net_value: net, prob_positive: prob, feasible: guards.every((g) => g.passed), guardrails: guards,
      evidence: ev });
  }
  // feasible first, then by net value (stable for ties, like Python's sort)
  rows.sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.net_value - a.net_value);
  rows.forEach((r, i) => (r.rank = i + 1));
  return {
    ranked: rows, recommended: rows[0].action,
    context: { spent, batches_since_update: since, horizon, price_multiplier: multiplier,
      realization: context.realization ?? { factor: settings.realization_prior }, batch_index: context.batch_index },
    assumptions: assumptions(settings),
  };
}

export function assumptions(settings: Settings): string[] {
  return [
    `Prices are simulated USD from the '${settings.regime}' regime of the pricing snapshot (assumed, not live).`,
    `Value of avoiding one prediction error: ${money(settings.error_value)} (assumed).`,
    `Decision horizon: ${settings.horizon_predictions.toLocaleString("en-US")} predictions; benefit assumes the ` +
      "hold-out error difference persists over the horizon, scaled by the realisation factor.",
    "Error-rate reduction is estimated on a chronological hold-out that no compared model was trained on.",
    "Deployment-risk cost is an expected value (incident probability x incident cost), not an observed incident.",
    "Shadow evaluation overhead is already spent once candidates are evaluated, so it does not change the ranking.",
  ];
}

const signed = (v: number) => (v >= 0 ? "+" : "") + v.toFixed(3);

/** Readable deterministic justification of a ranked decision. */
export function justification(decision: { ranked: RankedAction[] }): string {
  const top = decision.ranked[0];
  const lines = [`Recommendation: ${top.label}.`];
  for (const r of decision.ranked) {
    if (r.action === "defer") continue;
    const ev = r.evidence as Evidence;
    if (ev.compatible) {
      lines.push(`${r.label}: hold-out error ${ev.incumbent_error!.toFixed(3)} -> ${ev.candidate_error!.toFixed(3)} ` +
        `on ${ev.n} labels (reduction ${signed(ev.reduction!)}, 95% CI ${signed(ev.reduction_ci![0])} to ` +
        `${signed(ev.reduction_ci![1])}); expected benefit ${money(r.benefit)} vs cost ${money(r.total_cost)}; ` +
        `net ${money(r.net_value)}; P(net>0) = ${(r.prob_positive ?? 0).toFixed(2)}.`);
    } else {
      lines.push(`${r.label}: not available (${ev.reason || "not evaluated"}).`);
    }
    const failed = r.guardrails.filter((g) => !g.passed).map((g) => g.name);
    if (failed.length) lines.push(`  Blocked by guardrails: ${failed.join(", ")}.`);
  }
  if (top.action === "defer") {
    lines.push("No update clears every guardrail with positive net value, so deferring is the conservative choice.");
  }
  return lines.join("\n");
}

export interface SensitivityRow {
  scenario: string;
  recommended: Action;
  net_partial: number;
  net_full: number;
}

/** Recommended action under alternative assumptions (one factor at a time). */
export function sensitivity(evidence: Partial<Record<"full" | "partial", Evidence>>, context: DecisionContext,
  settings: Settings, prices: Pricing = pricing()): SensitivityRow[] {
  const scenarios: [string, Partial<Settings>, number | null][] = [["baseline", {}, null]];
  for (const f of [0.25, 0.5, 2.0, 4.0]) scenarios.push([`error value x${f}`, { error_value: settings.error_value * f }, null]);
  for (const f of [0.5, 2.0]) {
    scenarios.push([`horizon x${f}`, { horizon_predictions: Math.max(1, Math.trunc(settings.horizon_predictions * f)) }, null]);
  }
  for (const regime of REGIMES) if (regime !== settings.regime) scenarios.push([`${regime} cost regime`, { regime }, null]);
  for (const f of [0.4, 1.0]) scenarios.push([`realisation factor ${f}`, {}, f]);
  return scenarios.map(([name, change, factor]) => {
    const ctx: DecisionContext = { ...context };
    if (factor !== null) ctx.realization = { factor };
    const cfg = Object.keys(change).length ? replaceSettings(settings, change) : settings;
    if ("horizon_predictions" in change) ctx.horizon = cfg.horizon_predictions;
    const result = rankActions(evidence, ctx, cfg, prices);
    const nets = Object.fromEntries(result.ranked.map((r) => [r.action, r.net_value]));
    return { scenario: name, recommended: result.recommended, net_partial: nets.partial, net_full: nets.full };
  });
}
