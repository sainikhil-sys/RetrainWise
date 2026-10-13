"""Cost-benefit decision engine (L2).

    expected benefit  = estimated avoidable error reduction x predictions over horizon x value per avoided error
    total action cost = compute + engineering + validation + expected deployment-risk cost + probe evaluation cost
    net expected value = expected benefit - total action cost        (keep = 0 reference)

The avoidable error comes from the probe-model difference-in-differences
estimate (``staleness.py``); each action recovers a learned share of it (its
recovery ratio). When no probe evidence exists yet, the error-rate reduction
measured by chronological shadow evaluation (``models.shadow_evaluate``),
scaled by a realisation factor, is used instead. All prices are simulated/assumed.
"""
from __future__ import annotations

import json
import math
from functools import lru_cache

import numpy as np

from config import PRICING_PATH

ACTIONS = ("defer", "partial", "full")
ACTION_LABELS = {"defer": "Keep the existing model", "partial": "Incremental / partial update",
                 "full": "Full retraining"}
COST_KEYS = ("compute", "engineering", "validation", "deployment_risk", "probe")


@lru_cache(maxsize=4)
def _pricing_cached(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def pricing(path=PRICING_PATH) -> dict:
    return json.loads(_pricing_cached(str(path)))


def _finite(name: str, value, minimum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, np.integer, np.floating)):
        raise ValueError(f"{name} must be numeric")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{name} must be finite")
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be >= {minimum}")
    return value


# ----------------------------------------------------------------- cost traces
def cost_trace(settings, n_batches: int) -> np.ndarray:
    """Deterministic compute-price multipliers per batch, shared by all policies
    that replay the same (dataset, seed, regime) cell."""
    n = max(int(n_batches), 1)
    kind = settings.cost_trace_kind
    rng = np.random.default_rng(settings.seed * 7919 + 17)
    b = np.arange(n)
    if kind == "flat":
        trace = np.ones(n)
    elif kind == "diurnal":
        trace = 1 + 0.3 * np.sin(2 * np.pi * b / 24) + rng.normal(0, 0.05, n)
    elif kind == "spot":
        level, values = 0.0, []
        for _ in range(n):
            level = 0.8 * level + rng.normal(0, 0.25)
            spike = 3.0 if rng.random() < 0.05 else 1.0
            values.append(0.45 * math.exp(level) * spike)
        trace = np.array(values)
    else:
        custom = np.asarray(settings.cost_trace_custom, float)
        trace = np.resize(custom, n)
    return np.clip(trace, 0.2, 5.0)


def trace_multiplier(settings, batch_index: int, trace: np.ndarray | None = None) -> float:
    batch_index = int(_finite("batch_index", batch_index, 0))
    if trace is None:
        trace = cost_trace(settings, batch_index + 1)
    return float(trace[min(batch_index, len(trace) - 1)])


# ----------------------------------------------------------------------- costs
def action_costs(action: str, settings, n_train_rows: int, multiplier: float = 1.0,
                 prices: dict | None = None, include_probe: bool = True) -> dict:
    """Itemised simulated cost of one action (or of a shadow 'evaluation')."""
    if action == "defer":
        return {**{k: 0.0 for k in COST_KEYS}, "total": 0.0, "basis": {}}
    if action not in ("partial", "full", "evaluation", "probe"):
        raise ValueError(f"Unknown action {action!r}")
    n_train_rows = _finite("n_train_rows", n_train_rows, 0)
    multiplier = _finite("multiplier", multiplier, 0)
    prices = prices or pricing()
    regime = prices["regimes"][settings.regime]
    profile = regime[action]
    rate = prices["instances"][regime["instance"]]["usd_per_hour"]
    hours = profile["compute_hours_per_10k_rows"] * max(0.25, n_train_rows / 10_000)
    items = {
        "compute": (hours * rate + profile.get("fixed_usd", 0.0)) * multiplier,
        "engineering": profile["engineer_hours"] * settings.engineer_hourly_rate,
        "validation": profile["validation_hours"] * settings.engineer_hourly_rate,
        "deployment_risk": profile["incident_probability"] * settings.incident_cost,
        # An update is verified afterwards by one probe evaluation (post-update monitoring).
        "probe": action_costs("probe", settings, settings.probe_window * settings.probe_folds, multiplier, prices)["total"]
        if action in ("partial", "full") and include_probe else 0.0,
    }
    items = {k: float(v) for k, v in items.items()}
    items["total"] = float(sum(items.values()))
    items["basis"] = {"instance": regime["instance"], "usd_per_hour": rate, "compute_hours": hours,
                      "price_multiplier": multiplier, "engineer_hours": profile["engineer_hours"],
                      "validation_hours": profile["validation_hours"],
                      "incident_probability": profile["incident_probability"],
                      "engineer_hourly_rate": settings.engineer_hourly_rate,
                      "incident_cost": settings.incident_cost}
    return items


# ------------------------------------------------------------- realisation
def realization_factor(outcomes: list[dict], settings) -> dict:
    """Shrunk mean of realised/predicted error reduction from past updates.

    Each outcome holds the shadow-predicted reduction and the reduction
    actually measured afterwards against the retired model on new labels.
    The prior (default 0.7) encodes that retraining does not guarantee recovery.
    """
    ratios = []
    for o in outcomes:
        predicted = o.get("predicted_reduction")
        realized = o.get("realized_reduction")
        if predicted is None or realized is None or predicted <= 0.005:
            continue
        ratios.append(float(np.clip(realized / predicted, 0.0, 1.5)))
    w = settings.realization_prior_weight
    value = (w * settings.realization_prior + sum(ratios)) / (w + len(ratios))
    return {"factor": float(value), "observations": len(ratios), "prior": settings.realization_prior,
            "ratios": ratios[-10:]}


def _phi(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


# --------------------------------------------------------------------- ranking
def rank_actions(evidence: dict, context: dict, settings, prices: dict | None = None) -> dict:
    """Rank keep (defer) / partial / full by net expected value with guardrails.

    ``context`` keys: batch_index, spent, batches_since_update, horizon,
    price_multiplier, n_train_rows (per action), realization (factor dict),
    and optionally the probe evidence from ``staleness.py``:
    avoidable (difference-in-differences avoidable error), recovery (learned
    recovery ratio per action) and renewal (marginal-vs-average rule).
    """
    settings.validate()
    spent = _finite("spent", context.get("spent", 0.0), 0)
    since = _finite("batches_since_update", context.get("batches_since_update", 0), 0)
    horizon = _finite("horizon", context.get("horizon", settings.horizon_predictions), 0)
    multiplier = _finite("price_multiplier", context.get("price_multiplier", 1.0), 0)
    factor = _finite("realization factor", context.get("realization", {}).get("factor", settings.realization_prior), 0)
    avoidable = context.get("avoidable") or {}
    use_avoidable = bool(avoidable.get("available")) and getattr(settings, "benefit_basis", "probe") == "probe"
    recovery = context.get("recovery") or {}
    renewal = context.get("renewal") or {}
    rows = []
    for action in ACTIONS:
        if action == "defer":
            rows.append({"action": "defer", "label": ACTION_LABELS["defer"],
                         "costs": action_costs("defer", settings, 0), "total_cost": 0.0,
                         "expected_reduction": 0.0, "benefit": 0.0, "benefit_ci": [0.0, 0.0],
                         "net_value": 0.0, "prob_positive": None, "feasible": True,
                         "guardrails": [{"name": "reference action", "passed": True,
                                         "detail": "Defer is always available and has zero incremental value."}],
                         "evidence": {}})
            continue
        ev = dict(evidence.get(action) or {"compatible": False, "n": 0, "reason": "not evaluated"})
        n_rows = context.get("n_train_rows", {}).get(action, ev.get("train_rows", 0)) or 0
        costs = action_costs(action, settings, n_rows, multiplier, prices)
        total = costs["total"]
        guards = []
        ratio, basis = None, "holdout"
        if ev.get("compatible"):
            reduction = _finite("reduction", ev["reduction"])
            se = _finite("reduction_se", ev["reduction_se"], 0)
            if abs(reduction) > 1 or se > 1:
                raise ValueError("Error-rate reduction must be within [-1, 1]")
            if use_avoidable:
                # Research rule: an action recovers a learned share of the avoidable
                # (difference-in-differences) error, not the raw hold-out difference.
                default = settings.full_recovery_prior if action == "full" else settings.partial_recovery_prior
                ratio = _finite("recovery ratio", (recovery.get(action) or {}).get("ratio", default), 0)
                rate = max(0.0, _finite("avoidable error", avoidable.get("rate", 0.0)))
                exp_red = rate * ratio
                red_se = _finite("avoidable se", avoidable.get("se", 0.0), 0) * ratio
                basis = "avoidable"
            else:
                exp_red = reduction * factor
                red_se = se * factor
            benefit = exp_red * horizon * settings.error_value
            benefit_se = max(red_se * horizon * settings.error_value, 1e-9)
            net = benefit - total
            prob = _phi(net / benefit_se)
            ci = [benefit - 1.96 * benefit_se, benefit + 1.96 * benefit_se]
        else:
            exp_red = benefit = 0.0
            net, prob, ci = -total, 0.0, [0.0, 0.0]
        guards.append({"name": "candidate available / incremental compatibility",
                       "passed": bool(ev.get("compatible")),
                       "detail": ev.get("reason", "candidate trained and scored")})
        guards.append({"name": "minimum evidence", "passed": ev.get("n", 0) >= settings.min_evidence,
                       "detail": f"{ev.get('n', 0)} hold-out labels (minimum {settings.min_evidence})"})
        guards.append({"name": "cooldown", "passed": since >= settings.cooldown_batches,
                       "detail": f"{int(since)} batches since last update (minimum {settings.cooldown_batches})"})
        guards.append({"name": "minimum expected benefit", "passed": benefit >= settings.min_benefit,
                       "detail": f"${benefit:,.2f} vs ${settings.min_benefit:,.2f}"})
        guards.append({"name": "positive net expected value", "passed": net > 0,
                       "detail": f"${net:,.2f}"})
        guards.append({"name": "confidence P(net > 0)", "passed": prob >= settings.min_confidence,
                       "detail": f"{prob:.2f} vs {settings.min_confidence:.2f}"})
        guards.append({"name": "action spending limit", "passed": total <= settings.action_limit,
                       "detail": f"${total:,.2f} vs ${settings.action_limit:,.2f}"})
        guards.append({"name": "cumulative budget", "passed": spent + total <= settings.budget,
                       "detail": f"${spent:,.2f} spent + ${total:,.2f} vs ${settings.budget:,.2f}"})
        if basis == "avoidable":
            hi = (ev.get("reduction_ci") or [0.0, 0.0])[1]
            guards.append({"name": "hold-out does not contradict the probe", "passed": hi > 0,
                           "detail": f"candidate hold-out reduction 95% upper bound {hi:+.3f} (must be > 0)"})
        if renewal.get("available") and use_avoidable:
            guards.append({"name": "renewal rule (marginal >= average)", "passed": bool(renewal.get("due")),
                           "detail": f"avoidable cost ${renewal['marginal']:.4f}/prediction vs running cycle "
                                     f"average ${renewal['average']:.4f}/prediction"})
        else:
            guards.append({"name": "renewal rule (marginal >= average)", "passed": True,
                           "detail": "not applied (hold-out basis selected)" if renewal.get("available")
                           else "no probe evidence for this model version yet; rule not applied"})
        rows.append({"action": action, "label": ACTION_LABELS[action], "costs": costs, "total_cost": total,
                     "expected_reduction": exp_red, "benefit": benefit, "benefit_ci": ci,
                     "net_value": net, "prob_positive": prob, "basis": basis, "recovery_ratio": ratio,
                     "feasible": all(g["passed"] for g in guards), "guardrails": guards, "evidence": ev})
    rows.sort(key=lambda r: (r["feasible"], r["net_value"]), reverse=True)
    for i, r in enumerate(rows, 1):
        r["rank"] = i
    recommended = rows[0]["action"]
    return {"ranked": rows, "recommended": recommended,
            "context": {"spent": spent, "batches_since_update": since, "horizon": horizon,
                        "price_multiplier": multiplier, "realization": context.get("realization", {}),
                        "batch_index": context.get("batch_index"), "avoidable": avoidable or None,
                        "recovery": recovery or None, "renewal": renewal or None},
            "assumptions": assumptions(settings)}


def assumptions(settings) -> list[str]:
    return [
        "Expected error reduction = avoidable error (probe difference-in-differences) x the action's learned "
        "recovery ratio when probe evidence exists; otherwise the chronological hold-out reduction x realisation factor.",
        f"Prices are simulated USD from the '{settings.regime}' regime of pricing_snapshot.json (assumed, not live).",
        f"Value of avoiding one prediction error: ${settings.error_value:,.2f} (assumed).",
        f"Decision horizon: {settings.horizon_predictions:,} predictions; benefit assumes the hold-out "
        "error difference persists over the horizon, scaled by the realisation factor.",
        "Error-rate reduction is estimated on a chronological hold-out that no compared model was trained on.",
        "Deployment-risk cost is an expected value (incident probability x incident cost), not an observed incident.",
        "Shadow evaluation overhead is already spent once candidates are evaluated, so it does not change the ranking.",
    ]


def justification(decision: dict) -> str:
    """Readable deterministic justification of a ranked decision."""
    top = decision["ranked"][0]
    lines = [f"Recommendation: {top['label']}."]
    ctx = decision.get("context") or {}
    avoid, renewal = ctx.get("avoidable") or {}, ctx.get("renewal") or {}
    if avoid.get("available"):
        lines.append(f"Probe evidence: avoidable error {avoid['did']:+.3f} (difference-in-differences, 95% CI "
                     f"{avoid['ci'][0]:+.3f} to {avoid['ci'][1]:+.3f}); common task-hardness shift "
                     f"{avoid['task_hardness']:+.3f}.")
    else:
        lines.append("No probe baseline for this model version yet: benefits use the hold-out reduction instead.")
    if renewal.get("available"):
        lines.append(f"Renewal rule: avoidable cost ${renewal['marginal']:.4f}/prediction vs cycle average "
                     f"${renewal['average']:.4f}/prediction -> {'update due' if renewal['due'] else 'not yet due'}.")
    for r in decision["ranked"]:
        if r["action"] == "defer":
            continue
        ev = r["evidence"]
        if ev.get("compatible"):
            basis = (f"expected reduction {r['expected_reduction']:+.4f} = avoidable error x recovery ratio "
                     f"{r['recovery_ratio']:.2f}" if r.get("basis") == "avoidable" else
                     f"expected reduction {r['expected_reduction']:+.4f} from the hold-out")
            lines.append(
                f"{r['label']}: hold-out error {ev['incumbent_error']:.3f} -> {ev['candidate_error']:.3f} "
                f"on {ev['n']} labels (reduction {ev['reduction']:+.3f}, 95% CI {ev['reduction_ci'][0]:+.3f} to "
                f"{ev['reduction_ci'][1]:+.3f}); {basis}; expected benefit ${r['benefit']:,.2f} vs cost "
                f"${r['total_cost']:,.2f}; net ${r['net_value']:,.2f}; P(net>0) = {r['prob_positive']:.2f}.")
        else:
            lines.append(f"{r['label']}: not available ({ev.get('reason', 'not evaluated')}).")
        failed = [g["name"] for g in r["guardrails"] if not g["passed"]]
        if failed:
            lines.append(f"  Blocked by guardrails: {', '.join(failed)}.")
    if top["action"] == "defer":
        lines.append("No update clears every guardrail with positive net value, so keeping the existing model is the "
                     "conservative choice.")
    return "\n".join(lines)


def sensitivity(evidence: dict, context: dict, settings, prices: dict | None = None) -> list[dict]:
    """Recommended action under alternative assumptions (one factor at a time)."""
    scenarios = [("baseline", {})]
    for f in (0.25, 0.5, 2.0, 4.0):
        scenarios.append((f"error value x{f}", {"error_value": settings.error_value * f}))
    for f in (0.5, 2.0):
        scenarios.append((f"horizon x{f}", {"horizon_predictions": max(1, int(settings.horizon_predictions * f))}))
    for regime in ("cheap", "balanced", "expensive"):
        if regime != settings.regime:
            scenarios.append((f"{regime} cost regime", {"regime": regime}))
    for f in (0.4, 1.0):
        scenarios.append((f"realisation factor {f}", {"_factor": f}))
    avoid = context.get("avoidable") or {}
    if avoid.get("available"):
        for f in (0.5, 1.5):
            scenarios.append((f"recovery ratios x{f}", {"_recovery": f}))
        scenarios.append(("avoidable error at 95% lower bound", {"_avoid_low": True}))
    out = []
    for name, change in scenarios:
        ctx = dict(context)
        change = dict(change)
        if "_factor" in change:
            ctx["realization"] = {"factor": change.pop("_factor")}
        if "_recovery" in change:
            f = change.pop("_recovery")
            base = context.get("recovery") or {}
            ctx["recovery"] = {a: {"ratio": (base.get(a) or {}).get("ratio", default) * f}
                               for a, default in (("partial", settings.partial_recovery_prior),
                                                  ("full", settings.full_recovery_prior))}
        if change.pop("_avoid_low", False):
            ctx["avoidable"] = {**avoid, "rate": max(0.0, avoid["rate"] - 1.96 * avoid.get("se", 0.0))}
        cfg = settings.replace(**change) if change else settings
        if "horizon_predictions" in change:
            ctx["horizon"] = cfg.horizon_predictions
        result = rank_actions(evidence, ctx, cfg, prices)
        nets = {r["action"]: r["net_value"] for r in result["ranked"]}
        out.append({"scenario": name, "recommended": result["recommended"],
                    "net_partial": nets["partial"], "net_full": nets["full"]})
    return out
