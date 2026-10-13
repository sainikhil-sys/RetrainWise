"""Application lifecycle (L1 -> L2 -> L4) backed by SQLite.

Guarantees
* Approval and enforcement live here, in deterministic code. The agent layer
  can only *prepare* a request; ``execute`` requires explicit human approval
  unless bounded autonomy is switched on, and then its limits are enforced.
* Idempotency: batch processing is keyed by the expected stream position,
  decisions by (run, position, version, settings hash), and every decision can
  be approved at most once (UNIQUE constraint), so repeated web requests and double
  clicks cannot repeat work.
* Only artifacts registered in SQLite with a matching SHA-256 are loaded.
"""
from __future__ import annotations

import hashlib
import shutil
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from config import ROOT, Settings, safe_child
from database import Database, dumps, loads, now
from datasets import frame_sha256, load
from economics import (action_costs, cost_trace, justification, rank_actions, realization_factor,
                       sensitivity)
from experiments import label_mask
from models import (initial_model, load_artifact, save_artifact, shadow_evaluate, validation_gate)
from monitoring import (classification_metrics, drift_status, evaluation_trigger, new_monitor, psi,
                        psi_summary, update_with_labels)
from preprocessing import align, unseen_category_rate
from staleness import deployment_baseline, monitoring_step, new_state, recovery_ratio, renewal

_FRAMES: dict = {}
_MODELS: dict = {}


class LifecycleError(ValueError):
    """A request that the lifecycle rules refuse (stale, duplicate, unapproved...)."""


def _hash_settings(settings: Settings) -> str:
    return hashlib.sha256(dumps(settings.to_dict()).encode()).hexdigest()[:16]


def _parse_run(row) -> dict | None:
    if row is None:
        return None
    run = dict(row)
    run["monitor_state"] = loads(run["monitor_state"])
    run["settings"] = loads(run["settings"])
    return run


class Lifecycle:
    def __init__(self, db: Database | None = None, root: Path = ROOT):
        self.root = Path(root)
        self.db = db or Database(self.root / "retrainwise.db")

    # ------------------------------------------------------------- settings
    def settings(self) -> Settings:
        return Settings.from_dict(self.db.get_setting("active", Settings().to_dict()))

    def save_settings(self, settings: Settings, actor: str = "user") -> None:
        settings.validate()
        previous = self.db.get_setting("active", Settings().to_dict())
        changed = {k: v for k, v in settings.to_dict().items() if previous.get(k) != v}
        with self.db.transaction() as c:
            self.db.put_setting("active", settings.to_dict(), c)
            stale = c.execute("UPDATE decisions SET status='stale', resolved=?, outcome='settings changed' "
                              "WHERE status='pending'", (now(),)).rowcount
            self.db.event("settings_saved", {"changed": changed, "stale_decisions": stale}, c, actor=actor)

    # --------------------------------------------------------------- recovery
    def recover(self) -> dict:
        """Mark work that was in flight when the process stopped. Nothing is
        resumed automatically; interrupted executions must be re-requested."""
        with self.db.transaction() as c:
            n = c.execute("UPDATE decisions SET status='interrupted', resolved=?, "
                          "outcome='application stopped during execution; candidate not promoted' "
                          "WHERE status='executing'", (now(),)).rowcount
            if n:
                self.db.event("recovered_interrupted_executions", {"count": n}, c)
        return {"interrupted_executions": n}

    # ------------------------------------------------------------------- data
    def path(self, name: str) -> Path:
        return safe_child(name, self.root)

    def frame(self, run: dict) -> pd.DataFrame:
        key = (run["dataset"], run["size_label"], run["seed"], str(self.root))
        if key not in _FRAMES:
            size = None if run["size_label"] == "full" else run["n_rows"]
            frame = load(run["dataset"], size, run["seed"], self.root)
            if frame_sha256(frame) != run["data_sha256"]:
                raise LifecycleError("Cached dataset differs from the one this run started with; start a new run")
            _FRAMES.clear()
            _FRAMES[key] = frame
        return _FRAMES[key]

    def model(self, version: int):
        row = self.db.one("SELECT artifact, sha256 FROM models WHERE version=?", (int(version),))
        if not row or not row["artifact"]:
            raise LifecycleError(f"Model v{version:03d} has no artifact")
        key = (int(version), row["sha256"])
        if key not in _MODELS:
            if len(_MODELS) > 6:
                _MODELS.clear()
            _MODELS[key] = load_artifact(self.path(row["artifact"]), row["sha256"])[0]
        return _MODELS[key]

    def active_run(self) -> dict | None:
        return _parse_run(self.db.one("SELECT * FROM runs WHERE status='active' ORDER BY created DESC LIMIT 1"))

    def run(self, run_id: str) -> dict | None:
        return _parse_run(self.db.one("SELECT * FROM runs WHERE id=?", (run_id,)))

    # ------------------------------------------------------------- start run
    def start_run(self, dataset: str, size: str = "standard", seed: int | None = None,
                  actor: str = "user") -> dict:
        settings = self.settings()
        if seed is not None:
            settings = settings.replace(seed=int(seed))
        frame = load(dataset, size, settings.seed, self.root)
        if len(frame) < settings.initial_size + settings.batch_size:
            raise LifecycleError("Stream too short for the initial window plus one batch")
        model, ref = initial_model(frame, settings)
        run_id = uuid.uuid4().hex[:10]
        monitor = new_monitor(settings, ref["reference_error"], ref["reference_n"], model.psi_reference,
                              ref.get("probe_baseline"))
        state = {"monitor": monitor, "post_update": None, "outcomes": [], "last_telemetry": None}
        with self.db.transaction() as c:
            c.execute("UPDATE runs SET status='closed', updated=? WHERE status='active'", (now(),))
            c.execute("UPDATE decisions SET status='stale', resolved=?, outcome='run closed' WHERE status='pending'",
                      (now(),))
            c.execute("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (run_id, now(), now(), dataset, size, len(frame), settings.seed, frame_sha256(frame),
                       "active", settings.initial_size, 0, 0, 0, 0.0, 0.0, 0, None, dumps(state),
                       dumps(settings.to_dict())))
            version = self._register(c, run_id, model, "initial", None, {
                "reference_error": ref["reference_error"], "reference_method": ref["method"],
                "settings": settings.to_dict(), "dataset": dataset, "size": size})
            c.execute("UPDATE runs SET active_version=? WHERE id=?", (version, run_id))
            self.db.event("run_started", {"dataset": dataset, "size": size, "rows": len(frame),
                                          "seed": settings.seed, "version": version,
                                          "reference_error": ref["reference_error"]}, c, run_id, actor)
        self.db.put_setting("active", settings.to_dict())
        return self.run(run_id)

    def _register(self, c, run_id: str, model, action: str, parent: int | None, metadata: dict,
                  source: Path | None = None) -> int:
        """Insert a registry row and write ``model_vNNN.joblib`` (inside the transaction)."""
        cur = c.execute("INSERT INTO models(run_id,created,artifact,sha256,parent_version,action,status,"
                        "train_start,train_end,n_train,seed,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                        (run_id, now(), None, None, parent, action, "active", model.train_start,
                         model.trained_until, model.n_train, model.seed, "{}"))
        version = int(cur.lastrowid)
        name = f"model_v{version:03d}.joblib"
        meta = {**metadata, "version": version, "action": action, "parent_version": parent,
                "model": model.describe(), "created": now()}
        sha = save_artifact(model, self.path(name), meta)
        c.execute("UPDATE models SET artifact=?, sha256=?, metadata=? WHERE version=?",
                  (name, sha, dumps(meta), version))
        if parent is not None:
            c.execute("UPDATE models SET status='archived' WHERE version=? AND status='active'", (parent,))
        return version

    # --------------------------------------------------------- process batch
    def process_batch(self, run_id: str, expected_position: int, actor: str = "user") -> dict:
        """Predict the next batch, reveal due labels, update monitoring.

        A request whose ``expected_position`` no longer matches the run (a
        rerun or a second click) is a no-op and returns ``{"noop": True}``.
        """
        settings = self.settings()
        with self.db.transaction() as c:
            run = _parse_run(c.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone())
            if run is None or run["status"] != "active":
                raise LifecycleError("Run is not active")
            if run["position"] != int(expected_position):
                return {"noop": True, "position": run["position"]}
            frame = self.frame(run)
            start = run["position"]
            if start >= len(frame):
                raise LifecycleError("End of stream reached")
            stop = min(start + settings.batch_size, len(frame))
            b = run["batch_index"]
            version = run["active_version"]
            model = self.model(version)
            batch = frame.iloc[start:stop]
            x = batch.drop(columns="target")
            t0 = time.perf_counter()
            pred = model.predict(x)                                    # 1. predict first
            inference_ms = (time.perf_counter() - t0) * 1000
            mask = label_mask(len(frame), run["seed"], settings.label_fraction)
            c.executemany("INSERT INTO predictions VALUES (?,?,?,?,?,?,?,NULL,NULL)",
                          [(run_id, int(r), b, version, str(p), int(mask[r]), b + settings.label_delay_batches)
                           for r, p in zip(batch.index, pred)])
            due = c.execute("SELECT row, prediction, version FROM predictions WHERE run_id=? AND label_available=1 "
                            "AND revealed_batch IS NULL AND due_batch<=? ORDER BY row", (run_id, b)).fetchall()
            rows = [int(r["row"]) for r in due]                         # 2. reveal eligible labels
            y_rev = frame.loc[rows, "target"].astype(str).to_numpy() if rows else np.array([], str)
            p_rev = np.array([r["prediction"] for r in due], dtype=str)
            errors = (p_rev != y_rev).astype(int)
            c.executemany("UPDATE predictions SET revealed_batch=?, error=? WHERE run_id=? AND row=?",
                          [(b, int(e), run_id, r) for r, e in zip(rows, errors)])
            state = run["monitor_state"]
            monitor = state["monitor"]
            signals = update_with_labels(monitor, errors, settings, rows)
            monitor["predictions_since_update"] += len(batch)
            post = state.get("post_update")
            if post and rows:                                          # post-update counterfactual check
                keep = [r for r in rows if r >= post["from_row"]]
                if keep:
                    old = self.model(post["old_version"]).predict(frame.loc[keep].drop(columns="target"))
                    truth = frame.loc[keep, "target"].astype(str).to_numpy()
                    post["old_errors"] += int(np.sum(old != truth))
                    post["new_errors"] += int(np.sum(p_rev[np.isin(rows, keep)] != truth))
                    post["n"] += len(keep)
                if post["n"] >= settings.post_update_window:
                    outcome = {"decision": post.get("decision"), "version": version,
                               "predicted_reduction": post["predicted"],
                               "realized_reduction": (post["old_errors"] - post["new_errors"]) / post["n"],
                               "n": post["n"], "completed_batch": b, "action": post.get("action"),
                               "avoidable": post.get("avoidable")}
                    if outcome["avoidable"] and outcome["avoidable"] > 0.005:
                        outcome["recovery_ratio"] = outcome["realized_reduction"] / outcome["avoidable"]
                    state["outcomes"].append(outcome)
                    state["post_update"] = None
                    self.db.event("post_update_outcome", outcome, c, run_id)
            psi_values = psi(monitor["psi_reference"], x)
            psi_info = psi_summary(psi_values, settings.psi_threshold)
            status = drift_status(signals, psi_info, monitor, settings)
            trace = cost_trace(settings, b + 1)
            multiplier = float(trace[-1])
            # Probe model + difference-in-differences staleness (staleness.py).
            st = monitor.setdefault("staleness", new_state())
            eligible = [r["row"] for r in c.execute(
                "SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS NOT NULL ORDER BY row", (run_id,))]
            eligible = list(range(run["settings"]["initial_size"])) + eligible
            n_rows = min(len(eligible), settings.train_window)
            update_costs = {a: action_costs(a, settings, n_rows, multiplier)["total"] for a in ("partial", "full")}
            ratios = {a: recovery_ratio(state["outcomes"], a, settings) for a in ("partial", "full")}
            same = [i for i, r in enumerate(due) if r["version"] == version]
            probe_cost = action_costs("probe", settings, settings.probe_window * settings.probe_folds, multiplier)["total"]
            step = monitoring_step(
                st, frame=frame, batch_index=b, n_predictions=len(batch), eval_rows=[rows[i] for i in same],
                deployed_pred=p_rev[same] if same else [], eligible=eligible, settings=settings,
                alarm=bool(signals["adwin_error_increase"] or signals["ddm_status"] == "drift"
                           or status["covariate_signal"]),
                probe_cost=probe_cost, monitoring_spent=state.get("monitoring_spent", 0.0),
                run_room=settings.budget - run["spent"],
                value={"horizon": settings.horizon_predictions, "costs": update_costs,
                       "ratios": {a: r["ratio"] for a, r in ratios.items()}},
                renewal_cost=min(update_costs.values()))
            probe_charge = 0.0
            if step["ran"]:
                probe_charge = probe_cost
                state["monitoring_spent"] = state.get("monitoring_spent", 0.0) + probe_cost
                comp, res = step["comparison"], step["result"]
                c.execute("INSERT INTO probes(run_id,batch_index,version,created,phase,reason,voi,cost,n,train_rows,"
                          "deployed_error,probe_error,gap,gap_se,baseline_gap,did,did_se,task_hardness,classification,"
                          "fit_seconds) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                          (run_id, b, version, now(), res["phase"], step["reason"], step["voi"], probe_cost, comp["n"],
                           comp["train_rows"], comp["deployed_error"], comp["probe_error"], comp["gap"], comp["se"],
                           res.get("baseline_gap"), res.get("did"), res.get("se"), res.get("task_hardness"),
                           res.get("classification"), step["fit_seconds"]))
                c.execute("INSERT INTO cost_records(run_id,batch_index,created,kind,amount,detail) VALUES (?,?,?,?,?,?)",
                          (run_id, b, now(), "probe", probe_cost,
                           dumps({"reason": step["reason"], "voi": step["voi"], "version": version})))
            estimate = step["estimate"]
            metrics = classification_metrics(y_rev, p_rev, labels=model.classes)
            _, issues = align(x, model.schema)
            pending = c.execute("SELECT COUNT(*) FROM predictions WHERE run_id=? AND label_available=1 "
                                "AND revealed_batch IS NULL", (run_id,)).fetchone()[0]
            since_update = b - run["last_update_batch"]
            telemetry = {
                "batch_index": b, "start_row": start, "end_row": stop, "version": version,
                "predicted": len(batch), "labels_revealed": len(rows), "labels_pending": int(pending),
                "label_fraction_setting": settings.label_fraction, **{f"batch_{k}": v for k, v in metrics.items()},
                "rolling_error": signals["rolling_error"], "rolling_error_ci": signals["rolling_error_ci"],
                "rolling_n": signals["rolling_n"], "reference_error": monitor["reference_error"],
                "degradation": signals["degradation"], "adwin_error_increase": signals["adwin_error_increase"],
                "adwin_detections": len(signals["adwin_detections"]), "ddm_status": signals["ddm_status"],
                "change_row": signals["change_row"], "learning_debt": monitor["learning_debt"],
                "learning_debt_cost": monitor["learning_debt"] * settings.error_value,
                "psi": {k: v["psi"] for k, v in psi_values.items()}, "max_psi": psi_info["max_psi"],
                "max_psi_feature": psi_info["max_feature"], "shifted_features": psi_info["shifted"],
                "psi_reliable": psi_info["reliable"], **status,
                "unseen_category_rate": unseen_category_rate(x, model.schema, model.vocabulary),
                "schema_issues": issues, "model_age_batches": since_update,
                "predictions_since_update": monitor["predictions_since_update"],
                "labels_since_update": monitor["labels_since_update"], "inference_ms": inference_ms,
                "price_multiplier": multiplier, "spent": run["spent"] + probe_charge, "created": now(),
                "probe": {k: step.get(k) for k in ("ran", "reason", "voi", "cost", "fit_seconds")}
                | ({"phase": step["result"]["phase"], **step["comparison"]} if step["ran"] else {}),
                "staleness": {"available": bool(estimate), **(estimate or {}),
                              "baseline": step["baseline"], "probes": st["probes"],
                              "baseline_probes": len(st["baseline_parts"])},
                "renewal": step["renewal"], "renewal_due": bool(step["renewal"].get("due")),
                "monitoring_spent": state.get("monitoring_spent", 0.0),
                "recovery": {a: {"ratio": r["ratio"], "observations": r["observations"]} for a, r in ratios.items()},
            }
            fire, reasons = evaluation_trigger(
                monitor, telemetry, settings, since_update + 1, b - run["last_eval_batch"] + 1,
                action_costs("partial", settings, 0, multiplier)["total"])
            telemetry.update(evaluation_suggested=fire, trigger_reasons=reasons)
            state["last_telemetry"] = telemetry
            c.execute("INSERT INTO batches VALUES (?,?,?,?,?,?,?)",
                      (run_id, b, start, stop, version, now(), dumps(telemetry)))
            c.execute("UPDATE runs SET position=?, batch_index=?, monitor_state=?, spent=spent+?, updated=? WHERE id=?",
                      (stop, b + 1, dumps(state), probe_charge, now(), run_id))
            stale = c.execute("UPDATE decisions SET status='stale', resolved=?, outcome='stream advanced' "
                              "WHERE run_id=? AND status='pending'", (now(), run_id)).rowcount
            self.db.event("batch_processed", {"batch": b, "rows": [start, stop], "status": status["status"],
                                              "labels": len(rows), "stale_decisions": stale,
                                              "probe": step["reason"] if step["ran"] else None,
                                              "avoidable": estimate["did"] if estimate else None}, c, run_id, actor)
        if settings.autonomy:
            telemetry["autonomy"] = self.autonomous_step(run_id)
        return telemetry

    # --------------------------------------------------------------- evaluate
    def evaluate(self, run_id: str, actor: str = "user") -> dict:
        """Shadow-evaluate full and partial candidates and rank all actions.

        Repeated requests for the same (run, position, version, settings)
        return the stored decision and are never charged twice.
        """
        settings = self.settings()
        run = self.run(run_id)
        if run is None or run["status"] != "active":
            raise LifecycleError("Run is not active")
        key = hashlib.sha256(f"{run_id}|{run['position']}|{run['active_version']}|{_hash_settings(settings)}"
                             .encode()).hexdigest()[:16]
        existing = self.db.one("SELECT payload FROM decisions WHERE id=?", (key,))
        if existing:
            return loads(existing["payload"])
        state, frame = run["monitor_state"], self.frame(run)
        monitor = state["monitor"]
        b = run["batch_index"]
        trace = cost_trace(settings, max(b, 1))
        multiplier = float(trace[max(b - 1, 0)])
        eligible = [r["row"] for r in self.db.query(
            "SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS NOT NULL ORDER BY row", (run_id,))]
        eligible = list(range(run["settings"]["initial_size"])) + eligible
        eval_cost = action_costs("evaluation", settings, min(len(eligible), settings.train_window), multiplier)
        telemetry = state.get("last_telemetry") or {}
        incumbent = self.model(run["active_version"])
        reasons = telemetry.get("trigger_reasons", [])
        charged, shadow, note = False, None, None
        if monitor["labels_since_update"] < settings.min_evidence:
            note = f"only {monitor['labels_since_update']} new labels since the last update (minimum {settings.min_evidence})"
        elif run["spent"] + eval_cost["total"] > settings.budget:
            note = "evaluation overhead would exceed the cumulative budget"
        else:
            shadow = shadow_evaluate(frame, np.asarray(eligible), incumbent, settings, monitor.get("change_row"))
            charged = True
        evidence = shadow["evidence"] if shadow else {a: {"compatible": False, "n": 0, "reason": note}
                                                      for a in ("full", "partial")}
        st = monitor.get("staleness") or new_state()
        n_rows = min(len(eligible), settings.train_window)
        renew_cost = min(action_costs(a, settings, n_rows, multiplier)["total"] for a in ("partial", "full"))
        estimate = st.get("last")
        context = {"spent": run["spent"] + (eval_cost["total"] if charged else 0.0),
                   "batches_since_update": b - run["last_update_batch"], "horizon": settings.horizon_predictions,
                   "price_multiplier": multiplier, "batch_index": b,
                   "realization": realization_factor(state["outcomes"], settings),
                   "avoidable": {**estimate, "available": True} if estimate else
                   {"available": False, "baseline_probes": len(st.get("baseline_parts", [])),
                    "reason": "no difference-in-differences estimate for this model version yet"},
                   "recovery": {a: recovery_ratio(state["outcomes"], a, settings) for a in ("partial", "full")},
                   "renewal": renewal(st, settings, renew_cost)}
        ranking = rank_actions(evidence, context, settings)
        candidates = {}
        if shadow:
            for action, candidate in shadow["candidates"].items():
                name = f"candidate_{key}_{action}.joblib"
                sha = save_artifact(candidate, self.path(name), {"decision": key, "action": action})
                candidates[action] = {"artifact": name, "sha256": sha}
        decision = {
            "id": key, "run_id": run_id, "dataset": run["dataset"], "position": run["position"],
            "batch_index": b, "version": run["active_version"], "created": now(), "requested_by": actor,
            "settings_hash": _hash_settings(settings), "trigger_reasons": reasons or ["manual request"],
            "monitoring": {k: telemetry.get(k) for k in (
                "status", "rolling_error", "rolling_error_ci", "reference_error", "degradation",
                "adwin_error_increase", "ddm_status", "learning_debt", "learning_debt_cost", "max_psi",
                "max_psi_feature", "shifted_features", "labels_since_update", "model_age_batches", "change_row",
                "staleness", "renewal", "monitoring_spent")},
            "probe_history": self.db.query(
                "SELECT batch_index, phase, n, deployed_error, probe_error, gap, did, did_se, task_hardness, "
                "classification, cost FROM probes WHERE run_id=? AND version=? ORDER BY id DESC LIMIT 8",
                (run_id, run["active_version"])),
            "evaluation": {"charged": charged, "cost": eval_cost if charged else None, "note": note,
                           "plan": shadow["plan"] if shadow else None},
            "candidates": candidates, **ranking,
            "sensitivity": sensitivity(evidence, context, settings),
        }
        decision["justification"] = justification(decision)
        with self.db.transaction() as c:
            again = c.execute("SELECT payload FROM decisions WHERE id=?", (key,)).fetchone()
            if again:                                   # a concurrent click won the race
                return loads(again["payload"])
            current = _parse_run(c.execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone())
            if (current["position"], current["active_version"]) != (run["position"], run["active_version"]):
                self._cleanup_candidates(key)
                raise LifecycleError("The stream changed during evaluation; evaluate again")
            if charged:
                c.execute("UPDATE runs SET spent=spent+?, evaluation_spent=evaluation_spent+?, last_eval_batch=?, "
                          "updated=? WHERE id=?", (eval_cost["total"], eval_cost["total"], b, now(), run_id))
                c.execute("INSERT INTO cost_records(run_id,batch_index,created,kind,amount,detail) VALUES (?,?,?,?,?,?)",
                          (run_id, b, now(), "evaluation", eval_cost["total"], dumps({"decision": key})))
                st = current["monitor_state"]
                st["monitor"]["labels_since_evaluation"] = 0
                c.execute("UPDATE runs SET monitor_state=? WHERE id=?", (dumps(st), run_id))
            c.execute("INSERT INTO decisions VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL)",
                      (key, run_id, now(), run["position"], b, run["active_version"], ranking["recommended"],
                       "pending", dumps(decision)))
            self.db.event("decision_created", {"decision": key, "recommended": ranking["recommended"],
                                               "evaluation_charged": eval_cost["total"] if charged else 0.0,
                                               "nets": {r["action"]: r["net_value"] for r in ranking["ranked"]}},
                          c, run_id, actor)
        return decision

    def decision(self, decision_id: str) -> dict | None:
        row = self.db.one("SELECT * FROM decisions WHERE id=?", (decision_id,))
        if not row:
            return None
        payload = loads(row["payload"])
        payload.update(status=row["status"], outcome=row["outcome"], resolved=row["resolved"])
        return payload

    def latest_decision(self, run_id: str | None = None) -> dict | None:
        sql = "SELECT id FROM decisions " + ("WHERE run_id=? " if run_id else "") + "ORDER BY created DESC, rowid DESC LIMIT 1"
        row = self.db.one(sql, (run_id,) if run_id else ())
        return self.decision(row["id"]) if row else None

    # ---------------------------------------------------------------- execute
    def execute(self, decision_id: str, action: str, actor: str, approved: bool = False,
                mode: str = "manual", request_id: int | None = None) -> dict:
        """Approve and carry out one action for one decision.

        Order: approval/limits -> guardrail re-check -> artifact integrity ->
        chronological validation gate -> promotion. Any failure is recorded.
        """
        if action not in ("defer", "partial", "full"):
            raise LifecycleError("Unknown action")
        if mode not in ("manual", "autonomous"):
            raise LifecycleError("Unknown execution mode")
        if not isinstance(actor, str) or not actor.strip():
            raise LifecycleError("An approver name is required")
        settings = self.settings()
        with self.db.transaction() as c:
            row = c.execute("SELECT * FROM decisions WHERE id=?", (decision_id,)).fetchone()
            if row is None:
                raise LifecycleError("Unknown decision")
            if row["status"] != "pending":
                raise LifecycleError(f"Decision already {row['status']}; it cannot be executed again")
            decision = loads(row["payload"])
            run = _parse_run(c.execute("SELECT * FROM runs WHERE id=?", (row["run_id"],)).fetchone())
            if run["status"] != "active" or (run["position"], run["active_version"]) != (row["position"], row["version"]):
                c.execute("UPDATE decisions SET status='stale', resolved=?, outcome='state changed' WHERE id=?",
                          (now(), decision_id))
                raise LifecycleError("Decision is stale: the stream or model changed after it was made")
            if decision["settings_hash"] != _hash_settings(settings):
                c.execute("UPDATE decisions SET status='stale', resolved=?, outcome='settings changed' WHERE id=?",
                          (now(), decision_id))
                raise LifecycleError("Decision is stale: settings changed after it was made")
            choice = next(r for r in decision["ranked"] if r["action"] == action)
            if mode == "manual" and not approved:
                raise PermissionError("Explicit approval is required before execution")
            if mode == "autonomous":
                if not settings.autonomy:
                    raise PermissionError("Bounded autonomy is disabled")
                if run["autonomous_actions"] >= settings.autonomy_max_actions:
                    raise PermissionError("Autonomous action limit reached for this run")
                if choice["total_cost"] > settings.autonomy_max_cost:
                    raise PermissionError("Action cost exceeds the autonomous spending limit")
            try:
                c.execute("INSERT INTO approvals(decision_id,action,actor,mode,created) VALUES (?,?,?,?,?)",
                          (decision_id, action, actor.strip()[:80], mode, now()))
            except sqlite3.IntegrityError:
                raise LifecycleError("This decision already has an approval; duplicate execution prevented")
            c.execute("UPDATE decisions SET status='executing' WHERE id=?", (decision_id,))
            if request_id is not None:
                c.execute("UPDATE execution_requests SET status='approved' WHERE id=? AND decision_id=?",
                          (int(request_id), decision_id))
            self.db.event("approval", {"decision": decision_id, "action": action, "mode": mode,
                                       "agent_request": request_id}, c, run["id"], actor)
        try:
            return self._carry_out(decision, choice, run, settings, actor, mode)
        except Exception as exc:
            self._resolve(decision_id, "failed", f"execution error: {exc}", run["id"], actor)
            raise

    def _resolve(self, decision_id: str, status: str, outcome: str, run_id: str, actor: str,
                 detail: dict | None = None) -> dict:
        with self.db.transaction() as c:
            c.execute("UPDATE decisions SET status=?, resolved=?, outcome=? WHERE id=?",
                      (status, now(), outcome, decision_id))
            c.execute("UPDATE approvals SET outcome=?, detail=? WHERE decision_id=?",
                      (status, dumps(detail or {}), decision_id))
            self.db.event(f"decision_{status}", {"decision": decision_id, "outcome": outcome, **(detail or {})},
                          c, run_id, actor)
        self._cleanup_candidates(decision_id)
        return {"status": status, "outcome": outcome, **(detail or {})}

    def _carry_out(self, decision: dict, choice: dict, run: dict, settings: Settings, actor: str,
                   mode: str) -> dict:
        did = decision["id"]
        if choice["action"] == "defer":
            return self._resolve(did, "deferred", "approved to keep the current model", run["id"], actor)
        # Guardrails are re-checked deterministically with the stored evidence.
        context = dict(decision["context"])
        context.update(spent=run["spent"], batches_since_update=run["batch_index"] - run["last_update_batch"])
        current = next(r for r in rank_actions({a: next(x["evidence"] for x in decision["ranked"] if x["action"] == a)
                                                for a in ("partial", "full")}, context, settings)["ranked"]
                       if r["action"] == choice["action"])
        failed = [g for g in current["guardrails"] if not g["passed"]]
        if failed:
            return self._resolve(did, "rejected", "blocked by guardrails: " + ", ".join(g["name"] for g in failed),
                                 run["id"], actor, {"guardrails": failed})
        info = decision["candidates"].get(choice["action"])
        if not info:
            return self._resolve(did, "rejected", "no candidate artifact", run["id"], actor)
        candidate, _ = load_artifact(self.path(info["artifact"]), info["sha256"])
        # Recompute the chronological hold-out comparison from stored data.
        frame = self.frame(run)
        ev = choice["evidence"]
        lo, hi = ev["holdout_interval"]
        holdout_rows = [r["row"] for r in self.db.query(
            "SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS NOT NULL AND row>=? AND row<? "
            "ORDER BY row", (run["id"], lo, hi))]
        holdout = frame.loc[holdout_rows]
        truth = holdout["target"].astype(str).to_numpy()
        inc_pred = self.model(run["active_version"]).predict(holdout.drop(columns="target"))
        cand_pred = candidate.predict(holdout.drop(columns="target"))
        inc_m, cand_m = classification_metrics(truth, inc_pred), classification_metrics(truth, cand_pred)
        rechecked = {**ev, "n": len(holdout_rows), "incumbent_error": inc_m["error"], "candidate_error": cand_m["error"],
                     "incumbent_f1": inc_m["f1"], "candidate_f1": cand_m["f1"],
                     "reduction": inc_m["error"] - cand_m["error"]}
        gate = validation_gate(rechecked, settings)
        history = [r["row"] for r in self.db.query(
            "SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS NOT NULL AND row<? ORDER BY row",
            (run["id"], lo))]
        history = list(range(run["settings"]["initial_size"])) + history
        probe_baseline = deployment_baseline(frame, history, holdout_rows, cand_pred, settings) if gate["passed"] else None
        if not gate["passed"]:
            with self.db.transaction() as c:
                c.execute("INSERT INTO models(run_id,created,artifact,sha256,parent_version,action,status,train_start,"
                          "train_end,n_train,seed,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                          (run["id"], now(), None, None, run["active_version"], choice["action"], "rejected",
                           candidate.train_start, candidate.trained_until, candidate.n_train, candidate.seed,
                           dumps({"decision": did, "validation": gate, "evidence": rechecked})))
            return self._resolve(did, "rejected", "validation gate failed", run["id"], actor, {"validation": gate})
        with self.db.transaction() as c:
            live = _parse_run(c.execute("SELECT * FROM runs WHERE id=?", (run["id"],)).fetchone())
            if (live["position"], live["active_version"]) != (run["position"], run["active_version"]):
                raise LifecycleError("Run changed during execution")
            version = self._register(c, run["id"], candidate, choice["action"], run["active_version"], {
                "decision": did, "approved_by": actor, "mode": mode, "validation": gate, "evidence": rechecked,
                "simulated_cost": choice["costs"], "reference_error": rechecked["candidate_error"],
                "settings": settings.to_dict(), "dataset": run["dataset"]})
            state = live["monitor_state"]
            state["monitor"] = new_monitor(settings, rechecked["candidate_error"], rechecked["n"],
                                           candidate.psi_reference, probe_baseline)
            avoid = (decision.get("context") or {}).get("avoidable") or {}
            state["post_update"] = {"old_version": run["active_version"], "from_row": run["position"],
                                    "predicted": rechecked["reduction"], "decision": did,
                                    "old_errors": 0, "new_errors": 0, "n": 0, "action": choice["action"],
                                    "avoidable": avoid.get("rate") if avoid.get("available") else None}
            c.execute("INSERT INTO cost_records(run_id,batch_index,created,kind,amount,detail) VALUES (?,?,?,?,?,?)",
                      (run["id"], run["batch_index"], now(), choice["action"], current["total_cost"],
                       dumps({"decision": did, "items": {k: current["costs"][k] for k in
                                                         ("compute", "engineering", "validation", "deployment_risk",
                                                          "probe")}})))
            c.execute("UPDATE runs SET active_version=?, spent=spent+?, last_update_batch=?, autonomous_actions="
                      "autonomous_actions+?, monitor_state=?, updated=? WHERE id=?",
                      (version, current["total_cost"], run["batch_index"], int(mode == "autonomous"),
                       dumps(state), now(), run["id"]))
        return self._resolve(did, "promoted", f"promoted as v{version:03d}", run["id"], actor,
                             {"version": version, "validation": gate, "cost": current["total_cost"]})

    def _cleanup_candidates(self, decision_id: str) -> None:
        for action in ("full", "partial"):
            try:
                self.path(f"candidate_{decision_id}_{action}.joblib").unlink(missing_ok=True)
            except OSError:
                pass

    # --------------------------------------------------------------- rollback
    def rollback(self, version: int, actor: str, approved: bool = False, reason: str = "") -> dict:
        if not approved:
            raise PermissionError("Rollback requires explicit approval")
        if not actor or not actor.strip():
            raise LifecycleError("An approver name is required")
        settings = self.settings()
        run = self.active_run()
        if run is None:
            raise LifecycleError("No active run")
        row = self.db.one("SELECT * FROM models WHERE version=? AND run_id=?", (int(version), run["id"]))
        if row is None or row["status"] not in ("archived", "rolled_back") or not row["artifact"]:
            raise LifecycleError("Choose an archived version from the active run")
        model = self.model(int(version))                 # verifies the checksum
        meta = loads(row["metadata"])
        with self.db.transaction() as c:
            live = _parse_run(c.execute("SELECT * FROM runs WHERE id=?", (run["id"],)).fetchone())
            c.execute("UPDATE models SET status='rolled_back' WHERE version=?", (live["active_version"],))
            c.execute("UPDATE models SET status='active' WHERE version=?", (int(version),))
            state = live["monitor_state"]
            state["monitor"] = new_monitor(settings, meta.get("reference_error", state["monitor"]["reference_error"]),
                                           100, model.psi_reference)
            state["post_update"] = None
            c.execute("UPDATE runs SET active_version=?, last_update_batch=?, monitor_state=?, updated=? WHERE id=?",
                      (int(version), live["batch_index"], dumps(state), now(), run["id"]))
            c.execute("UPDATE decisions SET status='stale', resolved=?, outcome='rollback' "
                      "WHERE run_id=? AND status='pending'", (now(), run["id"]))
            self.db.event("rollback", {"from_version": live["active_version"], "to_version": int(version),
                                       "reason": reason[:500]}, c, run["id"], actor.strip()[:80])
        return {"status": "rolled_back", "version": int(version)}

    # ---------------------------------------------------- agent requests
    def create_request(self, decision_id: str, action: str, rationale: str, prepared_by: str,
                       report_id: int | None = None) -> int:
        if action not in ("defer", "partial", "full"):
            raise LifecycleError("Invalid action")
        row = self.db.one("SELECT status FROM decisions WHERE id=?", (decision_id,))
        if row is None:
            raise LifecycleError("Unknown decision")
        with self.db.transaction() as c:
            cur = c.execute("INSERT INTO execution_requests(decision_id,action,prepared_by,rationale,status,created,"
                            "report_id) VALUES (?,?,?,?,?,?,?)",
                            (decision_id, action, prepared_by[:80], str(rationale)[:1000], "awaiting_approval",
                             now(), report_id))
            self.db.event("execution_request_prepared", {"decision": decision_id, "action": action,
                                                         "note": "not executed; requires human approval"},
                          c, None, prepared_by[:80])
            return int(cur.lastrowid)

    def dismiss_request(self, request_id: int, actor: str) -> None:
        with self.db.transaction() as c:
            c.execute("UPDATE execution_requests SET status='dismissed' WHERE id=? AND status='awaiting_approval'",
                      (int(request_id),))
            self.db.event("execution_request_dismissed", {"request": int(request_id)}, c, None, actor)

    # --------------------------------------------------------------- autonomy
    def autonomous_step(self, run_id: str) -> dict:
        """Bounded autonomy: evaluate when monitoring suggests it, then execute
        only if every guardrail and every autonomy limit passes."""
        settings = self.settings()
        run = self.run(run_id)
        telemetry = run["monitor_state"].get("last_telemetry") or {}
        if not settings.autonomy:
            return {"acted": False, "reason": "autonomy disabled"}
        if run["autonomous_actions"] >= settings.autonomy_max_actions:
            return {"acted": False, "reason": "autonomous action limit reached"}
        if not telemetry.get("evaluation_suggested"):
            return {"acted": False, "reason": "monitoring did not request an evaluation"}
        decision = self.evaluate(run_id, actor="bounded-autonomy")
        top = decision["ranked"][0]
        if top["action"] == "defer":
            self.db.event("autonomy_held", {"decision": decision["id"], "reason": "defer recommended"}, None,
                          run_id, "bounded-autonomy")
            return {"acted": False, "reason": "defer recommended", "decision": decision["id"]}
        if top["total_cost"] > settings.autonomy_max_cost:
            self.db.event("autonomy_held", {"decision": decision["id"], "reason": "cost above autonomy limit"}, None,
                          run_id, "bounded-autonomy")
            return {"acted": False, "reason": "cost above autonomy limit; awaiting human approval",
                    "decision": decision["id"]}
        result = self.execute(decision["id"], top["action"], "bounded-autonomy policy", mode="autonomous")
        return {"acted": True, "decision": decision["id"], **result}

    # ------------------------------------------------------------- read models
    def telemetry(self, run_id: str) -> pd.DataFrame:
        rows = self.db.query("SELECT telemetry FROM batches WHERE run_id=? ORDER BY batch_index", (run_id,))
        return pd.DataFrame([loads(r["telemetry"]) for r in rows])

    def registry(self, run_id: str | None = None) -> pd.DataFrame:
        sql = "SELECT version, run_id, created, artifact, sha256, parent_version, action, status, train_start, " \
              "train_end, n_train, seed, metadata FROM models " + ("WHERE run_id=? " if run_id else "") + "ORDER BY version DESC"
        return pd.DataFrame(self.db.query(sql, (run_id,) if run_id else ()))

    def label_summary(self, run_id: str) -> dict:
        row = self.db.one("SELECT COUNT(*) AS predicted, SUM(label_available) AS available, "
                          "SUM(CASE WHEN revealed_batch IS NOT NULL THEN 1 ELSE 0 END) AS revealed "
                          "FROM predictions WHERE run_id=?", (run_id,))
        return {k: int(row[k] or 0) for k in ("predicted", "available", "revealed")}

    def model_age_seconds(self, run: dict) -> float | None:
        row = self.db.one("SELECT created FROM models WHERE version=?", (run["active_version"],))
        if not row:
            return None
        created = datetime.fromisoformat(row["created"])
        return (datetime.now(timezone.utc) - created).total_seconds()
