"""Persistent long-running jobs executed by ``worker.py`` in a separate process.

The web app only reads job rows; they never start work themselves except
through ``submit``, which deduplicates identical requests and allows one active
job at a time. Progress, heartbeats, cancellation and failures live in SQLite.
Jobs are NOT resumable: after a restart, jobs whose worker stopped sending
heartbeats are marked ``interrupted`` and must be submitted again.
"""
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from config import DATA_ROOT, ROOT, REGIMES, SAMPLE_SIZES, Settings
from database import Database, dumps, loads, now
from datasets import DATASETS, is_cached
from experiments import POLICIES

HEARTBEAT_SECONDS = 5
STALE_AFTER_SECONDS = 45
MAX_RUNS_PER_JOB = 400


def validate_payload(payload: dict, root=ROOT) -> dict:
    datasets = list(payload.get("datasets") or [])
    policies = list(payload.get("policies") or [])
    regimes = list(payload.get("regimes") or [])
    seeds = [int(s) for s in payload.get("seeds") or []]
    size = payload.get("size")
    if not datasets or any(d not in DATASETS for d in datasets):
        raise ValueError("Choose datasets from the supported list")
    missing = [d for d in datasets if not is_cached(d, root)]
    if missing:
        raise ValueError(f"Download {missing} first; synthetic data is never substituted")
    if not policies or any(p not in POLICIES for p in policies):
        raise ValueError("Choose at least one valid policy")
    if not regimes or any(r not in REGIMES for r in regimes):
        raise ValueError("Choose at least one valid cost regime")
    if not seeds or len(seeds) > 10 or len(set(seeds)) != len(seeds) or any(s < 0 or s > 2**31 for s in seeds):
        raise ValueError("Provide 1-10 distinct non-negative seeds")
    if size not in SAMPLE_SIZES:
        raise ValueError("Unknown sample size")
    runs = len(datasets) * len(policies) * len(regimes) * len(seeds)
    if runs > MAX_RUNS_PER_JOB:
        raise ValueError(f"{runs} runs requested; the limit per job is {MAX_RUNS_PER_JOB}")
    settings = Settings.from_dict(payload.get("settings") or {})
    return {"datasets": datasets, "policies": policies, "regimes": regimes, "seeds": seeds, "size": size,
            "settings": settings.to_dict()}


def _age_seconds(stamp: str | None) -> float:
    if not stamp:
        return float("inf")
    return (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()


def recover(db: Database) -> int:
    """Mark jobs whose worker stopped heart-beating as interrupted."""
    marked = 0
    for job in db.query("SELECT id, heartbeat, created FROM jobs WHERE status IN ('queued','running')"):
        if min(_age_seconds(job["heartbeat"]), float("inf")) > STALE_AFTER_SECONDS and \
                _age_seconds(job["created"]) > STALE_AFTER_SECONDS:
            with db.transaction() as c:
                n = c.execute("UPDATE jobs SET status='interrupted', finished=?, error=? WHERE id=? AND "
                              "status IN ('queued','running')",
                              (now(), "Worker stopped without finishing (application restart or crash). "
                                      "Jobs are not resumable; submit it again.", job["id"])).rowcount
                if n:
                    db.event("job_interrupted", {"job": job["id"]}, c)
                    marked += n
    return marked


def submit(db: Database, payload: dict, actor: str = "user", kind: str = "benchmark", root=ROOT,
           launch: bool = True) -> tuple[str, bool]:
    """Queue a job and launch its worker. Returns (job_id, created).

    Identical requests (same payload hash) return the existing queued/running
    job, so refreshes, repeated clicks and other tabs cannot start duplicates;
    only one job may run per workspace at a time."""
    if kind == "training":
        from training import validate_config
        settings = Settings.from_dict(payload.get("settings") or {})
        payload = {"config": validate_config(payload.get("config"), settings, root), "settings": settings.to_dict(),
                   "incumbent_version": payload.get("incumbent_version"), "requested_by": actor}
    elif kind == "benchmark":
        payload = validate_payload(payload, root)
    else:
        raise ValueError("Unknown job kind")
    digest = hashlib.sha256(dumps(payload).encode()).hexdigest()
    if kind == "benchmark":
        # Recorded for the completion report; added after hashing so identical
        # requests from different people still share one job.
        payload = {**payload, "requested_by": actor}
    recover(db)
    with db.transaction() as c:
        same = c.execute("SELECT id FROM jobs WHERE payload_hash=? AND status IN ('queued','running')",
                         (digest,)).fetchone()
        if same:
            return same["id"], False
        if c.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone():
            raise ValueError("Another job is running; wait for it or cancel it first")
        job_id = uuid.uuid4().hex[:10]
        c.execute("INSERT INTO jobs(id,created,kind,status,progress,message,payload,payload_hash) "
                  "VALUES (?,?,?,?,?,?,?,?)", (job_id, now(), kind, "queued", 0.0, "queued", dumps(payload), digest))
        c.execute("INSERT INTO job_logs(job_id,created,level,message) VALUES (?,?,?,?)",
                  (job_id, now(), "stage", "queued"))
        db.event("job_submitted", {"job": job_id, "kind": kind, "payload": payload}, c, actor=actor)
    if launch:
        _launch(db, job_id)
    return job_id, True


def _launch(db: Database, job_id: str) -> None:
    kwargs = {"cwd": str(ROOT), "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL,
              "stderr": subprocess.DEVNULL, "close_fds": True}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        proc = subprocess.Popen([sys.executable, "-B", str(ROOT / "worker.py"), job_id, db.path], **kwargs)
    except OSError as exc:
        with db.transaction() as c:
            c.execute("UPDATE jobs SET status='failed', error=?, finished=? WHERE id=?",
                      (f"Could not start worker: {exc}", now(), job_id))
        raise
    with db.transaction() as c:
        c.execute("UPDATE jobs SET pid=? WHERE id=?", (proc.pid, job_id))


def cancel(db: Database, job_id: str, actor: str = "user") -> bool:
    with db.transaction() as c:
        n = c.execute("UPDATE jobs SET cancel_requested=1, message='cancellation requested' "
                      "WHERE id=? AND status IN ('queued','running')", (job_id,)).rowcount
        if n:
            db.event("job_cancel_requested", {"job": job_id}, c, actor=actor)
    return bool(n)


def jobs(db: Database, limit: int = 20) -> list[dict]:
    out = []
    for row in db.query("SELECT * FROM jobs ORDER BY created DESC LIMIT ?", (int(limit),)):
        row["payload"] = loads(row["payload"])
        row["result"] = loads(row["result"])
        out.append(row)
    return out
