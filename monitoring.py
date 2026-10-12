"""Monitoring layer (L1): PSI covariate drift, ADWIN/DDM on prediction errors,
rolling performance, staleness ("learning debt") and evaluation triggers.

Important distinction: PSI measures change in P(X) only. A PSI alarm is
reported as *covariate shift*; predictive degradation requires label-based
evidence (error detectors or a rolling error above the reference level).
"""
from __future__ import annotations

import math
from collections import deque

import numpy as np
import pandas as pd
from sklearn.metrics import precision_recall_fscore_support

MAX_CATEGORY_BINS = 30
PSI_MIN_SAMPLE = 100


# ------------------------------------------------------------------------ PSI
def psi_reference(x: pd.DataFrame, bins: int = 10) -> dict:
    """Fixed reference bins computed once from a model's training window."""
    spec = {}
    for col in x.columns:
        s = x[col]
        if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
            values = pd.to_numeric(s, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
            if len(values):
                edges = np.unique(np.quantile(values.to_numpy(float), np.linspace(0, 1, bins + 1)[1:-1]))
                if len(edges) == 0:            # constant feature: split at the constant
                    edges = np.array([float(values.iloc[0])])
            else:
                edges = np.array([0.0])
            item = {"kind": "numeric", "edges": [float(e) for e in edges]}
        else:
            counts = s.dropna().astype(str).value_counts()
            item = {"kind": "categorical", "values": counts.index[:MAX_CATEGORY_BINS].tolist()}
        item["counts"] = _bin_counts(s, item).tolist()
        item["n"] = int(len(s))
        spec[col] = item
    return spec


def _bin_counts(s: pd.Series, item: dict) -> np.ndarray:
    if item["kind"] == "numeric":
        values = pd.to_numeric(s, errors="coerce").replace([np.inf, -np.inf], np.nan)
        present = values.dropna().to_numpy(float)
        # Right-closed bins: (-inf, e1], (e1, e2], ..., (ek, inf), plus a missing bin.
        idx = np.searchsorted(np.asarray(item["edges"], float), present, side="left")
        counts = np.bincount(idx, minlength=len(item["edges"]) + 1).astype(float)
        return np.append(counts, float(values.isna().sum()))
    text = s.map(lambda v: "__missing__" if pd.isna(v) else str(v))
    known = item["values"]
    counts = [float((text == v).sum()) for v in known]
    other = float((~text.isin(known) & (text != "__missing__")).sum())
    return np.array(counts + [other, float((text == "__missing__").sum())])


def psi(reference: dict, x: pd.DataFrame) -> dict:
    """PSI per feature against fixed reference bins.

    Proportions use +0.5 count smoothing so empty bins never produce infinite
    values. ``noise_floor`` approximates the expected PSI under no change
    ((k-1)(1/n+1/m)); a shift is only flagged when PSI exceeds both the user
    threshold and three times that floor, which keeps small batches safe.
    """
    out = {}
    for col, item in reference.items():
        if col not in x.columns:
            out[col] = {"psi": None, "n": 0, "noise_floor": None, "reason": "column missing"}
            continue
        expected = np.asarray(item["counts"], float) + 0.5
        actual = _bin_counts(x[col], item) + 0.5
        e = expected / expected.sum()
        a = actual / actual.sum()
        n, m = int(len(x)), max(int(item.get("n", 0)), 1)
        k = int(((np.asarray(item["counts"]) > 0) | (actual > 0.5)).sum())
        value = float(np.sum((a - e) * np.log(a / e)))
        out[col] = {"psi": value, "n": n, "noise_floor": float(max(k - 1, 1) * (1 / max(n, 1) + 1 / m))}
    return out


def psi_summary(values: dict, threshold: float) -> dict:
    valid = {k: v for k, v in values.items() if v.get("psi") is not None}
    if not valid:
        return {"max_psi": None, "max_feature": None, "shifted": [], "reliable": False}
    feature = max(valid, key=lambda k: valid[k]["psi"])
    n = next(iter(valid.values()))["n"]
    shifted = sorted(k for k, v in valid.items()
                     if v["psi"] >= threshold and v["psi"] >= 3 * v["noise_floor"])
    return {"max_psi": valid[feature]["psi"], "max_feature": feature, "shifted": shifted,
            "reliable": n >= PSI_MIN_SAMPLE}


# ---------------------------------------------------------------------- ADWIN
class ADWIN:
    """ADWIN change detector (Bifet & Gavalda, 2007) on a bounded exact window.

    Uses the ADWIN2 cut condition with the variance-based bound (the same
    form as River's implementation) but tests every split point of an exact
    window instead of exponential-histogram bucket boundaries. The window is
    capped at ``max_window`` items to bound memory and time.
    """

    def __init__(self, delta: float = 0.002, max_window: int = 5_000, min_length: int = 5,
                 clock: int = 32):
        if not 0 < delta < 1:
            raise ValueError("delta must be in (0, 1)")
        self.delta, self.max_window, self.min_length, self.clock = delta, max_window, min_length, clock
        self.window: deque = deque(maxlen=max_window)
        self.ticks = 0
        self.detections = 0

    def update(self, value: float) -> dict | None:
        self.window.append(float(value))
        self.ticks += 1
        if self.ticks % self.clock == 0:
            return self._check()
        return None

    def update_many(self, values) -> list[dict]:
        found = []
        for i, v in enumerate(values):
            result = self.update(v)
            if result:
                result["position"] = i       # index within ``values`` where the cut was found
                found.append(result)
        return found

    @property
    def mean(self) -> float | None:
        return float(np.mean(self.window)) if self.window else None

    def _check(self) -> dict | None:
        detection = None
        for _ in range(50):  # bounded number of shrink steps
            w = np.fromiter(self.window, float)
            n = len(w)
            if n < 2 * self.min_length + 1:
                break
            cs = np.cumsum(w)
            n0 = np.arange(self.min_length, n - self.min_length + 1)
            n1 = n - n0
            mu0 = cs[n0 - 1] / n0
            mu1 = (cs[-1] - cs[n0 - 1]) / n1
            var = float(w.var())
            m = 1.0 / (n0 - self.min_length + 1) + 1.0 / (n1 - self.min_length + 1)
            dd = math.log(2 * math.log(n) / self.delta)
            eps = np.sqrt(2 * m * var * dd) + (2.0 / 3.0) * dd * m
            fire = np.nonzero(np.abs(mu0 - mu1) > eps)[0]
            if len(fire) == 0:
                break
            i = int(fire[0])
            if detection is None:
                detection = {"old_mean": float(mu0[i]), "new_mean": float(mu1[i]),
                             "increase": bool(mu1[i] > mu0[i]), "window_before": n}
            for _ in range(int(n0[i])):
                self.window.popleft()
        if detection:
            self.detections += 1
            detection["window_after"] = len(self.window)
        return detection

    def state(self) -> dict:
        return {"delta": self.delta, "max_window": self.max_window, "min_length": self.min_length,
                "clock": self.clock, "window": list(self.window), "ticks": self.ticks,
                "detections": self.detections}

    @classmethod
    def from_state(cls, state: dict) -> "ADWIN":
        obj = cls(state["delta"], state["max_window"], state["min_length"], state["clock"])
        obj.window.extend(state["window"])
        obj.ticks, obj.detections = state["ticks"], state["detections"]
        return obj


# ------------------------------------------------------------------------ DDM
class DDM:
    """Drift Detection Method (Gama et al., 2004) on a binary error stream."""

    def __init__(self, min_instances: int = 30, warning: float = 2.0, drift: float = 3.0):
        self.min_instances, self.warning_level, self.drift_level = min_instances, warning, drift
        self.reset()

    def reset(self):
        self.n, self.p, self.s = 0, 1.0, 0.0
        self.p_min, self.s_min = float("inf"), float("inf")

    def update(self, error: int) -> str:
        if error not in (0, 1):
            raise ValueError("DDM expects 0/1 errors")
        self.n += 1
        self.p += (error - self.p) / self.n
        self.s = math.sqrt(self.p * (1 - self.p) / self.n)
        if self.n < self.min_instances:
            return "stable"
        if self.p + self.s <= self.p_min + self.s_min:
            self.p_min, self.s_min = self.p, self.s
        level = self.p + self.s
        if level > self.p_min + self.drift_level * self.s_min:
            self.reset()
            return "drift"
        if level > self.p_min + self.warning_level * self.s_min:
            return "warning"
        return "stable"

    def state(self) -> dict:
        return {k: getattr(self, k) for k in ("min_instances", "warning_level", "drift_level",
                                               "n", "p", "s", "p_min", "s_min")}

    @classmethod
    def from_state(cls, state: dict) -> "DDM":
        obj = cls(state["min_instances"], state["warning_level"], state["drift_level"])
        for k in ("n", "p", "s", "p_min", "s_min"):
            setattr(obj, k, float("inf") if state[k] is None else state[k])
        obj.n = int(obj.n)
        return obj


# -------------------------------------------------------------------- metrics
def wilson(errors: int, n: int, z: float = 1.96) -> tuple[float, float] | None:
    if n <= 0:
        return None
    p = errors / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    radius = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - radius), min(1.0, centre + radius)


def classification_metrics(y_true, y_pred, labels=None) -> dict:
    y_true = np.asarray(y_true, dtype=object).astype(str)
    y_pred = np.asarray(y_pred, dtype=object).astype(str)
    n = len(y_true)
    if n == 0:
        return {"n": 0, "accuracy": None, "error": None, "precision": None, "recall": None,
                "f1": None, "error_ci": None}
    errors = int(np.sum(y_true != y_pred))
    present = sorted(set(y_true) | set(y_pred)) if labels is None else list(labels)
    p, r, f, _ = precision_recall_fscore_support(y_true, y_pred, labels=present, average="macro",
                                                 zero_division=0)
    return {"n": n, "accuracy": 1 - errors / n, "error": errors / n, "precision": float(p),
            "recall": float(r), "f1": float(f), "error_ci": wilson(errors, n)}


# --------------------------------------------------------------- monitor state
def new_monitor(settings, reference_error: float, reference_n: int, psi_ref: dict) -> dict:
    """Fresh monitor for a newly deployed model version."""
    return {
        "reference_error": float(reference_error), "reference_n": int(reference_n),
        "rolling": [], "adwin": ADWIN(settings.adwin_delta).state(),
        "ddm": DDM(settings.ddm_min_instances).state(),
        "learning_debt": 0.0, "labels_since_update": 0, "labels_since_evaluation": 0,
        "predictions_since_update": 0, "adwin_alarms": 0, "ddm_drifts": 0, "psi_reference": psi_ref,
        "recent_rows": [], "change_row": None,
    }


def update_with_labels(monitor: dict, errors, settings, rows=None) -> dict:
    """Feed revealed 0/1 errors (chronological order) into all detectors.

    ``rows`` (stream row ids aligned with ``errors``) lets an ADWIN error-rate
    increase be mapped to an estimated change row: the first row still inside
    ADWIN's window after the cut. Training on rows after it is the classic
    ADWIN-style adaptive window.
    """
    errors = [int(e) for e in errors]
    rows = [int(r) for r in rows] if rows is not None else None
    adwin = ADWIN.from_state(monitor["adwin"])
    ddm = DDM.from_state(monitor["ddm"])
    detections = adwin.update_many(errors)
    ddm_status = "stable"
    for e in errors:
        status = ddm.update(e)
        if status == "drift" or (status == "warning" and ddm_status == "stable"):
            ddm_status = status
    rolling = (monitor["rolling"] + errors)[-settings.rolling_window:]
    excess = sum(errors) - monitor["reference_error"] * len(errors)
    monitor["learning_debt"] = max(0.0, monitor["learning_debt"] + excess)  # CUSUM-style, floored at 0
    monitor["labels_since_update"] += len(errors)
    monitor["labels_since_evaluation"] += len(errors)
    increase = [d for d in detections if d["increase"]]
    if rows is not None:
        recent = (monitor.get("recent_rows", []) + rows)[-adwin.max_window:]
        monitor["recent_rows"] = recent
        if increase:
            d = increase[-1]
            index = len(recent) - len(rows) + d["position"] + 1 - d["window_after"]
            if 0 <= index < len(recent):
                monitor["change_row"] = recent[index]
    monitor["adwin_alarms"] += len(increase)
    monitor["ddm_drifts"] += int(ddm_status == "drift")
    monitor.update(rolling=rolling, adwin=adwin.state(), ddm=ddm.state())
    n = len(rolling)
    ci = wilson(int(sum(rolling)), n) if n else None
    return {
        "adwin_detections": detections, "adwin_error_increase": bool(increase),
        "ddm_status": ddm_status, "rolling_error": (sum(rolling) / n) if n else None,
        "rolling_n": n, "rolling_error_ci": ci,
        "degradation": (sum(rolling) / n - monitor["reference_error"]) if n else None,
        "learning_debt": monitor["learning_debt"], "change_row": monitor.get("change_row"),
    }


def drift_status(label_signals: dict, psi_info: dict, monitor: dict, settings) -> dict:
    ci = label_signals.get("rolling_error_ci")
    enough = label_signals.get("rolling_n", 0) >= max(30, settings.min_evidence // 2)
    sustained = bool(enough and ci and ci[0] > monitor["reference_error"] + settings.degradation_margin)
    predictive = bool(label_signals.get("adwin_error_increase") or
                      label_signals.get("ddm_status") == "drift" or sustained)
    covariate = bool(psi_info.get("reliable") and psi_info.get("shifted"))
    if not enough and not predictive:
        status = "insufficient labels" if not covariate else "covariate shift (labels pending)"
    elif predictive and covariate:
        status = "covariate shift + predictive degradation"
    elif predictive:
        status = "predictive degradation"
    elif covariate:
        status = "covariate shift only"
    else:
        status = "stable"
    return {"status": status, "covariate_signal": covariate, "predictive_signal": predictive,
            "sustained_degradation": sustained}


def evaluation_trigger(monitor: dict, telemetry: dict, settings, batches_since_update: int,
                       batches_since_evaluation: int, cheapest_action_cost: float) -> tuple[bool, list]:
    """Step 1 of the decision workflow: is it worth paying for shadow evaluation?"""
    reasons = []
    if monitor["labels_since_update"] < settings.min_evidence:
        return False, ["fewer new labels than minimum evidence"]
    if batches_since_update < settings.cooldown_batches:
        return False, ["cooldown"]
    if telemetry.get("adwin_error_increase"):
        reasons.append("ADWIN detected an error-rate increase")
    if telemetry.get("ddm_status") == "drift":
        reasons.append("DDM drift level reached")
    if telemetry.get("sustained_degradation"):
        reasons.append("rolling error CI above reference + margin")
    debt_cost = monitor["learning_debt"] * settings.error_value
    if cheapest_action_cost > 0 and debt_cost >= 0.5 * cheapest_action_cost:
        reasons.append(f"learning debt ${debt_cost:.0f} >= half the cheapest action cost")
    if telemetry.get("covariate_signal") and monitor["labels_since_evaluation"] >= settings.min_evidence:
        reasons.append("covariate shift with enough new labels to test impact")
    if batches_since_evaluation >= settings.max_batches_between_evaluations:
        reasons.append("periodic staleness check interval reached")
    return bool(reasons), reasons
