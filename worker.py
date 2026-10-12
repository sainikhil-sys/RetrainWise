"""Experiment worker process: ``python worker.py <job_id> [database path]``.

Launched by ``jobs.submit``. Claims exactly one queued job, sends heartbeats,
honours cancellation between policy runs and records the outcome in SQLite.
"""
from __future__ import annotations

import sys
import threading
import time
import traceback
from pathlib import Path

from config import Settings
from database import Database, dumps, log, now
from experiments import benchmark
from jobs import HEARTBEAT_SECONDS


def run(job_id: str, db_path: str | None = None) -> str:
    db = Database(db_path)
    root = Path(db.path).resolve().parent          # outputs live next to the database
    with db.transaction() as c:
        row = c.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None or row["status"] != "queued":
            return "not claimed"
        c.execute("UPDATE jobs SET status='running', heartbeat=?, message='starting' WHERE id=?", (now(), job_id))
    import json
    payload = json.loads(row["payload"])
    stop = threading.Event()

    def beat():
        while not stop.wait(HEARTBEAT_SECONDS):
            with db.transaction() as c:
                c.execute("UPDATE jobs SET heartbeat=? WHERE id=?", (now(), job_id))

    threading.Thread(target=beat, daemon=True).start()
    last = {"t": 0.0, "cancel_check": 0.0, "cancelled": False}

    def progress(fraction: float, message: str):
        if time.monotonic() - last["t"] < 0.5 and fraction < 1:
            return
        last["t"] = time.monotonic()
        with db.transaction() as c:
            c.execute("UPDATE jobs SET progress=?, message=?, heartbeat=? WHERE id=?",
                      (float(fraction), message[:200], now(), job_id))

    def cancelled() -> bool:
        if time.monotonic() - last["cancel_check"] > 0.5:
            last["cancel_check"] = time.monotonic()
            r = db.one("SELECT cancel_requested FROM jobs WHERE id=?", (job_id,))
            last["cancelled"] = bool(r and r["cancel_requested"])
        return last["cancelled"]

    prefix = f"experiment_{job_id}"
    try:
        result = benchmark(payload["datasets"], payload["size"], payload["seeds"], payload["regimes"],
                           payload["policies"], Settings.from_dict(payload["settings"]), root, prefix,
                           progress, cancelled)
        files = [f"{prefix}_summary.csv", f"{prefix}_details.json"]
        try:
            from reporting import charts_for
            files += charts_for(prefix, root)
        except Exception as exc:  # charts are optional; the data files are the result
            log("chart_error", job=job_id, error=str(exc))
        status, outcome = "completed", {"files": files, "runs": len(result["summary"]),
                                        "wall_seconds": result["wall_seconds"]}
        error = None
    except InterruptedError:
        status, outcome, error = "cancelled", None, "Cancelled by user; partial results were not written."
    except Exception as exc:  # noqa: BLE001 - record any failure
        status, outcome, error = "failed", None, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()[-1500:]}"
    finally:
        stop.set()
    with db.transaction() as c:
        c.execute("UPDATE jobs SET status=?, result=?, error=?, finished=?, progress=CASE WHEN ?='completed' "
                  "THEN 1.0 ELSE progress END, message=? WHERE id=?",
                  (status, dumps(outcome) if outcome else None, error, now(), status, status, job_id))
        db.event(f"job_{status}", {"job": job_id, "result": outcome, "error": (error or "")[:300]}, c,
                 actor="worker")
    return status


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or not sys.argv[1].isalnum():
        raise SystemExit("usage: python worker.py <job_id> [database path]")
    print(run(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None))
