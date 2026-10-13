"""RetrainWise automated tests:  python -m unittest test_project -v"""
from __future__ import annotations

import copy
import json
import math
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

import numpy as np
import pandas as pd

import agent
import jobs
import pipeline
import worker
from config import Settings, safe_child
from database import Database, now
from datasets import SYNTHETIC_SEGMENTS, load, parse_arff, synthetic
from economics import action_costs, cost_trace, rank_actions, realization_factor, sensitivity
from experiments import benchmark, label_mask, simulate
from models import (initial_model, load_artifact, partial_update, plan_windows, save_artifact, shadow_evaluate,
                    train_full, validation_gate)
from monitoring import (ADWIN, DDM, classification_metrics, drift_status, new_monitor, psi, psi_reference,
                        psi_summary, update_with_labels, wilson)
from pipeline import Lifecycle, LifecycleError
from preprocessing import align, fit_preprocessor, infer_schema

FAST = dict(batch_size=250, initial_size=500, train_window=1500, min_evidence=60, rolling_window=500,
            post_update_window=200)


def ev(reduction=0.05, se=0.01, n=500, compatible=True, rows=1000):
    return {"compatible": compatible, "n": n, "reduction": reduction, "reduction_se": se,
            "reduction_ci": [reduction - 1.96 * se, reduction + 1.96 * se], "train_rows": rows,
            "incumbent_error": 0.3, "candidate_error": 0.3 - reduction, "incumbent_f1": 0.7,
            "candidate_f1": 0.7 + reduction}


def ctx(**kw):
    base = {"spent": 0.0, "batches_since_update": 10, "horizon": 5000, "price_multiplier": 1.0,
            "realization": {"factor": 1.0}}
    base.update(kw)
    return base


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="rw_test_"))

    def tearDown(self):
        pipeline._FRAMES.clear()
        pipeline._MODELS.clear()
        shutil.rmtree(self.dir, ignore_errors=True)


# ------------------------------------------------------------------- config
class ConfigTests(unittest.TestCase):
    def test_defaults_valid_and_roundtrip(self):
        s = Settings().validate()
        self.assertEqual(Settings.from_dict(json.loads(json.dumps(s.to_dict()))), s)

    def test_rejects_invalid_values(self):
        for change in ({"error_value": float("nan")}, {"budget": float("inf")}, {"budget": -1.0},
                       {"batch_size": 2.5}, {"regime": "free"}, {"label_fraction": 0.0},
                       {"cost_trace_custom": (1.0, float("nan"))}, {"min_confidence": 1.0},
                       {"ollama_model": "bad model; rm"}, {"seed": True}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                Settings().replace(**change)
        with self.assertRaises(ValueError):
            Settings.from_dict({"unknown_field": 1})

    def test_safe_child_rejects_traversal(self):
        for bad in ("../x.joblib", "a/b.joblib", "", ".hidden", "..\\x"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                safe_child(bad)


# ----------------------------------------------------------------- economics
class EconomicsTests(unittest.TestCase):
    def setUp(self):
        self.s = Settings(min_confidence=0.6)

    def test_benefit_cost_and_net_formula(self):
        result = rank_actions({"full": ev(0.05, 0.01), "partial": ev(0.0, 0.01)}, ctx(), self.s)
        full = next(r for r in result["ranked"] if r["action"] == "full")
        self.assertAlmostEqual(full["benefit"], 0.05 * 5000 * self.s.error_value)
        costs = action_costs("full", self.s, 1000, 1.0)
        self.assertAlmostEqual(full["total_cost"], costs["total"])
        self.assertAlmostEqual(costs["total"], sum(costs[k] for k in ("compute", "engineering", "validation",
                                                                       "deployment_risk", "probe")))
        self.assertGreater(costs["probe"], 0)       # one post-update verification probe
        self.assertEqual(action_costs("full", self.s, 1000, 1.0, include_probe=False)["probe"], 0.0)
        self.assertAlmostEqual(full["net_value"], full["benefit"] - full["total_cost"])
        self.assertEqual(result["recommended"], "full")

    def test_defer_is_zero_reference_and_wins_when_nothing_pays(self):
        result = rank_actions({"full": ev(0.001), "partial": ev(0.001)}, ctx(), self.s)
        self.assertEqual(result["recommended"], "defer")
        defer = next(r for r in result["ranked"] if r["action"] == "defer")
        self.assertEqual((defer["net_value"], defer["total_cost"], defer["feasible"]), (0.0, 0.0, True))

    def test_ranking_prefers_higher_net_among_feasible(self):
        result = rank_actions({"full": ev(0.06, 0.005), "partial": ev(0.05, 0.005)}, ctx(), self.s)
        nets = {r["action"]: r["net_value"] for r in result["ranked"]}
        best = max(("full", "partial"), key=nets.get)
        self.assertEqual(result["recommended"], best)
        self.assertEqual([r["rank"] for r in result["ranked"]], [1, 2, 3])

    def test_realization_factor_scales_benefit(self):
        a = rank_actions({"full": ev()}, ctx(realization={"factor": 1.0}), self.s)
        b = rank_actions({"full": ev()}, ctx(realization={"factor": 0.5}), self.s)
        fa = next(r for r in a["ranked"] if r["action"] == "full")["benefit"]
        fb = next(r for r in b["ranked"] if r["action"] == "full")["benefit"]
        self.assertAlmostEqual(fb, fa * 0.5)

    def test_nonfinite_and_invalid_inputs_rejected(self):
        for bad_ev, bad_ctx in ((ev(float("nan")), ctx()), (ev(0.05, float("inf")), ctx()), (ev(1.5), ctx()),
                                (ev(), ctx(spent=float("nan"))), (ev(), ctx(horizon=-5)),
                                (ev(), ctx(price_multiplier="x"))):
            with self.subTest(ev=bad_ev["reduction"], ctx=bad_ctx), self.assertRaises(ValueError):
                rank_actions({"full": bad_ev}, bad_ctx, self.s)
        with self.assertRaises(ValueError):
            action_costs("teleport", self.s, 100)

    def _guards(self, result, action):
        row = next(r for r in result["ranked"] if r["action"] == action)
        return {g["name"]: g["passed"] for g in row["guardrails"]}, row

    def test_budget_limit_and_spending_limit(self):
        guards, row = self._guards(rank_actions({"full": ev(0.2)}, ctx(spent=self.s.budget - 1), self.s), "full")
        self.assertFalse(guards["cumulative budget"])
        self.assertFalse(row["feasible"])
        tight = self.s.replace(action_limit=10.0)
        guards, _ = self._guards(rank_actions({"full": ev(0.2)}, ctx(), tight), "full")
        self.assertFalse(guards["action spending limit"])

    def test_evidence_cooldown_confidence_and_compatibility(self):
        guards, _ = self._guards(rank_actions({"full": ev(0.2, n=10)}, ctx(), self.s), "full")
        self.assertFalse(guards["minimum evidence"])
        guards, _ = self._guards(rank_actions({"full": ev(0.2)}, ctx(batches_since_update=0), self.s), "full")
        self.assertFalse(guards["cooldown"])
        guards, _ = self._guards(rank_actions({"full": ev(0.04, se=0.05)}, ctx(), self.s), "full")
        self.assertFalse(guards["confidence P(net > 0)"])
        guards, row = self._guards(rank_actions({"partial": {"compatible": False, "n": 0, "reason": "new class"}},
                                                ctx(), self.s), "partial")
        self.assertFalse(guards["candidate available / incremental compatibility"])
        self.assertLess(row["net_value"], 0)

    def test_insufficient_evidence_defaults_to_defer(self):
        result = rank_actions({}, ctx(), self.s)
        self.assertEqual(result["recommended"], "defer")

    def test_regimes_ordered_and_trace_deterministic(self):
        totals = [action_costs("full", self.s.replace(regime=r), 3000)["total"] for r in ("cheap", "balanced", "expensive")]
        self.assertEqual(totals, sorted(totals))
        for kind in ("flat", "diurnal", "spot"):
            s = self.s.replace(cost_trace_kind=kind)
            self.assertTrue(np.array_equal(cost_trace(s, 50), cost_trace(s, 50)))
            self.assertTrue(np.all(cost_trace(s, 50) > 0))
        custom = self.s.replace(cost_trace_kind="custom", cost_trace_custom=(1.0, 2.0))
        self.assertEqual(cost_trace(custom, 4).tolist(), [1.0, 2.0, 1.0, 2.0])

    def test_realization_factor_shrinks_to_prior(self):
        self.assertAlmostEqual(realization_factor([], self.s)["factor"], self.s.realization_prior)
        r = realization_factor([{"predicted_reduction": 0.1, "realized_reduction": 0.1}] * 8, self.s)
        self.assertGreater(r["factor"], self.s.realization_prior)
        self.assertLess(r["factor"], 1.0 + 1e-9)

    def test_sensitivity_changes_recommendation_with_error_value(self):
        rows = sensitivity({"full": ev(0.03, 0.002)}, ctx(), self.s)
        recs = {r["scenario"]: r["recommended"] for r in rows}
        self.assertEqual(recs["error value x0.25"], "defer")
        self.assertEqual(recs["error value x4.0"], "full")


# ---------------------------------------------------------------- monitoring
class MonitoringTests(unittest.TestCase):
    def test_psi_identical_vs_shifted(self):
        rng = np.random.default_rng(0)
        ref = pd.DataFrame({"a": rng.normal(size=4000), "c": rng.choice(list("xyz"), 4000)})
        spec = psi_reference(ref)
        same = psi(spec, pd.DataFrame({"a": rng.normal(size=2000), "c": rng.choice(list("xyz"), 2000)}))
        shifted = psi(spec, pd.DataFrame({"a": rng.normal(2, 1, 2000), "c": ["new"] * 2000}))
        self.assertLess(same["a"]["psi"], 0.05)
        self.assertGreater(shifted["a"]["psi"], 0.5)
        self.assertGreater(shifted["c"]["psi"], 1.0)        # unseen category lands in the 'other' bin
        self.assertEqual(psi_summary(same, 0.2)["shifted"], [])
        self.assertEqual(psi_summary(shifted, 0.2)["shifted"], ["a", "c"])

    def test_psi_constant_missing_and_small_samples_safe(self):
        spec = psi_reference(pd.DataFrame({"k": [3.0] * 500, "m": [np.nan] * 500}))
        out = psi(spec, pd.DataFrame({"k": [3.0] * 5, "m": [1.0, np.nan, np.nan, np.nan, np.nan]}))
        self.assertTrue(all(math.isfinite(v["psi"]) for v in out.values()))
        moved = psi(spec, pd.DataFrame({"k": [9.0] * 400, "m": [np.nan] * 400}))
        self.assertGreater(moved["k"]["psi"], 1.0)
        small = psi_summary(psi(psi_reference(pd.DataFrame({"a": np.arange(1000.0)})), pd.DataFrame({"a": [5.0, 6.0]})), 0.2)
        self.assertFalse(small["reliable"])

    def test_adwin_detects_step_and_is_quiet_when_stationary(self):
        rng = np.random.default_rng(1)
        quiet = ADWIN(0.002)
        self.assertEqual(len(quiet.update_many((rng.random(3000) < 0.2).astype(int))), 0)
        detector = ADWIN(0.002)
        stream = np.r_[(rng.random(1000) < 0.1), (rng.random(1000) < 0.6)].astype(int)
        found = detector.update_many(stream)
        self.assertTrue(found and found[0]["increase"])
        self.assertTrue(1000 <= found[0]["position"] <= 1200)
        restored = ADWIN.from_state(json.loads(json.dumps(detector.state())))
        self.assertEqual(list(restored.window), list(detector.window))

    def test_adwin_agrees_with_river_when_available(self):
        try:
            from river.drift import ADWIN as RiverADWIN
        except ImportError:
            self.skipTest("river not installed")
        rng = np.random.default_rng(2)
        stream = np.r_[(rng.random(1500) < 0.15), (rng.random(1500) < 0.55)].astype(int)
        mine = ADWIN(0.002).update_many(stream)
        theirs = RiverADWIN(delta=0.002)
        first = None
        for i, v in enumerate(stream):
            theirs.update(v)
            if theirs.drift_detected and first is None:
                first = i
        self.assertIsNotNone(first)
        self.assertLess(abs(mine[0]["position"] - first), 150)

    def test_ddm_flags_increase_and_matches_river(self):
        rng = np.random.default_rng(3)
        stream = np.r_[(rng.random(800) < 0.1), (rng.random(400) < 0.5)].astype(int)
        ddm = DDM()
        drifts = [i for i, e in enumerate(stream) if ddm.update(int(e)) == "drift"]
        self.assertTrue(any(800 <= i < 1000 for i in drifts))
        with self.assertRaises(ValueError):
            DDM().update(2)
        try:
            from river.drift.binary import DDM as RiverDDM
        except ImportError:
            self.skipTest("river not installed")
        ref, theirs = RiverDDM(warm_start=30), []
        for i, e in enumerate(stream):
            ref.update(int(e))
            if ref.drift_detected:
                theirs.append(i)
        self.assertEqual(drifts, theirs)   # identical alarms, including DDM's genuine false alarms

    def test_metrics_and_wilson(self):
        m = classification_metrics(["a", "b", "a", "a"], ["a", "b", "b", "a"])
        self.assertAlmostEqual(m["accuracy"], 0.75)
        lo, hi = wilson(25, 100)
        self.assertTrue(lo < 0.25 < hi)
        self.assertIsNone(classification_metrics([], [])["accuracy"])

    def test_covariate_shift_is_not_predictive_degradation(self):
        s = Settings()
        mon = new_monitor(s, 0.2, 500, {})
        signals = update_with_labels(mon, ([0] * 4 + [1]) * 40, s)    # error 0.2 = reference, no trend
        status = drift_status(signals, {"reliable": True, "shifted": ["x3"]}, mon, s)
        self.assertEqual(status["status"], "covariate shift only")
        self.assertFalse(status["predictive_signal"])
        signals = update_with_labels(mon, [1] * 300, s)
        status = drift_status(signals, {"reliable": True, "shifted": []}, mon, s)
        self.assertTrue(status["predictive_signal"])
        self.assertGreater(mon["learning_debt"], 0)


# ------------------------------------------------------------- preprocessing
class PreprocessingTests(unittest.TestCase):
    def test_fit_uses_only_training_window(self):
        frame = pd.DataFrame({"a": [1.0, 2.0, 3.0, 100.0, 200.0], "c": ["x", "y", "x", "z", "z"]})
        train = frame.iloc[:3]
        schema = infer_schema(train)
        t = fit_preprocessor(train, schema)
        imputer = t.named_transformers_["numeric"].named_steps["impute"]
        self.assertEqual(imputer.statistics_[0], 2.0)        # median of training rows only
        encoder = t.named_transformers_["categorical"].named_steps["encode"]
        self.assertEqual(sorted(encoder.categories_[0].tolist()), ["x", "y"])
        out = t.transform(align(frame.iloc[3:], schema)[0])  # unseen 'z' must not crash
        self.assertEqual(out.shape[0], 2)

    def test_align_handles_inconsistent_schema(self):
        schema = {"features": ["a", "b", "c"], "numeric": ["a", "b"], "categorical": ["c"]}
        batch = pd.DataFrame({"a": ["1", "oops"], "c": [1, None], "extra": [0, 0]})
        out, issues = align(batch, schema)
        self.assertEqual(list(out.columns), ["a", "b", "c"])
        self.assertEqual(issues["missing_columns"], ["b"])
        self.assertEqual(issues["unexpected_columns"], ["extra"])
        self.assertEqual(issues["coerced_values"], 1)
        self.assertTrue(pd.isna(out.loc[1, "c"]))


# -------------------------------------------------------------------- models
class ModelTests(TempDirCase):
    def setUp(self):
        super().setUp()
        self.s = Settings(**FAST)
        self.frame = synthetic(6000, 5)

    def test_full_training_and_multiclass(self):
        model = train_full(self.frame.iloc[:800], self.s)
        self.assertEqual(model.classes, ["negative", "positive"])
        multi = pd.DataFrame({"x": np.r_[np.zeros(100), np.ones(100), 2 * np.ones(100)] + np.random.default_rng(0).normal(0, .1, 300),
                              "target": ["a"] * 100 + ["b"] * 100 + ["c"] * 100}).sample(frac=1, random_state=0)
        multi = multi.reset_index(drop=True)
        m = train_full(multi, self.s)
        self.assertEqual(m.classes, ["a", "b", "c"])
        self.assertGreater(np.mean(m.predict(multi.drop(columns="target")) == multi.target), 0.9)
        with self.assertRaises(ValueError):
            train_full(multi.assign(target="a"), self.s)

    def test_incremental_update_is_genuine_and_guarded(self):
        model = train_full(self.frame.iloc[:800], self.s)
        updated = partial_update(model, self.frame.iloc[800:1300])
        self.assertFalse(np.allclose(model.estimator.coef_, updated.estimator.coef_))
        self.assertEqual(updated.trained_until, 1300)
        self.assertEqual(model.trained_until, 800)           # original untouched
        with self.assertRaises(ValueError):
            partial_update(updated, self.frame.iloc[1000:1400])   # overlaps learned rows
        bad = self.frame.iloc[1300:1400].assign(target="unknown")
        with self.assertRaises(ValueError):
            partial_update(updated, bad)

    def test_shadow_evaluation_is_chronological_and_leak_free(self):
        model = train_full(self.frame.iloc[:500], self.s)
        eligible = np.arange(0, 3000)
        plan = plan_windows(eligible, model, self.s)
        self.assertTrue(plan["ok"])
        start = plan["holdout"][0]
        self.assertGreaterEqual(start, model.trained_until)
        self.assertTrue((plan["full_rows"] < start).all() and (plan["partial_rows"] < start).all())
        result = shadow_evaluate(self.frame, eligible, model, self.s)
        for action in ("full", "partial"):
            evidence = result["evidence"][action]
            self.assertTrue(evidence["compatible"])
            self.assertLessEqual(evidence["train_interval"][1], evidence["holdout_interval"][0])
            self.assertEqual(result["candidates"][action].trained_until, evidence["train_interval"][1])

    def test_validation_gate_rejects_worse_candidates(self):
        good = validation_gate(ev(0.05), self.s)
        self.assertTrue(good["passed"])
        self.assertFalse(validation_gate(ev(-0.01), self.s)["passed"])
        self.assertFalse(validation_gate({**ev(0.05), "candidate_f1": 0.5}, self.s)["passed"])
        self.assertFalse(validation_gate({"compatible": False, "reason": "x"}, self.s)["passed"])

    def test_artifact_checksum_enforced(self):
        model = train_full(self.frame.iloc[:600], self.s)
        path = self.dir / "model_v001.joblib"
        sha = save_artifact(model, path, {"note": "test"})
        loaded, meta = load_artifact(path, sha)
        self.assertEqual(meta["note"], "test")
        self.assertTrue(np.array_equal(loaded.predict(self.frame.iloc[:50].drop(columns="target")),
                                       model.predict(self.frame.iloc[:50].drop(columns="target"))))
        import joblib
        payload = joblib.load(path)                  # artifact stores plain fields, not a class instance,
        self.assertIsInstance(payload["model_state"], dict)   # so a module reload cannot break pickling
        self.assertFalse(list(self.dir.glob("*.tmp")))
        with open(path, "ab") as handle:
            handle.write(b"tampered")
        with self.assertRaises(ValueError):
            load_artifact(path, sha)


# ------------------------------------------------------------------ datasets
class DatasetTests(TempDirCase):
    def test_parse_arff(self):
        raw = b"""@relation t
@attribute f numeric
@attribute g {u,v}
@attribute class {UP,DOWN}
@data
1.0,u,UP
?,v,DOWN
"""
        frame = parse_arff(raw, "class")
        self.assertEqual(list(frame.columns), ["f", "g", "target"])
        self.assertEqual(frame["target"].tolist(), ["UP", "DOWN"])
        self.assertTrue(pd.isna(frame.loc[1, "f"]))
        with self.assertRaises(ValueError):
            parse_arff(raw, "missing")

    def test_synthetic_reproducible_with_drift_features(self):
        a, b = synthetic(4000, 9), synthetic(4000, 9)
        pd.testing.assert_frame_equal(a, b)
        self.assertFalse(synthetic(4000, 10).equals(a))
        cut = int(SYNTHETIC_SEGMENTS["gradual_start"] * 4000)
        self.assertNotIn("west", set(a["region"].iloc[:cut]))
        self.assertIn("west", set(a["region"].iloc[cut:]))
        self.assertGreater(a["x5"].isna().sum(), 0)

    def test_missing_real_dataset_never_falls_back(self):
        with self.assertRaises(FileNotFoundError):
            load("electricity", "small", 1, self.dir)

    def test_label_mask_deterministic(self):
        self.assertTrue(np.array_equal(label_mask(1000, 3, 0.5), label_mask(1000, 3, 0.5)))
        self.assertAlmostEqual(label_mask(20000, 3, 0.5).mean(), 0.5, delta=0.02)
        self.assertTrue(label_mask(10, 3, 1.0).all())


# ------------------------------------------------------- benchmark / leakage
class BenchmarkTests(TempDirCase):
    def test_reproducible_results(self):
        s = Settings(**FAST)
        kw = dict(datasets=["synthetic"], size="small", seeds=[4], regimes=["balanced"], settings=s, write=False)
        a = pd.DataFrame(benchmark(**kw)["summary"]).drop(columns=["runtime_seconds", "decision_seconds"])
        b = pd.DataFrame(benchmark(**kw)["summary"]).drop(columns=["runtime_seconds", "decision_seconds"])
        pd.testing.assert_frame_equal(a, b)
        oracle = a[a.policy == "hindsight_oracle"].total_cost.iloc[0]
        never = a[a.policy == "never"].total_cost.iloc[0]
        self.assertLessEqual(oracle, never + 1e-9)            # 'no retrain' is inside the oracle's space

    def test_no_future_label_leakage_in_online_policies(self):
        s = Settings(**FAST)
        frame = synthetic(5000, 8)
        cut = 3000
        corrupted = frame.copy()
        flip = {"positive": "negative", "negative": "positive"}
        corrupted.loc[cut:, "target"] = corrupted.loc[cut:, "target"].map(flip)
        for policy in ("drift_triggered", "cara_ct_inspired", "retrainwise", "calendar"):
            _, ta = simulate(frame, s, policy)
            _, tb = simulate(corrupted, s, policy)
            before = [(r["batch"], r["action"]) for r in ta if r["end"] <= cut]
            after = [(r["batch"], r["action"]) for r in tb if r["end"] <= cut]
            self.assertEqual(before, after, policy)

    def test_writes_exports(self):
        s = Settings(**FAST)
        benchmark(["synthetic"], "small", [1], ["cheap"], ["never", "retrainwise"], s, self.dir, "t1")
        self.assertTrue((self.dir / "t1_summary.csv").exists())
        details = json.loads((self.dir / "t1_details.json").read_text())
        self.assertEqual(details["configuration"]["seeds"], [1])


# ------------------------------------------------------------------ pipeline
class PipelineTests(TempDirCase):
    def setUp(self):
        super().setUp()
        self.db = Database(self.dir / "t.db")
        self.life = Lifecycle(self.db, self.dir)
        self.life.save_settings(Settings(**FAST, cooldown_batches=1, min_confidence=0.6))
        self.run = self.life.start_run("synthetic", "small", 3)

    def advance(self, n):
        for _ in range(n):
            r = self.life.run(self.run["id"])
            self.life.process_batch(r["id"], r["position"])

    def promote(self):
        self.advance(8)
        d = self.life.evaluate(self.run["id"])
        action = next(r["action"] for r in d["ranked"] if r["action"] != "defer" and r["evidence"].get("compatible"))
        return d, action

    def test_duplicate_batch_is_noop(self):
        pos = self.life.run(self.run["id"])["position"]
        self.life.process_batch(self.run["id"], pos)
        self.assertTrue(self.life.process_batch(self.run["id"], pos)["noop"])
        self.assertEqual(len(self.life.telemetry(self.run["id"])), 1)

    def test_prequential_predict_then_reveal(self):
        self.life.save_settings(self.life.settings().replace(label_delay_batches=1))
        self.advance(1)
        t = self.life.telemetry(self.run["id"]).iloc[-1]
        self.assertEqual(t["labels_revealed"], 0)
        self.assertEqual(t["labels_pending"], 250)
        self.advance(1)
        self.assertEqual(self.life.telemetry(self.run["id"]).iloc[-1]["labels_revealed"], 250)

    def test_approval_required_and_duplicates_prevented(self):
        d, action = self.promote()
        self.assertEqual(self.life.evaluate(self.run["id"])["id"], d["id"])          # idempotent, charged once
        charges = self.db.query("SELECT COUNT(*) AS n FROM events WHERE kind='decision_created'")[0]["n"]
        self.assertEqual(charges, 1)
        with self.assertRaises(PermissionError):
            self.life.execute(d["id"], action, "tester", approved=False)
        with self.assertRaises(PermissionError):
            self.life.execute(d["id"], action, "agent", mode="autonomous")             # autonomy off
        result = self.life.execute(d["id"], action, "tester", approved=True)
        self.assertIn(result["status"], ("promoted", "rejected"))
        with self.assertRaises(LifecycleError):
            self.life.execute(d["id"], action, "tester", approved=True)
        self.assertEqual(self.db.query("SELECT COUNT(*) AS n FROM approvals")[0]["n"], 1)

    def test_stale_decision_cannot_execute(self):
        d, action = self.promote()
        self.advance(1)
        with self.assertRaises(LifecycleError):
            self.life.execute(d["id"], action, "tester", approved=True)

    def test_promotion_registry_and_rollback(self):
        d, action = self.promote()
        with mock.patch.object(pipeline, "validation_gate", return_value={"passed": True, "checks": []}):
            result = self.life.execute(d["id"], action, "tester", approved=True)
        self.assertEqual(result["status"], "promoted")
        run = self.life.run(self.run["id"])
        self.assertEqual(run["active_version"], result["version"])
        self.assertTrue((self.dir / f"model_v{result['version']:03d}.joblib").exists())
        self.assertFalse(list(self.dir.glob("candidate_*")))
        reg = self.life.registry(self.run["id"]).set_index("version")
        self.assertEqual(reg.loc[result["version"], "status"], "active")
        self.assertEqual(reg.loc[run["active_version"] - 1, "status"], "archived")
        with self.assertRaises(PermissionError):
            self.life.rollback(1, "tester", approved=False)
        self.life.rollback(1, "tester", approved=True, reason="test")
        self.assertEqual(self.life.run(self.run["id"])["active_version"], 1)
        self.assertEqual(self.life.registry(self.run["id"]).set_index("version").loc[result["version"], "status"],
                         "rolled_back")

    def test_validation_failure_rejects_candidate(self):
        d, action = self.promote()
        failing = {"passed": False, "checks": [{"check": "forced", "passed": False, "detail": ""}]}
        with mock.patch.object(pipeline, "validation_gate", return_value=failing):
            result = self.life.execute(d["id"], action, "tester", approved=True)
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(self.life.run(self.run["id"])["active_version"], 1)
        statuses = self.life.registry(self.run["id"])["status"].tolist()
        self.assertIn("rejected", statuses)

    def test_guardrails_enforced_at_execution(self):
        d, action = self.promote()
        with mock.patch.object(pipeline, "validation_gate", return_value={"passed": True, "checks": []}):
            self.life.execute(d["id"], action, "tester", approved=True)
        self.advance(1)                                  # cooldown 1 -> still evaluate immediately below
        self.life.save_settings(self.life.settings().replace(cooldown_batches=5))
        d2 = self.life.evaluate(self.run["id"])
        blocked = [r for r in d2["ranked"] if r["action"] != "defer"]
        self.assertTrue(all(not r["feasible"] for r in blocked))
        result = self.life.execute(d2["id"], blocked[0]["action"], "tester", approved=True)
        self.assertEqual(result["status"], "rejected")
        self.assertIn("guardrails", result["outcome"])

    def test_bounded_autonomy_respects_limits(self):
        self.life.save_settings(self.life.settings().replace(autonomy=True, autonomy_max_actions=1,
                                                             autonomy_max_cost=10_000.0))
        self.advance(14)
        run = self.life.run(self.run["id"])
        self.assertLessEqual(run["autonomous_actions"], 1)
        modes = {r["mode"] for r in self.db.query("SELECT mode FROM approvals")}
        self.assertTrue(modes <= {"autonomous"})

    def test_state_survives_restart_and_interrupted_work_is_marked(self):
        self.advance(3)
        d = self.life.evaluate(self.run["id"])
        with self.db.transaction() as c:
            c.execute("UPDATE decisions SET status='executing' WHERE id=?", (d["id"],))
        pipeline._FRAMES.clear()
        pipeline._MODELS.clear()
        fresh = Lifecycle(Database(self.dir / "t.db"), self.dir)
        run = fresh.active_run()
        self.assertEqual(run["position"], FAST["initial_size"] + 3 * FAST["batch_size"])
        self.assertEqual(len(fresh.telemetry(run["id"])), 3)
        self.assertEqual(fresh.recover()["interrupted_executions"], 1)
        self.assertEqual(fresh.decision(d["id"])["status"], "interrupted")
        fresh.process_batch(run["id"], run["position"])        # continues where it stopped


# --------------------------------------------------------------------- agent
class AgentTests(TempDirCase):
    def setUp(self):
        super().setUp()
        self.life = Lifecycle(Database(self.dir / "t.db"), self.dir)
        self.life.save_settings(Settings(**FAST))
        run = self.life.start_run("synthetic", "small", 3)
        for _ in range(6):
            r = self.life.run(run["id"])
            self.life.process_batch(r["id"], r["position"])
        self.decision = self.life.evaluate(run["id"])

    def test_argument_validation(self):
        self.assertEqual(agent.validate_arguments("get_monitoring_telemetry", '{"last_n_batches": 3}'),
                         {"last_n_batches": 3})
        for name, args in (("delete_everything", {}), ("get_monitoring_telemetry", {"last_n_batches": 999}),
                           ("get_monitoring_telemetry", {"x": 1}), ("get_registry_history", "not json"),
                           ("prepare_execution_request", {"decision_id": "abc", "action": "full"}),
                           ("prepare_execution_request", {"decision_id": "a;b", "action": "full", "rationale": "r"}),
                           ("prepare_execution_request", {"decision_id": "abc", "action": "nuke", "rationale": "r"})):
            with self.subTest(name=name, args=args), self.assertRaises(agent.ToolError):
                agent.validate_arguments(name, args)

    def test_deterministic_mode(self):
        out = agent.explain(self.life, self.decision, mode="deterministic")
        self.assertEqual(out["status"], "completed")
        self.assertIn("Deterministic explanation mode", out["report"])
        for heading in ("What changed", "Why it matters", "Costs and benefits", "Recommendation", "Uncertainty"):
            self.assertIn(heading, out["report"])
        calls = self.life.db.query("SELECT tool, status FROM agent_tool_calls WHERE report_id=?", (out["report_id"],))
        self.assertEqual(len(calls), 5)          # telemetry, registry, probes, pricing, evaluations

    def test_mock_provider_tool_loop(self):
        did = self.decision["id"]
        script = [
            {"content": "", "tool_calls": [{"function": {"name": "get_monitoring_telemetry", "arguments": {"last_n_batches": 2}}},
                                           {"function": {"name": "get_action_evaluations", "arguments": {}}}]},
            {"content": "", "tool_calls": [{"function": {"name": "drop_tables", "arguments": {}}},
                                           {"function": {"name": "prepare_execution_request",
                                                         "arguments": {"decision_id": did, "action": "full",
                                                                       "rationale": "test"}}}]},
            {"content": f"What changed: ... Recommendation: {self.decision['recommended']}."},
        ]
        seen = []

        def provider(messages, tools):
            seen.append(len(messages))
            self.assertEqual({t["function"]["name"] for t in tools}, set(agent.TOOL_SPECS))
            return script[len(seen) - 1]

        out = agent.explain(self.life, self.decision, mode="ollama", model="mock", provider=provider)
        self.assertEqual(out["status"], "completed")
        self.assertEqual(out["iterations"], 3)
        self.assertIn("LLM explanation", out["report"])
        calls = self.life.db.query("SELECT tool, status FROM agent_tool_calls WHERE report_id=? ORDER BY id",
                                   (out["report_id"],))
        self.assertEqual([c["status"] for c in calls], ["ok", "ok", "rejected", "ok"])
        req = self.life.db.query("SELECT * FROM execution_requests")
        self.assertEqual(len(req), 1)
        self.assertEqual(req[0]["status"], "awaiting_approval")
        self.assertEqual(self.life.decision(did)["status"], "pending")          # nothing executed

    def test_textual_tool_calls_are_executed_not_reported(self):
        self.assertEqual(agent.textual_tool_calls('{"name": "get_cost_assumptions", "arguments": {}}'),
                         [{"function": {"name": "get_cost_assumptions", "arguments": {}}}])
        self.assertEqual(agent.textual_tool_calls("What changed: the error rose."), [])
        prose = 'I will call a tool.\n\n{"name": "get_action_evaluations", "parameters": {"decision_id": "abc"}}'
        self.assertEqual(agent.textual_tool_calls(prose)[0]["function"]["arguments"], {"decision_id": "abc"})
        rec = self.decision["recommended"]
        script = [{"content": '```json\n{"name": "get_cost_assumptions", "arguments": {}}\n```'},
                  {"content": "What changed: costs reviewed. Recommendation: defer."},     # answers too early
                  {"content": '{"name": "get_action_evaluations", "arguments": {}}'},       # after the nudge
                  {"content": f"What changed: costs reviewed. Recommendation: {rec}."}]
        replies = iter(script)
        out = agent.explain(self.life, self.decision, mode="ollama", provider=lambda m, t: next(replies))
        self.assertEqual(out["status"], "completed")
        self.assertEqual(out["iterations"], 4)
        tools = [c["tool"] for c in self.life.db.query("SELECT tool FROM agent_tool_calls WHERE report_id=?",
                                                       (out["report_id"],))]
        self.assertEqual(tools, ["get_cost_assumptions", "get_action_evaluations"])
        json_answer = agent.explain(self.life, self.decision, mode="ollama",
                                    provider=lambda m, t: {"content": '{"answer": 1}'})
        self.assertEqual(json_answer["status"], "fallback")

    def test_llm_recommendation_must_match_engine(self):
        self.assertTrue(agent.recommendation_consistency("## Recommendation\nApply a partial update.", "partial")["consistent"])
        self.assertFalse(agent.recommendation_consistency("### Recommendation:\nWe recommend to **defer**.", "partial")["consistent"])
        self.assertFalse(agent.recommendation_consistency("No headings at all.", "full")["consistent"])
        wrong = "defer" if self.decision["recommended"] != "defer" else "full retraining"
        script = [{"content": "", "tool_calls": [{"function": {"name": "get_action_evaluations", "arguments": {}}}]},
                  {"content": f"What changed: x.\n\nRecommendation: {wrong}.\n\nUncertainty: y."}]
        replies = iter(script)
        out = agent.explain(self.life, self.decision, mode="ollama", provider=lambda m, t: next(replies))
        self.assertEqual(out["status"], "completed_with_warning")
        self.assertIn("Consistency check failed", out["report"])
        self.assertEqual(self.life.decision(self.decision["id"])["recommended"], self.decision["recommended"])

    def test_iteration_limit_and_failure_fall_back(self):
        loop = lambda m, t: {"content": "", "tool_calls": [{"function": {"name": "get_cost_assumptions", "arguments": {}}}]}
        out = agent.explain(self.life, self.decision, mode="ollama", provider=loop, max_iterations=3)
        self.assertEqual(out["status"], "fallback")
        self.assertIn("deterministic explanation", out["report"])

        def broken(m, t):
            raise ConnectionError("no server")
        out = agent.explain(self.life, self.decision, mode="ollama", provider=broken)
        self.assertEqual(out["status"], "fallback")
        self.assertIn("ConnectionError", out["error"])


# ---------------------------------------------------------------------- jobs
class JobTests(TempDirCase):
    def setUp(self):
        super().setUp()
        self.db = Database(self.dir / "jobs.db")
        self.payload = {"datasets": ["synthetic"], "policies": ["never", "calendar"], "regimes": ["cheap"],
                        "seeds": [1], "size": "small", "settings": Settings(**FAST).to_dict()}

    def test_submit_dedupe_and_worker_completion(self):
        job, created = jobs.submit(self.db, self.payload, launch=False)
        self.assertTrue(created)
        self.assertEqual(jobs.submit(self.db, self.payload, launch=False), (job, False))
        with self.assertRaises(ValueError):
            jobs.submit(self.db, {**self.payload, "seeds": [2]}, launch=False)
        self.assertEqual(worker.run(job, self.db.path), "completed")
        row = jobs.jobs(self.db)[0]
        self.assertEqual((row["status"], row["progress"]), ("completed", 1.0))
        self.assertTrue((self.dir / f"experiment_{job}_summary.csv").exists())
        self.assertEqual(worker.run(job, self.db.path), "not claimed")        # never runs twice

    def test_cancel_and_restart_interruption(self):
        job, _ = jobs.submit(self.db, self.payload, launch=False)
        jobs.cancel(self.db, job)
        self.assertEqual(worker.run(job, self.db.path), "cancelled")
        job2, _ = jobs.submit(self.db, {**self.payload, "seeds": [3]}, launch=False)
        old = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        with self.db.transaction() as c:
            c.execute("UPDATE jobs SET status='running', heartbeat=?, created=? WHERE id=?", (old, old, job2))
        self.assertEqual(jobs.recover(self.db), 1)
        self.assertEqual(self.db.one("SELECT status FROM jobs WHERE id=?", (job2,))["status"], "interrupted")

    def test_payload_validation(self):
        for bad in ({"datasets": ["nope"]}, {"policies": []}, {"seeds": list(range(20))}, {"size": "huge"},
                    {"datasets": ["electricity"]}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                jobs.validate_payload({**self.payload, **bad}, self.dir)


# ---------------------------------------------------- probe / DiD staleness
class StalenessTests(unittest.TestCase):
    """Probe-model difference-in-differences, renewal rule, VOI scheduling, recovery ratios."""

    def setUp(self):
        self.s = Settings()

    @staticmethod
    def errors(rate, n=2000, seed=0):
        return (np.random.default_rng(seed).random(n) < rate).astype(int)

    def test_did_detects_avoidable_staleness(self):
        import staleness as stl
        base = stl.pool([stl.paired(self.errors(0.20, seed=1), self.errors(0.25, seed=2))])
        # Deployed model degrades to 0.40 while a fresh probe stays at 0.25.
        result = stl.did(stl.paired(self.errors(0.40, seed=3), self.errors(0.25, seed=4)), base)
        self.assertGreater(result["did"], 0.15)
        self.assertEqual(result["classification"], "avoidable staleness")
        self.assertAlmostEqual(result["rate"], result["did"])

    def test_did_separates_harder_task_from_staleness(self):
        import staleness as stl
        base = stl.pool([stl.paired(self.errors(0.20, seed=1), self.errors(0.25, seed=2))])
        # Every model gets 0.15 worse (the task is harder): the gap is unchanged.
        result = stl.did(stl.paired(self.errors(0.35, seed=5), self.errors(0.40, seed=6)), base)
        self.assertLess(abs(result["did"]), 0.05)
        self.assertGreater(result["task_hardness"], 0.1)
        self.assertEqual(result["classification"], "task harder for all models")

    def test_positive_baseline_gap_is_capped(self):
        import staleness as stl
        # Deployed model already worse than the probe at deployment (stale on arrival).
        base = stl.pool([stl.paired(self.errors(0.45, seed=1), self.errors(0.28, seed=2))])
        self.assertEqual(base["gap"], 0.0)
        self.assertTrue(base["capped"])
        self.assertGreater(base["raw_gap"], 0.1)
        result = stl.did(stl.paired(self.errors(0.45, seed=3), self.errors(0.28, seed=4)), base)
        self.assertEqual(result["classification"], "avoidable staleness")

    def test_baseline_pooling_then_estimates(self):
        import staleness as stl
        st = stl.new_state()
        settings = self.s.replace(probe_baseline_probes=2)
        comp = stl.paired(self.errors(0.2, 500, 1), self.errors(0.25, 500, 2))
        self.assertEqual(stl.record_probe(st, comp, settings, 0)["phase"], "baseline")
        self.assertIsNone(st["baseline"])
        stl.record_probe(st, comp, settings, 1)
        self.assertEqual(st["baseline"]["n"], 1000)
        self.assertEqual(stl.record_probe(st, comp, settings, 2)["phase"], "estimate")
        self.assertIsNotNone(st["last"])

    def test_renewal_marginal_versus_average(self):
        import staleness as stl
        st = stl.new_state()
        self.assertFalse(stl.renewal(st, self.s, 100.0)["available"])
        st["last"] = {"rate": 0.05, "did": 0.05, "se": 0.01}
        stl.accumulate(st, 500, self.s)                      # early in the cycle: average cost is dominated by K
        early = stl.renewal(st, self.s, 100.0)
        self.assertAlmostEqual(early["marginal"], 0.05)
        self.assertFalse(early["due"])
        for _ in range(20):
            stl.accumulate(st, 500, self.s)
        st["last"] = {"rate": 0.2, "did": 0.2, "se": 0.01}   # staleness grows above the running average
        self.assertTrue(stl.renewal(st, self.s, 100.0)["due"])

    def test_value_of_information_scheduling(self):
        import staleness as stl
        self.assertGreaterEqual(stl.evpi(-5.0, 1.0), 0.0)
        self.assertGreater(stl.evpi(0.0, 10.0), stl.evpi(-50.0, 10.0))
        st = stl.new_state()
        value = {"horizon": 5000, "costs": {"partial": 50.0, "full": 150.0}, "ratios": {"partial": 0.5, "full": 0.9}}
        kw = dict(alarm=False, cost=1.0, monitoring_spent=0.0, run_room=1000.0, value=value)
        self.assertTrue(stl.schedule(st, 0, self.s, labels=500, **kw)["probe"])          # baseline
        self.assertFalse(stl.schedule(st, 0, self.s, labels=10, **kw)["probe"])          # too few labels
        self.assertFalse(stl.schedule(st, 0, self.s, labels=500, **{**kw, "monitoring_spent": 300.0})["probe"])
        st.update(baseline={"gap": 0.0}, last_probe_batch=5, last={"did": -0.2, "se": 0.001, "deployed_error": 0.1})
        far = stl.schedule(st, 6, self.s, labels=500, **kw)
        self.assertFalse(far["probe"])                                                  # clearly not worth acting
        self.assertLess(far["voi"], 1.0)
        st["last"] = {"did": 0.012, "se": 0.01, "deployed_error": 0.1}                  # near the act/keep threshold
        self.assertTrue(stl.schedule(st, 6, self.s, labels=500, **kw)["probe"])
        # The deployed model's own error jumped since the last probe: worth probing even from far below.
        st["last"] = {"did": -0.2, "se": 0.001, "deployed_error": 0.1}
        self.assertTrue(stl.schedule(st, 6, self.s, labels=500, deployed_error=0.6, **kw)["probe"])
        self.assertTrue(stl.schedule(st, 11, self.s, labels=500, **{**kw, "cost": 1e9, "run_room": 1e10,
                                                                     "monitoring_spent": -1e9})["probe"])  # max interval
        fixed = self.s.replace(probe_mode="fixed", probe_every=3)
        self.assertFalse(stl.schedule(st, 7, fixed, labels=500, **kw)["probe"])
        self.assertTrue(stl.schedule(st, 8, fixed, labels=500, **kw)["probe"])

    def test_recovery_ratio_learning(self):
        import staleness as stl
        self.assertAlmostEqual(stl.recovery_ratio([], "partial", self.s)["ratio"], 0.5)
        outcomes = [{"action": "partial", "avoidable": 0.10, "realized_reduction": 0.02}] * 4
        learned = stl.recovery_ratio(outcomes, "partial", self.s)
        self.assertEqual(learned["observations"], 4)
        self.assertAlmostEqual(learned["ratio"], (2 * 0.5 + 4 * 0.2) / 6)
        self.assertEqual(stl.recovery_ratio(outcomes, "full", self.s)["observations"], 0)

    def test_ranking_uses_avoidable_error_and_recovery_ratio(self):
        evidence = {"full": ev(reduction=0.05), "partial": ev(reduction=0.03)}
        context = ctx(avoidable={"available": True, "rate": 0.08, "se": 0.01, "did": 0.08, "ci": [0.06, 0.1],
                                 "task_hardness": 0.0},
                      recovery={"partial": {"ratio": 0.5}, "full": {"ratio": 0.9}},
                      renewal={"available": True, "marginal": 0.08, "average": 0.02, "due": True})
        out = rank_actions(evidence, context, self.s)
        full = next(r for r in out["ranked"] if r["action"] == "full")
        self.assertEqual(full["basis"], "avoidable")
        self.assertAlmostEqual(full["expected_reduction"], 0.08 * 0.9)
        self.assertAlmostEqual(full["benefit"], 0.08 * 0.9 * 5000 * self.s.error_value)
        # When the renewal rule says "not yet due", updates are blocked and keeping the model wins.
        context["renewal"] = {"available": True, "marginal": 0.01, "average": 0.05, "due": False}
        self.assertEqual(rank_actions(evidence, context, self.s)["recommended"], "defer")

    def test_pipeline_records_probes_and_costs(self):
        tmp = Path(tempfile.mkdtemp(prefix="rw_probe_"))
        try:
            life = Lifecycle(Database(tmp / "t.db"), tmp)
            life.save_settings(Settings(**FAST, cooldown_batches=1, min_confidence=0.6))
            run = life.start_run("synthetic", "small", 3)
            for _ in range(8):
                r = life.run(run["id"])
                life.process_batch(r["id"], r["position"])
            probes = life.db.query("SELECT phase, cost, n FROM probes WHERE run_id=?", (run["id"],))
            self.assertGreaterEqual(len(probes), 2)
            # The baseline gap was measured at deployment on the initial hold-out, so probes estimate straight away.
            self.assertEqual(probes[0]["phase"], "estimate")
            state = life.run(run["id"])["monitor_state"]["monitor"]["staleness"]
            self.assertEqual(state["baseline"]["source"], "deployment hold-out")
            costs = life.db.query("SELECT SUM(amount) AS total FROM cost_records WHERE run_id=? AND kind='probe'",
                                  (run["id"],))[0]["total"]
            self.assertAlmostEqual(costs, sum(p["cost"] for p in probes))
            self.assertAlmostEqual(life.run(run["id"])["spent"], costs)
            d = life.evaluate(run["id"])
            self.assertTrue(d["context"]["avoidable"]["available"])
            self.assertIn("renewal rule (marginal >= average)",
                          [g["name"] for r in d["ranked"] if r["action"] == "full" for g in r["guardrails"]])
        finally:
            pipeline._FRAMES.clear()
            pipeline._MODELS.clear()
            shutil.rmtree(tmp, ignore_errors=True)


# ------------------------------------------------------------- training jobs
class TrainingTests(TempDirCase):
    """"Train model": real worker training, exact metrics, approval-gated promotion."""

    def setUp(self):
        super().setUp()
        self.db = Database(self.dir / "t.db")
        self.life = Lifecycle(self.db, self.dir)
        self.life.save_settings(Settings(**FAST, cooldown_batches=1, min_confidence=0.6))
        self.cfg = {"scope": "stream", "dataset": "synthetic", "size": "small", "seed": 5, "initial_window": 800,
                    "validation_fraction": 0.25, "model": {"type": "sgd_logistic", "epochs": 4},
                    "preprocessing": {"scale": True}}

    def submit(self, cfg=None, incumbent=None):
        return jobs.submit(self.db, {"config": cfg or self.cfg, "settings": self.life.settings().to_dict(),
                                     "incumbent_version": incumbent}, actor="ops@example.com", kind="training",
                           root=self.dir, launch=False)

    def test_exact_metrics(self):
        import training
        m = training.exact_metrics(["a", "a", "b", "b"], ["a", "b", "b", "b"], ["a", "b"])
        self.assertEqual(m["accuracy"], 0.75)
        self.assertEqual(m["confusion_matrix"], [[1, 1], [0, 2]])
        self.assertAlmostEqual(m["per_class"][1]["precision"], 2 / 3)
        self.assertEqual(m["error_rate"], 0.25)

    def test_stream_training_job_registers_candidate_and_promotes_with_approval(self):
        job, created = self.submit()
        self.assertTrue(created)
        self.assertEqual(self.submit()[0], job)                      # duplicate request -> same job
        self.assertEqual(worker.run(job, self.db.path), "completed")
        stages = [r["message"] for r in self.db.query(
            "SELECT message FROM job_logs WHERE job_id=? AND level='stage' ORDER BY id", (job,))]
        self.assertEqual(stages, ["queued", "preparing data", "preprocessing", "training", "validating", "registering",
                                  "completed"])
        result = json.loads(self.db.one("SELECT result FROM jobs WHERE id=?", (job,))["result"])
        version = result["version"]
        row = self.db.one("SELECT status, metadata FROM models WHERE version=?", (version,))
        self.assertEqual(row["status"], "candidate")
        meta = json.loads(row["metadata"])
        m = meta["evaluation"]["metrics"]
        self.assertEqual(m["n"], 200)
        self.assertEqual(m["correct"] / m["n"], m["accuracy"])        # exact, not rounded
        self.assertEqual(sum(map(sum, m["confusion_matrix"])), 200)
        self.assertEqual(meta["evaluation"]["train_interval"], [0, 600])
        self.assertEqual(meta["evaluation"]["validation_interval"], [600, 800])
        self.assertIsNone(self.life.active_run())                     # production unchanged
        with self.assertRaises(PermissionError):
            self.life.promote_candidate(version, "approver@example.com", "approver", approved=False)
        self.assertTrue(meta["gate"]["passed"], meta["gate"])
        if meta["gate"]["passed"]:
            out = self.life.promote_candidate(version, "approver@example.com", "approver", approved=True)
            run = self.life.active_run()
            self.assertEqual(run["active_version"], version)
            self.assertEqual(run["position"], 800)
            self.life.process_batch(run["id"], run["position"])       # the promoted model serves the stream
            self.assertEqual(out["status"], "promoted")
        with self.assertRaises(Exception):                            # audit events are immutable
            with self.db.transaction() as c:
                c.execute("UPDATE events SET kind='x'")

    def test_cancelled_job_registers_nothing(self):
        job, _ = self.submit({**self.cfg, "seed": 9})
        jobs.cancel(self.db, job)
        self.assertEqual(worker.run(job, self.db.path), "cancelled")
        self.assertEqual(self.db.query("SELECT COUNT(*) AS n FROM models")[0]["n"], 0)

    def test_run_scope_compares_with_the_active_model(self):
        run = self.life.start_run("synthetic", "small", 3)
        for _ in range(6):
            r = self.life.run(run["id"])
            self.life.process_batch(r["id"], r["position"])
        cfg = {"scope": "run", "run_id": run["id"], "train_window": 1500, "seed": 3, "validation_fraction": 0.3,
               "model": {"type": "random_forest", "n_estimators": 20}}
        job, _ = self.submit(cfg, incumbent=run["active_version"])
        self.assertEqual(worker.run(job, self.db.path), "completed")
        version = json.loads(self.db.one("SELECT result FROM jobs WHERE id=?", (job,))["result"])["version"]
        meta = json.loads(self.db.one("SELECT metadata FROM models WHERE version=?", (version,))["metadata"])
        parent = meta["evaluation"]["parent"]
        self.assertEqual(parent["version"], run["active_version"])
        self.assertAlmostEqual(parent["accuracy_change"],
                               meta["evaluation"]["metrics"]["accuracy"] - parent["metrics"]["accuracy"])
        out = self.life.review_candidate(version, "reject", "approver@example.com", "approver", "not convincing")
        self.assertEqual(out["status"], "rejected")
        with self.assertRaises(LifecycleError):
            self.life.promote_candidate(version, "approver@example.com", "approver", approved=True)

    def test_invalid_training_configuration(self):
        for bad in ({"dataset": "nope"}, {"model": {"type": "xgboost"}}, {"initial_window": 10},
                    {"validation_fraction": 0.9}, {"preprocessing": {"numeric_impute": "zero"}}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.submit({**self.cfg, **bad})


# ------------------------------------------------------------------- web bridge
class BridgeTests(TempDirCase):
    """The JSON bridge used by the Next.js app: allow-listed commands, argument
    validation, error kinds, and the full approve -> validate -> promote path."""

    def setUp(self):
        super().setUp()
        import bridge
        self.bridge = bridge
        self.life = Lifecycle(Database(self.dir / "t.db"), self.dir)
        self.life.save_settings(Settings(**FAST, cooldown_batches=1, min_confidence=0.6))
        self._old, bridge._LIFE = bridge._LIFE, self.life

    def tearDown(self):
        self.bridge._LIFE = self._old
        super().tearDown()

    def call(self, command, **args):
        return self.bridge.handle(command, args)

    def test_unknown_command_and_bad_arguments_are_rejected(self):
        self.assertEqual(self.call("drop_tables")["kind"], "invalid")
        self.assertEqual(self.call("start_run", dataset="synthetic", size="small", seed=-1)["kind"], "invalid")
        self.assertEqual(self.call("start_run", dataset="../etc", size="small", seed=1)["kind"], "invalid")
        self.assertEqual(self.call("evaluate", run_id="x; DROP")["kind"], "invalid")
        self.assertEqual(self.bridge.handle("ping", ["not", "an", "object"])["kind"], "invalid")

    def test_execute_requires_explicit_approval(self):
        r = self.call("execute", decision_id="abc", action="full", approver="me")
        self.assertEqual(r["kind"], "forbidden")
        r = self.call("rollback", version=1, approver="me", approved=False)
        self.assertEqual(r["kind"], "forbidden")

    def test_full_lifecycle_through_bridge(self):
        started = self.call("start_run", dataset="synthetic", size="small", seed=3)
        self.assertTrue(started["ok"], started)
        run_id = started["result"]["id"]
        out = self.call("process_batches", run_id=run_id, expected_position=500, count=8)["result"]
        self.assertEqual(len(out["processed"]), 8)
        # A duplicate request for an old position is a no-op, not a second batch.
        self.assertTrue(self.call("process_batches", run_id=run_id, expected_position=500, count=1)["result"]["noop"])
        decision = self.call("evaluate", run_id=run_id)["result"]
        again = self.call("evaluate", run_id=run_id)["result"]
        self.assertEqual(decision["id"], again["id"])          # evaluation charged once
        d = self.life.decision(decision["id"])
        action = next(r["action"] for r in d["ranked"] if r["action"] != "defer" and r["evidence"].get("compatible"))
        what = self.call("what_if", decision_id=decision["id"], error_value_multiplier=0.1, horizon_multiplier=0.1,
                         regime="expensive")["result"]
        self.assertEqual(what["recommended"], "defer")       # tiny value, expensive regime: never worth it
        result = self.call("execute", decision_id=decision["id"], action=action, approver="tester", approved=True)
        self.assertTrue(result["ok"], result)
        self.assertIn(result["result"]["status"], ("promoted", "rejected"))
        dup = self.call("execute", decision_id=decision["id"], action=action, approver="tester", approved=True)
        self.assertEqual(dup["kind"], "conflict")
        report = self.call("explain", decision_id=decision["id"], mode="deterministic")["result"]
        self.assertEqual(report["status"], "completed")
        self.assertGreaterEqual(self.life.db.one("SELECT COUNT(*) AS n FROM agent_tool_calls WHERE report_id=?",
                                                 (report["report_id"],))["n"], 4)

    def test_settings_validation_errors_are_reported(self):
        bad = {**Settings().to_dict(), "batch_size": 1}
        self.assertEqual(self.call("save_settings", settings=bad)["kind"], "invalid")
        self.assertEqual(self.call("save_settings", settings={"unknown": 1})["kind"], "invalid")
        ok = self.call("save_settings", settings={**Settings().to_dict(), "budget": 1234.0})
        self.assertTrue(ok["ok"], ok)
        self.assertEqual(self.life.settings().budget, 1234.0)

    def test_serve_protocol_round_trip(self):
        import io
        stdin = io.StringIO('{"id": 1, "command": "catalog", "args": {}}\nnot json\n')
        stdout = io.StringIO()
        with mock.patch.object(self.bridge.sys, "stdin", stdin), mock.patch.object(self.bridge.sys, "stdout", stdout):
            self.bridge.serve()
        lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertTrue(lines[0]["ready"])
        self.assertEqual(lines[1]["id"], 1)
        self.assertIn("retrainwise", lines[1]["result"]["policies"])
        self.assertEqual(lines[2]["kind"], "invalid")


if __name__ == "__main__":
    unittest.main(verbosity=2)
