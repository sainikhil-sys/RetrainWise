"""Benchmark harness: replay identical streams and cost traces under six policies.

Policies
    never              keep the initial model
    calendar           full retrain every ``calendar_every_batches`` batches (cost-unaware)
    drift_triggered    full retrain on an ADWIN error-increase alarm or DDM drift (cost-unaware)
    cara_ct_inspired   full retrain when accumulated staleness cost >= current full-retrain cost
                       (inspired by Cara-CT of Mahadevan & Mathioudakis; see METHODOLOGY.md for
                       the documented differences - this is NOT an exact re-implementation)
    retrainwise        monitoring trigger -> chronological shadow evaluation -> economic ranking
                       with guardrails -> validation gate -> promote or defer
    hindsight_oracle   exact dynamic programme over {defer, full retrain} at evenly spaced
                       checkpoints using realised (future) errors. Optimal only within that
                       action space; partial updates and evaluation overhead are excluded.

Online policies only see labels that have been revealed (label delay and label
availability are applied identically). Reported accuracy scores every
prediction against its true label offline.
"""
from __future__ import annotations

import argparse
import copy
import itertools
import json
import math
import time
from collections import deque
from pathlib import Path

import numpy as np
import pandas as pd

from config import ROOT, SAMPLE_SIZES, Settings
from datasets import load
from economics import action_costs, cost_trace, rank_actions, realization_factor
from models import initial_model, recent_window, shadow_evaluate, train_full, validation_gate
from monitoring import (classification_metrics, drift_status, evaluation_trigger, new_monitor, psi,
                        psi_summary, update_with_labels)

POLICIES = ("never", "calendar", "drift_triggered", "cara_ct_inspired", "retrainwise", "hindsight_oracle")
POLICY_LABELS = {"never": "Never retrain", "calendar": "Calendar", "drift_triggered": "Drift-triggered",
                 "cara_ct_inspired": "Cost-aware (CARA-CT-inspired)", "retrainwise": "RetrainWise",
                 "hindsight_oracle": "Hindsight oracle (full-retrain DP)"}
COMPONENTS = ("compute", "engineering", "validation", "deployment_risk", "evaluation")


def label_mask(n_rows: int, seed: int, fraction: float) -> np.ndarray:
    """Which rows ever receive a label. Deterministic per (seed, row); shared by
    the app and the benchmark."""
    if fraction >= 1:
        return np.ones(n_rows, dtype=bool)
    return np.random.default_rng(seed * 104_729 + 3).random(n_rows) < fraction


def batch_starts(n_rows: int, settings) -> list[int]:
    return list(range(settings.initial_size, n_rows, settings.batch_size))


def retrain_rows(eligible: list[int], settings, change_row: int | None = None) -> np.ndarray:
    return recent_window(eligible, settings, change_row)[0]


def train_with_reference(frame: pd.DataFrame, rows: np.ndarray, settings):
    """Baseline full retrain on the recent window plus a reference error from a
    chronological 80/20 probe (needed for staleness tracking)."""
    model = train_full(frame.loc[rows], settings)
    cut = int(len(rows) * 0.8)
    probe = train_full(frame.loc[rows[:cut]], settings)
    tail = frame.loc[rows[cut:]]
    ref = classification_metrics(tail["target"], probe.predict(tail.drop(columns="target")))
    return model, ref["error"], ref["n"]


class Ledger:
    def __init__(self):
        self.spent = 0.0
        self.components = {k: 0.0 for k in COMPONENTS}

    def charge(self, costs: dict, evaluation: bool = False) -> None:
        if evaluation:
            self.components["evaluation"] += costs["total"]
        else:
            for k in ("compute", "engineering", "validation", "deployment_risk"):
                self.components[k] += costs[k]
        self.spent += costs["total"]


def simulate(frame: pd.DataFrame, settings: Settings, policy: str, trace: np.ndarray | None = None,
             cancel=lambda: False, start_state=None) -> tuple[dict, list]:
    """Replay one stream under one online policy. Returns (summary, per-batch trace)."""
    if policy not in POLICIES or policy == "hindsight_oracle":
        raise ValueError(f"simulate() handles online policies only, not {policy!r}")
    settings.validate()
    t0 = time.perf_counter()
    n = len(frame)
    starts = batch_starts(n, settings)
    if not starts:
        raise ValueError("Stream is shorter than the initial training window plus one batch")
    trace = cost_trace(settings, len(starts)) if trace is None else trace
    y_all = frame["target"].astype(str).to_numpy()
    if start_state is None:
        model, ref = initial_model(frame, settings)
        start_state = (model, ref)
    model, ref = copy.deepcopy(start_state[0]), dict(start_state[1])
    monitor = new_monitor(settings, ref["reference_error"], ref["reference_n"], model.psi_reference)
    mask = label_mask(n, settings.seed, settings.label_fraction)
    predictions = np.empty(n, dtype=object)
    pending: deque = deque()
    eligible = list(range(settings.initial_size))
    ledger = Ledger()
    counts = {"full": 0, "partial": 0, "evaluations": 0, "rejected": 0, "blocked": 0, "budget_violations": 0}
    outcomes, tracker = [], None
    last_update, last_eval = -1, -1
    decision_seconds = 0.0
    rows_out = []
    for b, start in enumerate(starts):
        if cancel():
            raise InterruptedError("Benchmark cancelled")
        batch = frame.iloc[start:start + settings.batch_size]
        x = batch.drop(columns="target")
        pred = model.predict(x)                      # 1. predict first
        predictions[start:start + len(batch)] = pred
        for row in batch.index[mask[batch.index]]:
            pending.append((int(row), b + settings.label_delay_batches))
        revealed = []                                # 2. reveal eligible labels
        while pending and pending[0][1] <= b:
            revealed.append(pending.popleft()[0])
        revealed.sort()
        errors = (predictions[revealed] != y_all[revealed]).astype(int) if revealed else np.array([], int)
        eligible.extend(revealed)
        signals = update_with_labels(monitor, errors, settings, revealed)
        if tracker is not None and revealed:          # post-update counterfactual monitoring
            rows = [r for r in revealed if r >= tracker["from_row"]]
            if rows:
                old = tracker["old"].predict(frame.loc[rows].drop(columns="target"))
                tracker["old_errors"] += int(np.sum(old != y_all[rows]))
                tracker["new_errors"] += int(np.sum(predictions[rows] != y_all[rows]))
                tracker["n"] += len(rows)
            if tracker["n"] >= settings.post_update_window:
                outcomes.append({"predicted_reduction": tracker["predicted"],
                                 "realized_reduction": (tracker["old_errors"] - tracker["new_errors"]) / tracker["n"],
                                 "n": tracker["n"]})
                tracker = None
        psi_info = psi_summary(psi(monitor["psi_reference"], x), settings.psi_threshold)
        status = drift_status(signals, psi_info, monitor, settings)
        telemetry = {**signals, **status}
        since_update = b - last_update
        action, reason = "defer", ""
        multiplier = float(trace[min(b, len(trace) - 1)])
        d0 = time.perf_counter()                     # 3. decide, learn or update
        if policy in ("calendar", "drift_triggered", "cara_ct_inspired"):
            full_cost = action_costs("full", settings, min(len(eligible), settings.train_window), multiplier)
            if policy == "calendar":
                want = (b + 1) % settings.calendar_every_batches == 0
            elif policy == "drift_triggered":
                want = bool(signals["adwin_error_increase"] or signals["ddm_status"] == "drift")
            else:
                want = monitor["learning_debt"] * settings.error_value >= full_cost["total"]
            if want and policy == "cara_ct_inspired" and ledger.spent + full_cost["total"] > settings.budget:
                counts["blocked"] += 1
                reason = "budget"
            elif want:
                if ledger.spent + full_cost["total"] > settings.budget:
                    counts["budget_violations"] += 1
                # Drift-triggered retraining uses ADWIN's post-change window; the others the fixed window.
                change = monitor.get("change_row") if policy == "drift_triggered" else None
                model, ref_err, ref_n = train_with_reference(frame, retrain_rows(eligible, settings, change), settings)
                ledger.charge(full_cost)
                counts["full"] += 1
                action, last_update = "full", b
                monitor = new_monitor(settings, ref_err, ref_n, model.psi_reference)
        elif policy == "retrainwise":
            cheapest = action_costs("partial", settings, 0, multiplier)["total"]
            fire, reasons = evaluation_trigger(monitor, telemetry, settings, since_update, b - last_eval, cheapest)
            if fire:
                eval_cost = action_costs("evaluation", settings, min(len(eligible), settings.train_window), multiplier)
                if ledger.spent + eval_cost["total"] > settings.budget:
                    counts["blocked"] += 1
                    reason = "evaluation budget"
                else:
                    ledger.charge(eval_cost, evaluation=True)
                    counts["evaluations"] += 1
                    last_eval = b
                    monitor["labels_since_evaluation"] = 0
                    shadow = shadow_evaluate(frame, np.asarray(eligible), model, settings,
                                             monitor.get("change_row"))
                    remaining = n - (start + len(batch))
                    context = {"spent": ledger.spent, "batches_since_update": since_update,
                               "horizon": min(settings.horizon_predictions, remaining),
                               "price_multiplier": multiplier, "batch_index": b,
                               "realization": realization_factor(outcomes, settings)}
                    decision = rank_actions(shadow["evidence"], context, settings)
                    top = decision["ranked"][0]
                    blocked_updates = [r for r in decision["ranked"] if r["action"] != "defer"
                                       and r["evidence"].get("compatible") and r["net_value"] > 0 and not r["feasible"]]
                    if top["action"] == "defer":
                        counts["blocked"] += int(bool(blocked_updates))
                        reason = "; ".join(reasons)
                    else:
                        gate = validation_gate(top["evidence"], settings)
                        if gate["passed"]:
                            tracker = {"old": model, "from_row": start + len(batch), "predicted": top["evidence"]["reduction"],
                                       "old_errors": 0, "new_errors": 0, "n": 0}
                            model = shadow["candidates"][top["action"]]
                            ledger.charge(top["costs"])
                            counts[top["action"]] += 1
                            action, last_update = top["action"], b
                            monitor = new_monitor(settings, top["evidence"]["candidate_error"], top["evidence"]["n"],
                                                  model.psi_reference)
                        else:
                            counts["rejected"] += 1
                            reason = "validation gate"
        decision_seconds += time.perf_counter() - d0
        rows_out.append({"batch": b, "end": int(start + len(batch)),
                         "error": float(np.mean(pred != y_all[start:start + len(batch)])),
                         "rolling_error": signals["rolling_error"], "status": status["status"],
                         "max_psi": psi_info["max_psi"], "action": action, "spent": ledger.spent,
                         "learning_debt": monitor["learning_debt"], "note": reason})
    scored = slice(settings.initial_size, n)
    summary = _summary(y_all[scored], predictions[scored].astype(str), ledger, counts, settings)
    summary.update(runtime_seconds=time.perf_counter() - t0, decision_seconds=decision_seconds,
                   realization_factor=realization_factor(outcomes, settings)["factor"],
                   realized_outcomes=len(outcomes))
    return summary, rows_out


def _summary(y, pred, ledger: Ledger, counts: dict, settings) -> dict:
    m = classification_metrics(y, pred)
    errors = int(np.sum(np.asarray(y) != np.asarray(pred)))
    error_cost = errors * settings.error_value
    return {"scored_rows": int(len(y)), "accuracy": m["accuracy"], "error_rate": m["error"], "macro_f1": m["f1"],
            "errors": errors, "full_updates": counts["full"], "partial_updates": counts["partial"],
            "evaluations": counts["evaluations"], "rejected_actions": counts["rejected"],
            "blocked_actions": counts["blocked"], "budget_violations": counts["budget_violations"],
            **{f"cost_{k}": v for k, v in ledger.components.items()},
            "operational_cost": ledger.spent, "error_cost": error_cost, "total_cost": ledger.spent + error_cost}


# ------------------------------------------------------------------- oracle
def oracle_windows(settings) -> list[int]:
    """Training-window lengths the oracle may choose from at each checkpoint."""
    tw = settings.train_window
    return sorted({tw, max(300, tw // 3), max(300, tw // 6)}, reverse=True)


def oracle_matrix(frame: pd.DataFrame, settings: Settings, start_state, cancel=lambda: False) -> dict:
    """Train every candidate model of the oracle's action space (cost-regime
    independent) and record its per-batch errors on every later batch.

    Nodes are (checkpoint, window): a full retrain before batch ``checkpoint``
    on the most recent ``window`` labelled rows revealed by then.
    """
    n = len(frame)
    starts = batch_starts(n, settings)
    nb = len(starts)
    y_all = frame["target"].astype(str).to_numpy()
    mask = label_mask(n, settings.seed, settings.label_fraction)
    stride = max(1, math.ceil((nb - 1) / settings.oracle_max_checkpoints)) if nb > 1 else 1
    checkpoints = list(range(stride, nb, stride))          # retrain before batch c
    windows = oracle_windows(settings)
    models, n_train = {(0, 0): start_state[0]}, {}
    for c in checkpoints:
        if cancel():
            raise InterruptedError("Benchmark cancelled")
        # Labels revealed by the end of batch c-1, exactly as an online policy would see them.
        eligible = list(range(settings.initial_size))
        for b in range(c):
            if b + settings.label_delay_batches <= c - 1:
                s = starts[b]
                rows = np.arange(s, min(s + settings.batch_size, n))
                eligible.extend(rows[mask[rows]].tolist())
        for w in windows:
            rows = np.asarray(eligible[-w:], dtype=int)
            if w != windows[0] and len(rows) < w:
                continue                                    # shorter window identical to a longer one
            try:
                models[(c, w)] = train_full(frame.loc[rows], settings)
                n_train[(c, w)] = len(rows)
            except ValueError:
                continue                                    # e.g. single-class window
    errors, preds = {}, {}
    for key, model in models.items():
        lo = starts[key[0]]
        p = model.predict(frame.iloc[lo:].drop(columns="target"))
        preds[key] = p
        wrong = (p != y_all[lo:]).astype(int)
        errors[key] = np.array([wrong[s - lo:s - lo + settings.batch_size].sum() if s >= lo else 0
                                for s in starts])
    return {"checkpoints": checkpoints, "windows": windows, "errors": errors, "preds": preds,
            "starts": starts, "n_train": n_train}


def oracle(frame: pd.DataFrame, settings: Settings, matrix: dict, trace: np.ndarray) -> tuple[dict, list]:
    """Exact DP over the oracle action space: at each checkpoint keep the model
    or fully retrain on one of the candidate windows. Minimises realised error
    cost + full-retrain action cost using hindsight (future labels)."""
    t0 = time.perf_counter()
    starts, nb = matrix["starts"], len(matrix["starts"])
    v = settings.error_value
    cum = {k: np.concatenate([[0], np.cumsum(e)]) for k, e in matrix["errors"].items()}

    def seg(node, b: int) -> float:                         # error cost of ``node`` on batches [node.c, b)
        return float(cum[node][b] - cum[node][node[0]]) * v

    cost = {k: action_costs("full", settings, matrix["n_train"][k], float(trace[min(k[0] - 1, len(trace) - 1)]))
            for k in matrix["n_train"]}
    best = {(0, 0): (0.0, None)}
    for c in matrix["checkpoints"]:
        here = [k for k in cost if k[0] == c]
        earlier = [p for p in best if p[0] < c]
        if not here or not earlier:
            continue
        carry = min((best[p][0] + seg(p, c), p) for p in earlier)   # cheapest way to arrive at c
        for k in here:
            best[k] = (carry[0] + cost[k]["total"], carry[1])
    final = min((best[p][0] + seg(p, nb), p) for p in best)
    schedule, node = [], final[1]
    while node is not None and node != (0, 0):
        schedule.append(node)
        node = best[node][1]
    schedule = sorted(schedule)
    y_all = frame["target"].astype(str).to_numpy()
    pred = np.empty(len(frame), dtype=object)
    segments = [(0, 0)] + schedule
    for i, node in enumerate(segments):
        lo = starts[node[0]]
        hi = starts[segments[i + 1][0]] if i + 1 < len(segments) else len(frame)
        pred[lo:hi] = matrix["preds"][node][:hi - lo]
    ledger = Ledger()
    violations = 0
    for k in schedule:
        if ledger.spent + cost[k]["total"] > settings.budget:
            violations += 1
        ledger.charge(cost[k])
    counts = {"full": len(schedule), "partial": 0, "evaluations": 0, "rejected": 0, "blocked": 0,
              "budget_violations": violations}
    scored = slice(settings.initial_size, len(frame))
    summary = _summary(y_all[scored], pred[scored].astype(str), ledger, counts, settings)
    summary.update(runtime_seconds=time.perf_counter() - t0, decision_seconds=0.0, realization_factor=None,
                   realized_outcomes=0, oracle_checkpoints=len(matrix["checkpoints"]),
                   oracle_windows=matrix["windows"], oracle_models=len(matrix["preds"]),
                   oracle_schedule=[[int(c), int(w)] for c, w in schedule],
                   oracle_objective=float(final[0]))
    by_batch = {c - 1: k for k in schedule for c in [k[0]]}
    rows, spent = [], 0.0
    for b, s in enumerate(starts):
        hi = min(s + settings.batch_size, len(frame))
        if b in by_batch:
            spent += cost[by_batch[b]]["total"]
        rows.append({"batch": b, "end": int(hi), "error": float(np.mean(pred[s:hi] != y_all[s:hi])),
                     "action": f"full (window {by_batch[b][1]})" if b in by_batch else "defer", "spent": spent})
    return summary, rows


# ---------------------------------------------------------------- benchmark
def benchmark(datasets=("synthetic",), size="small", seeds=(42,), regimes=("balanced",), policies=POLICIES,
              settings: Settings | None = None, root: Path = ROOT, prefix: str = "results",
              progress=lambda fraction, message: None, cancel=lambda: False, write: bool = True) -> dict:
    base = (settings or Settings()).validate()
    if size not in SAMPLE_SIZES:
        raise ValueError(f"size must be one of {list(SAMPLE_SIZES)}")
    bad = [p for p in policies if p not in POLICIES]
    if bad or not policies or not datasets or not seeds or not regimes:
        raise ValueError(f"Invalid experiment configuration {bad}")
    if not prefix.replace("_", "").replace("-", "").isalnum():
        raise ValueError("prefix may contain only letters, digits, '_' and '-'")
    cells = list(itertools.product(datasets, seeds))
    total = len(cells) * len(regimes) * len(policies)
    done, rows, details = 0, [], []
    started = time.perf_counter()
    for name, seed in cells:
        frame = load(name, size, int(seed), root)
        cfg0 = base.replace(seed=int(seed), autonomy=False)
        progress(done / total, f"{name} seed {seed}: training initial model")
        start_state = initial_model(frame, cfg0)
        matrix = None
        for regime, policy in itertools.product(regimes, policies):
            if cancel():
                raise InterruptedError("Benchmark cancelled")
            cfg = cfg0.replace(regime=regime)
            trace = cost_trace(cfg, len(batch_starts(len(frame), cfg)))
            progress(done / total, f"{name} seed {seed} {regime}: {POLICY_LABELS[policy]}")
            if policy == "hindsight_oracle":
                if matrix is None:
                    m0 = time.perf_counter()
                    matrix = oracle_matrix(frame, cfg, start_state, cancel)
                    matrix["seconds"] = time.perf_counter() - m0
                summary, trace_rows = oracle(frame, cfg, matrix, trace)
                summary["runtime_seconds"] += matrix["seconds"]
            else:
                summary, trace_rows = simulate(frame, cfg, policy, trace, cancel, start_state)
            summary = {"dataset": name, "policy": policy, "policy_label": POLICY_LABELS[policy],
                       "regime": regime, "seed": int(seed), "size": size, "rows": len(frame),
                       "batch_size": cfg.batch_size, "initial_size": cfg.initial_size,
                       "label_fraction": cfg.label_fraction, "label_delay_batches": cfg.label_delay_batches,
                       "cost_trace": cfg.cost_trace_kind, "error_value": cfg.error_value,
                       "horizon_predictions": cfg.horizon_predictions, **summary}
            rows.append(summary)
            details.append({"summary": summary, "trace": trace_rows})
            done += 1
            progress(done / total, f"completed {done}/{total}")
    result = {"configuration": {"datasets": list(datasets), "size": size, "rows_per_size": SAMPLE_SIZES[size],
                                "seeds": [int(s) for s in seeds], "regimes": list(regimes),
                                "policies": list(policies), "settings": base.to_dict()},
              "runs": details, "wall_seconds": time.perf_counter() - started,
              "notes": ["Costs are simulated USD from pricing_snapshot.json; deployment risk is an expected cost.",
                        "Accuracy scores every prediction offline; online policies only use revealed labels.",
                        "hindsight_oracle is optimal only over {defer, full retrain} on its checkpoint grid."]}
    if write:
        out = Path(root)
        pd.DataFrame(rows).drop(columns=["oracle_schedule"], errors="ignore").to_csv(
            out / f"{prefix}_summary.csv", index=False)
        (out / f"{prefix}_details.json").write_text(json.dumps(_jsonable(result), indent=1), encoding="utf-8")
    result["summary"] = rows
    return result


def _jsonable(obj):
    from database import _sanitize
    return _sanitize(obj)


def main():
    parser = argparse.ArgumentParser(description="Run RetrainWise policy benchmarks.")
    parser.add_argument("--datasets", nargs="+", default=["synthetic"])
    parser.add_argument("--size", choices=list(SAMPLE_SIZES), default="small")
    parser.add_argument("--seeds", nargs="+", type=int, default=[42])
    parser.add_argument("--regimes", nargs="+", default=["cheap", "balanced", "expensive"])
    parser.add_argument("--policies", nargs="+", default=list(POLICIES))
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--prefix", default="results")
    args = parser.parse_args()
    settings = Settings()
    if args.batch_size:
        settings = settings.replace(batch_size=args.batch_size)
    result = benchmark(args.datasets, args.size, args.seeds, args.regimes, args.policies, settings,
                       prefix=args.prefix, progress=lambda f, m: print(f"[{f:6.1%}] {m}", flush=True))
    print(f"Wrote {args.prefix}_summary.csv and {args.prefix}_details.json "
          f"({len(result['summary'])} runs, {result['wall_seconds']:.1f}s)")


if __name__ == "__main__":
    main()
