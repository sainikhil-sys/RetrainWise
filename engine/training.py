"""Explicit model training jobs ("Train model").

A training job really trains a model in the worker process and evaluates it on
withheld chronological data. Nothing here is simulated: progress comes from
completed epochs (or random-forest tree chunks), metrics from the validation
rows, durations from the clock.

Two scopes
    stream  Train on the first ``initial_window`` rows of a dataset sample (any
            categorical column with 2-50 classes may be the target). The last
            ``validation_fraction`` of that window is held out chronologically.
            Promoting the candidate starts a new monitored run whose stream
            begins right after the window.
    run     Train for the active run on labels revealed so far. The newest
            labelled rows that neither the incumbent nor the candidate learned
            from form the validation window, and the incumbent is scored on
            exactly the same rows, so "improved on its parent by X" is a fair
            comparison. Promotion replaces the run's active model.

The job result is a *candidate*: it is registered with status ``candidate``
and changes nothing in production until an approver promotes it.
"""
from __future__ import annotations

import math
import time

import numpy as np
import pandas as pd
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

from config import SAMPLE_SIZES, Settings
from datasets import DATASETS, frame_sha256, is_cached, load
from models import MODEL_TYPES, model_spec, train_full
from preprocessing import preprocessing_options

STAGES = ("queued", "preparing data", "preprocessing", "training", "validating", "completed")
MAX_TARGET_CLASSES = 50


def exact_metrics(truth, pred, labels=None) -> dict:
    """Full-precision validation metrics (never rounded here)."""
    truth = np.asarray(truth, dtype=object).astype(str)
    pred = np.asarray(pred, dtype=object).astype(str)
    labels = sorted(set(truth) | set(pred)) if labels is None else [str(v) for v in labels]
    n = int(len(truth))
    correct = int(np.sum(truth == pred))
    p, r, f, support = precision_recall_fscore_support(truth, pred, labels=labels, zero_division=0)
    macro = precision_recall_fscore_support(truth, pred, labels=labels, average="macro", zero_division=0)
    weighted = precision_recall_fscore_support(truth, pred, labels=labels, average="weighted", zero_division=0)
    return {
        "n": n, "correct": correct, "accuracy": correct / n if n else None,
        "error_rate": (n - correct) / n if n else None,
        "precision": float(macro[0]), "recall": float(macro[1]), "f1": float(macro[2]),
        "precision_weighted": float(weighted[0]), "recall_weighted": float(weighted[1]),
        "f1_weighted": float(weighted[2]),
        "labels": labels,
        "confusion_matrix": confusion_matrix(truth, pred, labels=labels).astype(int).tolist(),
        "per_class": [{"label": lab, "precision": float(p[i]), "recall": float(r[i]), "f1": float(f[i]),
                       "support": int(support[i])} for i, lab in enumerate(labels)],
        "majority_baseline_error": float(1 - (pd.Series(truth).value_counts().iloc[0] / n)) if n else None,
    }


def validate_config(cfg: dict, settings: Settings, data_root) -> dict:
    """Bounds-checked training configuration (also re-checked by the worker)."""
    if not isinstance(cfg, dict):
        raise ValueError("configuration must be an object")
    scope = cfg.get("scope", "stream")
    if scope not in ("stream", "run"):
        raise ValueError("scope must be 'stream' or 'run'")
    spec = model_spec(settings, cfg.get("model") or {})
    prep = preprocessing_options(cfg.get("preprocessing") or {})
    seed = cfg.get("seed", settings.seed)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= 2**31 - 1:
        raise ValueError("seed must be an integer between 0 and 2147483647")
    vf = cfg.get("validation_fraction", settings.validation_fraction)
    if isinstance(vf, bool) or not isinstance(vf, (int, float)) or not 0.05 <= float(vf) <= 0.6:
        raise ValueError("validation_fraction must be between 0.05 and 0.6")
    out = {"scope": scope, "model": spec, "preprocessing": prep, "seed": int(seed),
           "validation_fraction": float(vf), "note": str(cfg.get("note") or "")[:300]}
    if scope == "stream":
        dataset, size = cfg.get("dataset"), cfg.get("size", "standard")
        if dataset not in DATASETS:
            raise ValueError(f"dataset must be one of {list(DATASETS)}")
        if size not in SAMPLE_SIZES:
            raise ValueError(f"size must be one of {list(SAMPLE_SIZES)}")
        if not is_cached(dataset, data_root):
            raise ValueError(f"{dataset} is not cached; download it first (synthetic data is never substituted)")
        window = cfg.get("initial_window", settings.initial_size)
        if isinstance(window, bool) or not isinstance(window, int) or not 200 <= window <= 1_000_000:
            raise ValueError("initial_window must be an integer between 200 and 1000000")
        target = cfg.get("target_column") or "target"
        if not isinstance(target, str) or len(target) > 100:
            raise ValueError("target_column must be a column name")
        out.update(dataset=dataset, size=size, initial_window=int(window), target_column=target)
    else:
        window = cfg.get("train_window", settings.train_window)
        if isinstance(window, bool) or not isinstance(window, int) or not 100 <= window <= 1_000_000:
            raise ValueError("train_window must be an integer between 100 and 1000000")
        out.update(train_window=int(window), run_id=str(cfg.get("run_id") or ""))
    return out


def prepare_frame(cfg: dict, data_root) -> pd.DataFrame:
    """Load the selected sample; optionally predict a different column."""
    frame = load(cfg["dataset"], cfg["size"], cfg["seed"], data_root)
    target = cfg["target_column"]
    if target != "target":
        if target not in frame.columns:
            raise ValueError(f"column {target!r} does not exist in {cfg['dataset']}")
        values = frame[target]
        if values.isna().any():
            raise ValueError(f"target column {target!r} has missing values")
        classes = values.astype(str).nunique()
        if not 2 <= classes <= MAX_TARGET_CLASSES:
            raise ValueError(f"target column {target!r} has {classes} distinct values (2-{MAX_TARGET_CLASSES} allowed)")
        # The original label is removed so it cannot leak into the new task.
        frame = frame.drop(columns=["target"]).rename(columns={target: "target"})
        frame["target"] = frame["target"].astype(str)
    return frame


def run_training(cfg: dict, settings: Settings, data_root, *, stage, progress, log, cancelled,
                 run_context: dict | None = None) -> dict:
    """Execute one training job. ``stage(name)``, ``progress(fraction, message)``,
    ``log(message)`` and ``cancelled()`` are provided by the worker.

    Returns the candidate model and the full-precision evaluation."""
    t0 = time.perf_counter()
    stage("preparing data")
    if cfg["scope"] == "stream":
        frame = prepare_frame(cfg, data_root)
        n = len(frame)
        window = min(cfg["initial_window"], n)
        if window < 200:
            raise ValueError(f"only {n} rows available")
        val_n = max(20, int(math.ceil(cfg["validation_fraction"] * window)))
        train_rows = np.arange(0, window - val_n)
        val_rows = np.arange(window - val_n, window)
        checksum = frame_sha256(frame)
        log(f"Loaded {cfg['dataset']} ({cfg['size']}): {n:,} rows in source order; checksum {checksum[:16]}…")
        log(f"Training window rows {train_rows[0]:,}–{train_rows[-1] + 1:,} ({len(train_rows):,} rows); "
            f"chronological validation rows {val_rows[0]:,}–{val_rows[-1] + 1:,} ({len(val_rows):,} rows)")
        incumbent = None
    else:
        if not run_context:
            raise ValueError("run scope needs the active run")
        frame = run_context["frame"]
        checksum = run_context["data_sha256"]
        incumbent = run_context["incumbent"]
        eligible = np.sort(np.asarray(run_context["eligible"], dtype=int))
        fresh = eligible[eligible >= incumbent.trained_until]
        val_n = int(math.ceil(cfg["validation_fraction"] * min(len(eligible), cfg["train_window"])))
        if len(fresh) < 2 * max(val_n, 20):
            val_n = len(fresh) // 2
        if val_n < 20:
            raise ValueError(f"only {len(fresh)} labelled rows newer than the active model; process more batches first")
        val_rows = fresh[-val_n:]
        train_rows = eligible[eligible < val_rows[0]][-cfg["train_window"]:]
        log(f"Run {run_context['run_id']} ({run_context['dataset']}): {len(eligible):,} labelled rows available; "
            f"active model v{incumbent_version(run_context):03d} learned up to row {incumbent.trained_until:,}")
        log(f"Training rows {train_rows[0]:,}–{train_rows[-1] + 1:,} ({len(train_rows):,} labelled rows); "
            f"validation rows {val_rows[0]:,}–{val_rows[-1] + 1:,} ({len(val_rows):,} rows neither model learned from)")
    if cancelled():
        raise InterruptedError("Training cancelled")

    stage("preprocessing")
    train = frame.loc[train_rows]
    classes = sorted(train["target"].astype(str).unique())
    if len(classes) < 2:
        raise ValueError("training window contains a single class")
    log(f"{len(classes)} classes in the training window; preprocessing: impute numeric by "
        f"{cfg['preprocessing']['numeric_impute']}, scaling {'on' if cfg['preprocessing']['scale'] else 'off'}, "
        f"at most {cfg['preprocessing']['max_categories']} categories per feature (fitted on training rows only)")

    stage("training")
    spec = cfg["model"]
    log(f"Model: {MODEL_TYPES[spec['type']]['label']} "
        + (f"(alpha={spec['alpha']}, epochs={spec['epochs']})" if spec["type"] != "random_forest"
           else f"(trees={spec['n_estimators']}, max depth={spec['max_depth'] or 'unlimited'})")
        + f", seed {cfg['seed']}")
    fit_started = time.perf_counter()
    last = {"t": 0.0}

    def on_progress(fraction, message):
        progress(fraction, message)
        if time.perf_counter() - last["t"] > 1.0 or fraction >= 1:
            last["t"] = time.perf_counter()
            log(f"training: {message}")

    model = train_full(train, settings, seed=cfg["seed"], spec=spec, preprocessing=cfg["preprocessing"],
                       progress=on_progress, cancelled=cancelled)
    train_seconds = time.perf_counter() - fit_started
    log(f"Training finished in {train_seconds:.3f} s; {model.hyperparameters['feature_count']} features after preprocessing")

    stage("validating")
    val_started = time.perf_counter()
    val = frame.loc[val_rows]
    x_val, y_val = val.drop(columns="target"), val["target"].astype(str).to_numpy()
    labels = sorted(set(classes) | set(y_val))
    cand_pred = model.predict(x_val)
    metrics = exact_metrics(y_val, cand_pred, labels)
    validation_seconds = time.perf_counter() - val_started
    log(f"Validation on {metrics['n']:,} withheld rows: accuracy {metrics['accuracy']!r}, macro F1 {metrics['f1']!r}")
    parent = None
    if incumbent is not None:
        inc_pred = incumbent.predict(x_val)
        inc = exact_metrics(y_val, inc_pred, labels)
        parent = {"comparable": True, "version": incumbent_version(run_context), "metrics": inc,
                  "accuracy_change": metrics["accuracy"] - inc["accuracy"],
                  "error_change": metrics["error_rate"] - inc["error_rate"],
                  "f1_change": metrics["f1"] - inc["f1"],
                  "note": "both models scored on the same rows; neither learned from them"}
        log(f"Active model on the same rows: accuracy {inc['accuracy']!r} "
            f"(change {parent['accuracy_change']:+.6f})")
    return {
        "model": model, "candidate_pred": cand_pred, "val_rows": val_rows, "train_rows": train_rows,
        "evaluation": {
            "metrics": metrics, "parent": parent,
            "train_interval": [int(train_rows[0]), int(train_rows[-1]) + 1],
            "validation_interval": [int(val_rows[0]), int(val_rows[-1]) + 1],
            "n_train": int(len(train_rows)), "n_validation": int(len(val_rows)),
            "feature_count": int(model.hyperparameters["feature_count"]),
            "training_seconds": train_seconds, "validation_seconds": validation_seconds,
            "total_seconds": time.perf_counter() - t0, "seed": cfg["seed"], "dataset_sha256": checksum,
            "classes": labels,
        },
    }


def incumbent_version(ctx: dict | None) -> int:
    return int((ctx or {}).get("incumbent_version") or 0)


def promotion_gate(evaluation: dict, settings: Settings) -> dict:
    """Deterministic gate a candidate must pass before it may be promoted."""
    m = evaluation["metrics"]
    checks = [{"check": "validation sample >= minimum evidence", "passed": m["n"] >= settings.min_evidence,
               "detail": f"{m['n']} withheld rows (minimum {settings.min_evidence})"}]
    parent = evaluation.get("parent")
    if parent and parent.get("comparable"):
        pm = parent["metrics"]
        checks.append({"check": "validation error lower than the active model", "passed": m["error_rate"] < pm["error_rate"],
                       "detail": f"{m['error_rate']!r} vs {pm['error_rate']!r}"})
        checks.append({"check": f"macro-F1 not lower by more than {settings.f1_tolerance}",
                       "passed": m["f1"] >= pm["f1"] - settings.f1_tolerance,
                       "detail": f"{m['f1']!r} vs {pm['f1']!r}"})
    else:
        checks.append({"check": "beats the majority-class baseline", "passed": m["error_rate"] < m["majority_baseline_error"],
                       "detail": f"error {m['error_rate']!r} vs majority-class error {m['majority_baseline_error']!r}"})
    return {"passed": all(c["passed"] for c in checks), "checks": checks}
