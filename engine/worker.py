"""Background worker process: ``python worker.py <job_id> [database path]``.

Launched by ``jobs.submit``. Claims exactly one queued job, sends heartbeats,
honours cancellation and records the outcome in SQLite. Two job kinds:

* ``benchmark`` - policy comparison (experiments.benchmark); results are files
  next to the database.
* ``training``  - "Train model": real training plus chronological validation
  (training.run_training). Stages, progress and log lines are written to
  ``job_logs`` as they happen; the result is a registered *candidate* model.
"""
from __future__ import annotations

import json
import sys
import threading
import time
import traceback
from pathlib import Path

from config import DATA_ROOT, Settings
from database import Database, dumps, log, now
from jobs import HEARTBEAT_SECONDS

# Share of the progress bar given to each training stage (training itself is
# reported per epoch / tree chunk inside its band).
STAGE_BANDS = {"preparing data": (0.0, 0.05), "preprocessing": (0.05, 0.1), "training": (0.1, 0.9),
               "validating": (0.9, 0.97), "registering": (0.97, 1.0)}


def run(job_id: str, db_path: str | None = None) -> str:
    db = Database(db_path)
    root = Path(db.path).resolve().parent          # outputs live next to the database
    with db.transaction() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None or row["status"] != "queued":
            return "not claimed"
        c.execute("UPDATE jobs SET status='running', heartbeat=?, message='starting' WHERE id=?", (now(), job_id))
    payload = json.loads(row["payload"])
    kind = row["kind"]
    stop = threading.Event()

    def beat():
        while not stop.wait(HEARTBEAT_SECONDS):
            with db.transaction() as c:
                c.execute("UPDATE jobs SET heartbeat=? WHERE id=?", (now(), job_id))

    threading.Thread(target=beat, daemon=True).start()
    last = {"t": 0.0, "cancel_check": 0.0, "cancelled": False, "stage": "starting"}

    def write_log(level: str, message: str):
        with db.transaction() as c:
            c.execute("INSERT INTO job_logs(job_id,created,level,message) VALUES (?,?,?,?)",
                      (job_id, now(), level, str(message)[:2000]))

    def progress(fraction: float, message: str):
        if time.monotonic() - last["t"] < 0.4 and fraction < 1:
            return
        last["t"] = time.monotonic()
        with db.transaction() as c:
            c.execute("UPDATE jobs SET progress=?, message=?, heartbeat=? WHERE id=?",
                      (float(fraction), message[:200], now(), job_id))

    def cancelled() -> bool:
        if time.monotonic() - last["cancel_check"] > 0.3:
            last["cancel_check"] = time.monotonic()
            r = db.one("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,))
            last["cancelled"] = bool(r and r["cancel_requested"])
        return last["cancelled"]

    try:
        if kind == "training":
            status, outcome, error = _training(db, root, job_id, payload, write_log, progress, cancelled, last)
        else:
            status, outcome, error = _benchmark(root, job_id, payload, progress, cancelled)
    finally:
        stop.set()
    with db.transaction() as c:
        c.execute("UPDATE jobs SET status=?, result=?, error=?, finished=?, progress=CASE WHEN ?='completed' "
                  "THEN 1.0 ELSE progress END, message=? WHERE id=?",
                  (status, dumps(outcome) if outcome else None, error, now(), status, status, job_id))
        c.execute("INSERT INTO job_logs(job_id,created,level,message) VALUES (?,?,?,?)",
                  (job_id, now(), "stage", status))
        db.event(f"job_{status}", {"job": job_id, "kind": kind, "result": _brief(outcome),
                                   "error": (error or "")[:300]}, c, actor="worker")
    return status


def _brief(outcome):
    if not outcome:
        return None
    return {k: v for k, v in outcome.items() if k != "evaluation"}


def _benchmark(root, job_id, payload, progress, cancelled):
    from experiments import benchmark
    prefix = f"experiment_{job_id}"
    try:
        result = benchmark(payload["datasets"], payload["size"], payload["seeds"], payload["regimes"],
                           payload["policies"], Settings.from_dict(payload["settings"]), root, prefix,
                           progress, cancelled, data_root=DATA_ROOT)
        files = [f"{prefix}_summary.csv", f"{prefix}_details.json"]
        try:
            from reporting import charts_for
            files += charts_for(prefix, root)
        except Exception as exc:  # charts are optional; the data files are the result
            log("chart_error", job=job_id, error=str(exc))
        return "completed", {"files": files, "runs": len(result["summary"]), "wall_seconds": result["wall_seconds"]}, None
    except InterruptedError:
        return "cancelled", None, "Cancelled by user; partial results were not written."
    except Exception as exc:  # noqa: BLE001 - record any failure
        return "failed", None, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}"


def _training(db, root, job_id, payload, write_log, progress, cancelled, last):
    from pipeline import Lifecycle, LifecycleError
    from training import run_training

    life = Lifecycle(db, root, data_root=DATA_ROOT)
    settings = Settings.from_dict(payload["settings"])
    cfg = payload["config"]
    actor = payload.get("requested_by") or "user"

    def stage(name: str):
        last["stage"] = name
        lo, _ = STAGE_BANDS.get(name, (0.0, 0.0))
        write_log("stage", name)
        progress(lo, name)

    def band_progress(fraction: float, message: str):
        lo, hi = STAGE_BANDS.get(last["stage"], (0.0, 1.0))
        progress(lo + (hi - lo) * float(fraction), f"{last['stage']}: {message}")

    try:
        context = None
        if cfg["scope"] == "run":
            run = life.run(cfg["run_id"])
            if run is None or run["status"] != "active":
                raise LifecycleError("The run selected for training is no longer active")
            if payload.get("incumbent_version") is not None and run["active_version"] != payload["incumbent_version"]:
                raise LifecycleError("The active model changed after the job was queued; start a new training job")
            eligible = list(range(run["settings"]["initial_size"])) + [r["row"] for r in db.query(
                "SELECT row FROM predictions WHERE run_id=? AND revealed_batch IS NOT NULL ORDER BY row", (run["id"],))]
            context = {"frame": life.frame(run), "data_sha256": run["data_sha256"], "eligible": eligible,
                       "incumbent": life.model(run["active_version"]), "incumbent_version": run["active_version"],
                       "run_id": run["id"], "dataset": run["dataset"]}
        result = run_training(cfg, settings, DATA_ROOT, stage=stage, progress=band_progress,
                              log=lambda m: write_log("info", m), cancelled=cancelled, run_context=context)
        if cancelled():
            raise InterruptedError("Training cancelled")
        stage("registering")
        version = life.register_candidate(job_id, cfg, result, actor)
        write_log("info", f"Registered candidate v{version:03d}. Production is unchanged until an approver promotes it.")
        row = db.one("SELECT metadata FROM models WHERE version=?", (version,))
        meta = json.loads(row["metadata"])
        progress(1.0, "completed")
        return "completed", {"version": version, "evaluation": result["evaluation"], "gate": meta["gate"]}, None
    except InterruptedError:
        write_log("warning", "Cancelled before a candidate was registered; nothing was changed.")
        return "cancelled", None, "Cancelled by user before a candidate was registered."
    except Exception as exc:  # noqa: BLE001 - record any failure
        write_log("error", f"{type(exc).__name__}: {exc}")
        return "failed", None, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}"


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or not sys.argv[1].isalnum():
        raise SystemExit("usage: python worker.py <job_id> [database path]")
    print(run(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None))
