"""Counterfactual staleness estimation with a probe model (RetrainWise research approach).

Probe model
    A cheap, fresh model (``probe_epochs`` SGD epochs) trained on the most recent
    ``probe_window`` labelled rows. It is *cross-fitted* over the newly labelled
    rows it is scored on: they are split into ``probe_folds`` interleaved folds
    and each fold is predicted by a probe trained on the other folds plus the
    rows before them. Every probe prediction is therefore out-of-sample, yet
    the probe has seen the newest data - a probe trained only on earlier rows
    would be as stale as the deployed model right after an abrupt change.

Difference-in-differences (DiD)
    On the same newly labelled observations, the per-row error gap is
    d_i = err_deployed_i - err_probe_i. Right after a model version is deployed
    the gap reflects only the capacity difference between the deployed model and
    the cheaper probe (the *baseline gap*). It is measured at deployment time on
    the chronological hold-out the new model was validated on - rows the model
    never trained on and on which it is fresh by construction. If that is not
    possible (for example after a rollback) the first ``probe_baseline_probes``
    probes after deployment are pooled instead. Later,

        DiD = gap_now - gap_baseline
            = (E_deployed,now - E_deployed,base) - (E_probe,now - E_probe,base)

    The second difference removes changes that hit every model (the task got
    harder: noisier labels, a harder region of the input space), so a positive
    DiD estimates *avoidable* staleness: error a refreshed model could remove.
    ``task_hardness`` = E_probe,now - E_probe,base is reported separately.

Renewal rule (marginal versus average)
    Treat each deployed model as a renewal cycle. Continuing costs the current
    avoidable error per prediction (marginal cost c_t = DiD x error value).
    The running average cost of the cycle is (K + sum of avoidable cost so far) /
    predictions in the cycle, where K is the cost of renewing (the cheapest
    update). Renewal-reward theory says the cycle should end when c_t reaches
    that average; an update is "due" from that point.

Adaptive probe scheduling (value of information)
    A probe costs money (pricing_snapshot.json -> regime -> probe). Our belief
    about the avoidable error is Normal(last DiD, se^2 + drift_sd^2 x batches
    since the last probe), widened when a drift detector fires. The change in
    the deployed model's error since the last probe is observed for free on every
    batch; it shifts the belief by half of that change and widens it by the same
    amount. The expected
    value of perfect information about the act / keep decision,
    EVPI = E[max(X, 0)] - max(E[X], 0) with X = avoidable x recovery x horizon x
    error value - action cost, is compared with the probe cost; probes also stop
    when the monitoring budget is exhausted.

Recovery ratios
    The share of the avoidable error an action actually removes, learned from
    post-update measurements (realised reduction / avoidable estimate at the
    decision), shrunk towards a prior: partial updates usually recover less than
    full retrains, but cost less.
"""
from __future__ import annotations

import math
import time

import numpy as np

Z95 = 1.959964


def new_state(baseline: dict | None = None) -> dict:
    """Probe state for one deployed model version (reset on promotion/rollback).
    ``baseline``: deployment-time baseline gap from :func:`deployment_baseline`."""
    return {"baseline": baseline, "baseline_parts": [], "last": None, "last_probe_batch": None, "probes": 0,
            "cycle_predictions": 0, "cycle_avoidable_cost": 0.0}


def deployment_baseline(frame, history_rows, holdout_rows, deployed_pred, settings) -> dict | None:
    """Baseline gap measured when a model is deployed: the cross-fitted probe and
    the new model on its own chronological hold-out (where the model is fresh).
    Returns None when it cannot be computed; post-deployment probes are then used."""
    if len(holdout_rows) < settings.probe_min_labels:
        return None
    try:
        comparison, _ = run_probe(frame, history_rows, holdout_rows, deployed_pred, settings)
    except ValueError:
        return None
    base = pool([comparison])
    base["source"] = "deployment hold-out"
    return base


def _phi(z: float) -> float:
    return math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi)


def _Phi(z: float) -> float:
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


# ------------------------------------------------------------------ comparison
def paired(deployed_errors, probe_errors) -> dict:
    """Paired comparison of two models on the same observations."""
    dep = np.asarray(deployed_errors, dtype=float)
    prb = np.asarray(probe_errors, dtype=float)
    if dep.shape != prb.shape or dep.size == 0:
        raise ValueError("paired comparison needs equally sized, non-empty error vectors")
    d = dep - prb
    n = int(d.size)
    sd = float(d.std(ddof=1)) if n > 1 else 1.0
    return {"n": n, "gap": float(d.mean()), "se": max(sd / math.sqrt(n), 0.5 / n),
            "deployed_error": float(dep.mean()), "probe_error": float(prb.mean()),
            "sum_d": float(d.sum()), "sum_d2": float((d * d).sum()),
            "sum_dep": float(dep.sum()), "sum_probe": float(prb.sum())}


def pool(parts: list[dict]) -> dict:
    """Pool several paired comparisons into one baseline gap.

    The baseline is capped at 0: a cheaper probe cannot legitimately beat a
    *fresh* full model, so a positive gap at deployment means the deployed model
    was already stale. Absorbing that into the baseline would hide it from every
    later difference-in-differences estimate; with the cap it counts as avoidable.
    """
    n = sum(p["n"] for p in parts)
    mean = sum(p["sum_d"] for p in parts) / n
    var = max((sum(p["sum_d2"] for p in parts) - n * mean * mean) / max(n - 1, 1), 0.0)
    return {"n": n, "gap": min(mean, 0.0), "raw_gap": mean, "capped": mean > 0,
            "se": max(math.sqrt(var / n), 0.5 / n),
            "deployed_error": sum(p["sum_dep"] for p in parts) / n,
            "probe_error": sum(p["sum_probe"] for p in parts) / n, "probes": len(parts)}


def did(current: dict, baseline: dict) -> dict:
    """Difference-in-differences avoidable-staleness estimate with a 95% interval."""
    value = current["gap"] - baseline["gap"]
    se = math.sqrt(current["se"] ** 2 + baseline["se"] ** 2)
    hardness = current["probe_error"] - baseline["probe_error"]
    p0, p1 = baseline["probe_error"], current["probe_error"]
    hardness_se = math.sqrt(max(p0 * (1 - p0), 1e-6) / baseline["n"] + max(p1 * (1 - p1), 1e-6) / current["n"])
    deployed_change = current["deployed_error"] - baseline["deployed_error"]
    if value - Z95 * se > 0:
        label = "avoidable staleness"
    elif hardness - Z95 * hardness_se > 0:
        label = "task harder for all models"
    else:
        label = "no material staleness"
    return {"available": True, "did": value, "se": se, "ci": [value - Z95 * se, value + Z95 * se],
            "rate": max(0.0, value), "task_hardness": hardness, "task_hardness_se": hardness_se,
            "deployed_change": deployed_change, "classification": label, "n": current["n"],
            "gap": current["gap"], "baseline_gap": baseline["gap"],
            "deployed_error": current["deployed_error"], "probe_error": current["probe_error"]}


# ---------------------------------------------------------------------- probes
def probe_rows(eligible, eval_start: int, settings) -> np.ndarray:
    """Most recent labelled rows strictly before the evaluation rows."""
    rows = np.sort(np.asarray(eligible, dtype=int))
    return rows[rows < int(eval_start)][-settings.probe_window:]


def run_probe(frame, history_rows, eval_rows, deployed_pred, settings) -> tuple[dict, float]:
    """Cross-fitted probe: compare it with the deployed model's stored predictions
    on the same newly labelled rows. Each evaluation fold is predicted by a probe
    that never saw it (trained on the other folds plus earlier labelled rows)."""
    from models import train_full      # local import keeps this module light for unit tests

    started = time.perf_counter()
    eval_rows = np.sort(np.asarray(eval_rows, dtype=int))
    history = np.sort(np.asarray(history_rows, dtype=int))
    k = max(2, min(settings.probe_folds, len(eval_rows) // 10))
    fold = np.arange(len(eval_rows)) % k               # interleaved, so each fold spans the whole batch
    rows = frame.loc[eval_rows]
    x, truth = rows.drop(columns="target"), rows["target"].astype(str).to_numpy()
    probe_pred = np.empty(len(eval_rows), dtype=object)
    cfg = settings.replace(sgd_epochs=settings.probe_epochs)
    sizes = []
    for f in range(k):
        train = np.concatenate([history, eval_rows[fold != f]])[-settings.probe_window:]
        if len(train) < 50:
            raise ValueError(f"only {len(train)} labelled rows available to train the probe")
        probe = train_full(frame.loc[train], cfg)
        probe_pred[fold == f] = probe.predict(x[fold == f])
        sizes.append(len(train))
    deployed = np.asarray(deployed_pred, dtype=object).astype(str)
    comparison = paired(deployed != truth, probe_pred.astype(str) != truth)
    comparison.update(train_rows=int(np.mean(sizes)), folds=int(k))
    return comparison, time.perf_counter() - started


def record_probe(state: dict, comparison: dict, settings, batch_index: int) -> dict:
    """Add one probe result: first build the baseline gap, then estimate DiD."""
    state["last_probe_batch"] = int(batch_index)
    state["probes"] += 1
    if state["baseline"] is None:            # fallback: pool post-deployment probes
        state["baseline_parts"].append({k: comparison[k] for k in ("n", "sum_d", "sum_d2", "sum_dep", "sum_probe")})
        if len(state["baseline_parts"]) >= settings.probe_baseline_probes:
            state["baseline"] = {**pool(state["baseline_parts"]), "source": "post-deployment probes"}
        return {"phase": "baseline", "available": False,
                "baseline_complete": state["baseline"] is not None,
                "baseline_probes": len(state["baseline_parts"])}
    result = did(comparison, state["baseline"])
    result["batch"] = int(batch_index)
    state["last"] = result
    return {"phase": "estimate", **result}


def accumulate(state: dict, n_predictions: int, settings) -> None:
    """Integrate the current avoidable-error estimate over this batch's predictions."""
    state["cycle_predictions"] += int(n_predictions)
    last = state.get("last")
    if last:
        state["cycle_avoidable_cost"] += last["rate"] * n_predictions * settings.error_value


def renewal(state: dict, settings, renewal_cost: float) -> dict:
    """Marginal-versus-average renewal rule for the current model cycle."""
    last = state.get("last")
    if not last:
        return {"available": False, "reason": "no difference-in-differences estimate for this model version yet"}
    marginal = last["rate"] * settings.error_value
    predictions = max(state["cycle_predictions"], 1)
    average = (renewal_cost + state["cycle_avoidable_cost"]) / predictions
    return {"available": True, "marginal": marginal, "average": average, "due": bool(marginal > 0 and marginal >= average),
            "renewal_cost": renewal_cost, "cycle_predictions": state["cycle_predictions"],
            "cycle_avoidable_cost": state["cycle_avoidable_cost"]}


def evpi(mean: float, sd: float) -> float:
    """Expected value of perfect information for a binary act (X) / keep (0) choice, X ~ N(mean, sd^2)."""
    if sd <= 0:
        return 0.0
    z = mean / sd
    return mean * _Phi(z) + sd * _phi(z) - max(mean, 0.0)


def schedule(state: dict, batch_index: int, settings, *, labels: int, alarm: bool, cost: float,
             monitoring_spent: float, run_room: float, value: dict, deployed_error: float | None = None) -> dict:
    """Decide whether to run a probe on this batch.

    ``value``: {"horizon", "costs": {action: K}, "ratios": {action: R}} for the
    decision the probe informs. Returns {"probe": bool, "reason": str, "voi": float | None}.
    """
    if labels < settings.probe_min_labels:
        return {"probe": False, "reason": f"only {labels} new labels from this model version "
                                          f"(minimum {settings.probe_min_labels})", "voi": None}
    if monitoring_spent + cost > settings.monitoring_budget:
        return {"probe": False, "reason": "monitoring budget exhausted", "voi": None}
    if cost > run_room:
        return {"probe": False, "reason": "probe cost would exceed the cumulative budget", "voi": None}
    last_batch = state.get("last_probe_batch")
    since = math.inf if last_batch is None else batch_index - last_batch
    if settings.probe_mode == "fixed":
        if since >= settings.probe_every:
            return {"probe": True, "reason": f"fixed schedule (every {settings.probe_every} batches)", "voi": None}
        return {"probe": False, "reason": f"fixed schedule: next probe in {settings.probe_every - since} batch(es)",
                "voi": None}
    if state.get("baseline") is None:
        return {"probe": True, "reason": "establishing the post-deployment baseline gap", "voi": None}
    if since < settings.probe_min_interval:
        return {"probe": False, "reason": "minimum probe interval", "voi": None}
    last = state.get("last")
    mean = last["did"] if last else 0.0
    se = last["se"] if last else 0.05
    # Free information: how much the deployed model's own error moved since the last probe.
    shift = 0.5 * (deployed_error - last["deployed_error"]) if last and deployed_error is not None else 0.0
    mean += shift
    sd = math.sqrt(se * se + settings.probe_drift_sd ** 2 * min(since, 1_000) + shift * shift) * (2.0 if alarm else 1.0)
    scale = value["horizon"] * settings.error_value
    voi = max(evpi(mean * value["ratios"][a] * scale - value["costs"][a], sd * value["ratios"][a] * scale)
              for a in value["costs"])
    if since >= settings.probe_max_interval:
        return {"probe": True, "reason": f"maximum probe interval ({settings.probe_max_interval} batches)", "voi": voi}
    if voi >= cost:
        return {"probe": True, "reason": f"value of information ${voi:,.2f} >= probe cost ${cost:,.2f}"
                                         + (" (drift alarm widened the belief)" if alarm else ""), "voi": voi}
    return {"probe": False, "reason": f"value of information ${voi:,.2f} < probe cost ${cost:,.2f}", "voi": voi}


# ------------------------------------------------------------------- recovery
def recovery_ratio(outcomes: list[dict], action: str, settings) -> dict:
    """Shrunk mean of realised / avoidable reduction over past updates of ``action``."""
    prior = settings.full_recovery_prior if action == "full" else settings.partial_recovery_prior
    ratios = []
    for o in outcomes:
        avoid = o.get("avoidable")
        if o.get("action") != action or avoid is None or avoid <= 0.005 or o.get("realized_reduction") is None:
            continue
        ratios.append(float(np.clip(o["realized_reduction"] / avoid, 0.0, 1.5)))
    w = settings.recovery_prior_weight
    value = (w * prior + sum(ratios)) / (w + len(ratios))
    return {"ratio": float(value), "observations": len(ratios), "prior": prior, "ratios": ratios[-10:]}


# ------------------------------------------------------------- per-batch step
_SUMS = ("sum_d", "sum_d2", "sum_dep", "sum_probe")


def monitoring_step(state: dict, *, frame, batch_index: int, n_predictions: int, eval_rows, deployed_pred,
                    eligible, settings, alarm: bool, probe_cost: float, monitoring_spent: float, run_room: float,
                    value: dict, renewal_cost: float) -> dict:
    """One batch of probe monitoring, shared by the live pipeline and the benchmark.

    ``eval_rows`` are newly labelled rows predicted by the *current* model version
    and ``deployed_pred`` its stored predictions for them. Returns what happened
    (the caller charges ``probe_cost`` when ``ran`` is true and persists the state).
    """
    accumulate(state, n_predictions, settings)
    deployed_error = None
    if len(eval_rows):
        truth = frame.loc[list(eval_rows), "target"].astype(str).to_numpy()
        deployed_error = float(np.mean(np.asarray(deployed_pred, dtype=object).astype(str) != truth))
    plan = schedule(state, batch_index, settings, labels=len(eval_rows), alarm=alarm, cost=probe_cost,
                    monitoring_spent=monitoring_spent, run_room=run_room, value=value,
                    deployed_error=deployed_error)
    out = {"ran": False, "reason": plan["reason"], "voi": plan["voi"], "cost": probe_cost}
    if plan["probe"]:
        try:
            comparison, fit = run_probe(frame, probe_rows(eligible, min(eval_rows), settings), list(eval_rows),
                                        deployed_pred, settings)
        except ValueError as exc:
            out["reason"] = f"probe could not be trained: {exc}"
        else:
            result = record_probe(state, comparison, settings, batch_index)
            out.update(ran=True, fit_seconds=fit, result=result,
                       comparison={k: v for k, v in comparison.items() if k not in _SUMS})
    out["renewal"] = renewal(state, settings, renewal_cost)
    out["estimate"] = state.get("last")
    out["baseline"] = state.get("baseline")
    return out
