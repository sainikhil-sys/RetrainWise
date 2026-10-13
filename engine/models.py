"""Model lifecycle primitives: full training, incremental updates, chronological
shadow evaluation, the validation gate and checksummed artifacts.

Leakage rules enforced here:
* every model records ``trained_until`` (one past the last stream row it has
  learned from) and incremental updates refuse rows before it;
* shadow candidates are evaluated only on a chronological hold-out made of the
  most recent labelled rows that neither the incumbent nor the candidate saw;
* the candidate that is promoted is exactly the one that was validated (it is
  not refitted on the hold-out afterwards).
"""
from __future__ import annotations

import copy
import hashlib
import math
import time
from dataclasses import dataclass, field, fields
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import SGDClassifier

from monitoring import classification_metrics, psi_reference
from preprocessing import align, category_vocabulary, fit_preprocessor, infer_schema

ARTIFACT_FORMAT = "retrainwise-model-v1"


@dataclass
class ModelBundle:
    transformer: object
    estimator: object
    schema: dict
    classes: list
    vocabulary: dict
    train_start: int
    train_end: int
    trained_until: int
    n_train: int
    seed: int
    hyperparameters: dict
    psi_reference: dict
    history: list = field(default_factory=list)   # lineage of fits/updates

    def predict(self, x: pd.DataFrame) -> np.ndarray:
        aligned, _ = align(x, self.schema)
        return self.estimator.predict(self.transformer.transform(aligned)).astype(str)

    def supports_incremental(self) -> bool:
        return hasattr(self.estimator, "partial_fit")

    def describe(self) -> dict:
        return {"estimator": type(self.estimator).__name__, "classes": self.classes,
                "features": self.schema["features"], "numeric": self.schema["numeric"],
                "categorical": self.schema["categorical"], "train_interval": [self.train_start, self.train_end],
                "trained_until": self.trained_until, "n_train": self.n_train, "seed": self.seed,
                "hyperparameters": self.hyperparameters, "lineage": self.history}


def _xy(rows: pd.DataFrame):
    return rows.drop(columns="target"), rows["target"].astype(str).to_numpy()


def train_full(rows: pd.DataFrame, settings, seed: int | None = None) -> ModelBundle:
    """Fit preprocessing and a fresh estimator on ``rows`` only.

    ``rows`` must be indexed by stream row number in chronological order.
    """
    if len(rows) < 20:
        raise ValueError("Full training needs at least 20 labelled rows")
    if not rows.index.is_monotonic_increasing:
        raise ValueError("Training rows must be in chronological order")
    seed = settings.seed if seed is None else int(seed)
    x, y = _xy(rows)
    classes = sorted(set(y))
    if len(classes) < 2:
        raise ValueError("Training window contains a single class; full retraining is not possible")
    schema = infer_schema(x)
    transformer = fit_preprocessor(x, schema)
    aligned, _ = align(x, schema)
    estimator = SGDClassifier(loss="log_loss", alpha=settings.sgd_alpha, max_iter=settings.sgd_epochs,
                              tol=1e-4, shuffle=True, random_state=seed, average=False)
    import warnings
    from sklearn.exceptions import ConvergenceWarning
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConvergenceWarning)
        estimator.fit(transformer.transform(aligned), y)
    start, end = int(rows.index.min()), int(rows.index.max()) + 1
    return ModelBundle(
        transformer=transformer, estimator=estimator, schema=schema,
        classes=[str(c) for c in estimator.classes_], vocabulary=category_vocabulary(x, schema),
        train_start=start, train_end=end, trained_until=end, n_train=len(rows), seed=seed,
        hyperparameters={"loss": "log_loss", "alpha": settings.sgd_alpha, "epochs": settings.sgd_epochs},
        psi_reference=psi_reference(aligned, settings.psi_bins),
        history=[{"kind": "full", "rows": len(rows), "interval": [start, end]}])


def partial_update(model: ModelBundle, rows: pd.DataFrame) -> ModelBundle:
    """Genuine incremental learning: one ``partial_fit`` pass over new rows,
    with the preprocessing frozen. Returns a new bundle; the input is untouched."""
    if not model.supports_incremental():
        raise ValueError("Estimator does not support incremental learning")
    if rows.empty:
        raise ValueError("No new labelled rows for an incremental update")
    if int(rows.index.min()) < model.trained_until:
        raise ValueError("Incremental rows overlap data the model already learned from")
    if not rows.index.is_monotonic_increasing:
        raise ValueError("Incremental rows must be chronological")
    x, y = _xy(rows)
    unseen = sorted(set(y) - set(model.classes))
    if unseen:
        raise ValueError(f"New class(es) {unseen} require full retraining")
    aligned, issues = align(x, model.schema)
    if issues["missing_columns"]:
        raise ValueError(f"Schema changed (missing {issues['missing_columns']}); full retraining required")
    updated = copy.deepcopy(model)
    updated.estimator.partial_fit(updated.transformer.transform(aligned), y)
    end = int(rows.index.max()) + 1
    updated.trained_until = end
    updated.n_train = model.n_train + len(rows)
    updated.history = model.history + [{"kind": "partial", "rows": len(rows),
                                        "interval": [int(rows.index.min()), end]}]
    return updated


def initial_model(frame: pd.DataFrame, settings) -> tuple[ModelBundle, dict]:
    """Train the first model on the initial window.

    The reference error is estimated with a chronological 80/20 split of the
    initial window; the deployed model is then fit on the whole window. The
    estimate is therefore slightly pessimistic and is documented as such.
    """
    rows = frame.iloc[:settings.initial_size]
    cut = int(len(rows) * 0.8)
    probe = train_full(rows.iloc[:cut], settings)
    tail = rows.iloc[cut:]
    tail_pred = probe.predict(tail.drop(columns="target"))
    m = classification_metrics(tail["target"], tail_pred)
    model = train_full(rows, settings)
    # Deployment-time baseline gap for the probe DiD, on the same chronological 20%.
    from staleness import deployment_baseline
    baseline = deployment_baseline(frame, rows.index[:cut].to_numpy(), rows.index[cut:].to_numpy(), tail_pred, settings)
    return model, {"reference_error": m["error"], "reference_n": m["n"], "probe_baseline": baseline,
                   "method": "chronological 80/20 split of the initial window"}


# ------------------------------------------------------------ shadow evaluation
MIN_POST_CHANGE_ROWS = 300


def recent_window(eligible, settings, change_row: int | None = None) -> tuple[np.ndarray, str]:
    """Rows for full retraining: labelled rows since an ADWIN-estimated change
    point when there are enough of them, otherwise the last ``train_window``."""
    eligible = np.sort(np.asarray(eligible, dtype=int))
    if change_row is not None:
        post = eligible[eligible >= change_row]
        if len(post) >= MIN_POST_CHANGE_ROWS:
            return post[-settings.train_window:], f"post-change window (rows >= {int(change_row)})"
    return eligible[-settings.train_window:], f"last {settings.train_window} labelled rows"


def plan_windows(eligible: np.ndarray, incumbent: ModelBundle, settings, change_row: int | None = None) -> dict:
    """Choose chronological train / hold-out rows from labels revealed so far."""
    eligible = np.sort(np.asarray(eligible, dtype=int))
    window, basis = recent_window(eligible, settings, change_row)
    fresh = eligible[eligible >= incumbent.trained_until]
    target = int(math.ceil(settings.validation_fraction * len(window)))
    holdout_n = target if len(fresh) >= 2 * target else len(fresh) // 2
    if holdout_n < 20:
        return {"ok": False, "reason": f"only {len(fresh)} labelled rows newer than the incumbent's training data",
                "fresh": int(len(fresh))}
    holdout = fresh[-holdout_n:]
    start = int(holdout[0])
    full_rows = window[window < start]
    partial_rows = fresh[fresh < start]
    return {"ok": True, "holdout": holdout, "full_rows": full_rows, "partial_rows": partial_rows,
            "fresh": int(len(fresh)), "window_basis": basis}


def _paired(incumbent_err: np.ndarray, candidate_err: np.ndarray) -> dict:
    diff = incumbent_err.astype(float) - candidate_err.astype(float)
    n = len(diff)
    mean = float(diff.mean())
    sd = float(diff.std(ddof=1)) if n > 1 else 1.0
    se = max(sd / math.sqrt(n), 0.5 / n)   # floor avoids false certainty on tiny/identical samples
    return {"reduction": mean, "reduction_se": se, "reduction_ci": [mean - 1.96 * se, mean + 1.96 * se],
            "discordant": int(np.sum(diff != 0))}


def shadow_evaluate(frame: pd.DataFrame, eligible, incumbent: ModelBundle, settings,
                    change_row: int | None = None) -> dict:
    """Train full and partial candidates and score them, with the incumbent,
    on the same untouched chronological hold-out."""
    plan = plan_windows(eligible, incumbent, settings, change_row)
    result = {"candidates": {}, "evidence": {}, "plan": {k: v for k, v in plan.items()
                                                          if k in ("ok", "reason", "fresh", "window_basis")}}
    if not plan["ok"]:
        for action in ("full", "partial"):
            result["evidence"][action] = {"compatible": False, "n": 0, "reason": plan["reason"]}
        return result
    holdout = frame.loc[plan["holdout"]]
    hx, hy = holdout.drop(columns="target"), holdout["target"].astype(str).to_numpy()
    inc_pred = incumbent.predict(hx)
    inc_err = inc_pred != hy
    inc_metrics = classification_metrics(hy, inc_pred)
    result["plan"].update(holdout_interval=[int(plan["holdout"][0]), int(plan["holdout"][-1]) + 1],
                          holdout_n=len(holdout), incumbent_error=inc_metrics["error"],
                          incumbent_f1=inc_metrics["f1"])
    builders = {
        "full": lambda: train_full(frame.loc[plan["full_rows"]], settings),
        "partial": lambda: partial_update(incumbent, frame.loc[plan["partial_rows"]]),
    }
    for action, build in builders.items():
        rows = plan["full_rows"] if action == "full" else plan["partial_rows"]
        started = time.perf_counter()
        try:
            candidate = build()
            pred = candidate.predict(hx)
            cand_metrics = classification_metrics(hy, pred)
            evidence = {"compatible": True, "n": len(holdout), "train_rows": int(len(rows)),
                        "train_interval": [int(rows[0]), int(rows[-1]) + 1] if len(rows) else None,
                        "holdout_interval": result["plan"]["holdout_interval"],
                        "incumbent_error": inc_metrics["error"], "candidate_error": cand_metrics["error"],
                        "incumbent_f1": inc_metrics["f1"], "candidate_f1": cand_metrics["f1"],
                        **_paired(inc_err, pred != hy)}
            result["candidates"][action] = candidate
        except ValueError as exc:
            evidence = {"compatible": False, "n": len(holdout), "train_rows": int(len(rows)),
                        "reason": str(exc)}
        evidence["fit_seconds"] = time.perf_counter() - started
        result["evidence"][action] = evidence
    return result


def validation_gate(evidence: dict, settings) -> dict:
    """Deterministic promotion gate applied to the chronological hold-out."""
    checks = []
    if not evidence.get("compatible"):
        return {"passed": False, "checks": [{"check": "candidate available", "passed": False,
                                             "detail": evidence.get("reason", "")}]}
    checks.append({"check": "hold-out error lower than incumbent", "passed": evidence["reduction"] > 0,
                   "detail": f"{evidence['candidate_error']:.4f} vs {evidence['incumbent_error']:.4f}"})
    f1_ok = evidence["candidate_f1"] >= evidence["incumbent_f1"] - settings.f1_tolerance
    checks.append({"check": f"macro-F1 not lower by more than {settings.f1_tolerance}", "passed": f1_ok,
                   "detail": f"{evidence['candidate_f1']:.4f} vs {evidence['incumbent_f1']:.4f}"})
    checks.append({"check": "hold-out size >= minimum evidence", "passed": evidence["n"] >= settings.min_evidence,
                   "detail": f"{evidence['n']} labels"})
    return {"passed": all(c["passed"] for c in checks), "checks": checks}


# ------------------------------------------------------------------ artifacts
def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def save_artifact(model: ModelBundle, path: Path, metadata: dict) -> str:
    """Persist model + preprocessing + schema + classes + metadata; return SHA-256."""
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    # Store the bundle's fields rather than the dataclass instance, so artifacts do not
    # depend on the identity of the ModelBundle class (e.g. after a module reload).
    state = {f.name: getattr(model, f.name) for f in fields(ModelBundle)}
    try:
        joblib.dump({"format": ARTIFACT_FORMAT, "model_state": state, "metadata": metadata}, tmp, compress=3)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
    return file_sha256(path)


def load_artifact(path: Path, expected_sha256: str) -> tuple[ModelBundle, dict]:
    """Load only artifacts this application wrote: the checksum recorded in the
    registry must match before anything is deserialised."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Model artifact {path.name} is missing")
    if not expected_sha256 or file_sha256(path) != expected_sha256:
        raise ValueError(f"Checksum mismatch for {path.name}; refusing to load")
    payload = joblib.load(path)
    if not isinstance(payload, dict) or payload.get("format") != ARTIFACT_FORMAT:
        raise ValueError("Unrecognised artifact format")
    state = payload.get("model_state")
    if not isinstance(state, dict) or set(state) != {f.name for f in fields(ModelBundle)}:
        raise ValueError("Artifact does not contain a complete model bundle")
    return ModelBundle(**state), payload["metadata"]
