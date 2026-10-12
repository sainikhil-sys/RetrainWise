"""SQLite persistence: the source of truth for runs, telemetry, registry,
decisions, approvals, agent evidence, jobs and the audit log.

Every write goes through ``Database.transaction`` (``BEGIN IMMEDIATE``) so a
Streamlit rerun, a second browser tab and the experiment worker process cannot
interleave partial updates.
"""
from __future__ import annotations

import json
import logging
import math
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from config import DB_PATH, LOG_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings(
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(
    id TEXT PRIMARY KEY, created TEXT NOT NULL, updated TEXT NOT NULL,
    dataset TEXT NOT NULL, size_label TEXT NOT NULL, n_rows INTEGER NOT NULL,
    seed INTEGER NOT NULL, data_sha256 TEXT NOT NULL, status TEXT NOT NULL,
    position INTEGER NOT NULL, batch_index INTEGER NOT NULL,
    last_update_batch INTEGER NOT NULL, last_eval_batch INTEGER NOT NULL,
    spent REAL NOT NULL, evaluation_spent REAL NOT NULL,
    autonomous_actions INTEGER NOT NULL, active_version INTEGER,
    monitor_state TEXT NOT NULL, settings TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batches(
    run_id TEXT NOT NULL, batch_index INTEGER NOT NULL, start_row INTEGER NOT NULL,
    end_row INTEGER NOT NULL, version INTEGER NOT NULL, created TEXT NOT NULL,
    telemetry TEXT NOT NULL, PRIMARY KEY(run_id, batch_index));
CREATE TABLE IF NOT EXISTS predictions(
    run_id TEXT NOT NULL, row INTEGER NOT NULL, batch_index INTEGER NOT NULL,
    version INTEGER NOT NULL, prediction TEXT NOT NULL, label_available INTEGER NOT NULL,
    due_batch INTEGER NOT NULL, revealed_batch INTEGER, error INTEGER,
    PRIMARY KEY(run_id, row));
CREATE INDEX IF NOT EXISTS predictions_due ON predictions(run_id, revealed_batch, due_batch);
CREATE TABLE IF NOT EXISTS models(
    version INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, created TEXT NOT NULL,
    artifact TEXT, sha256 TEXT, parent_version INTEGER, action TEXT NOT NULL,
    status TEXT NOT NULL, train_start INTEGER, train_end INTEGER, n_train INTEGER,
    seed INTEGER, metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions(
    id TEXT PRIMARY KEY, run_id TEXT NOT NULL, created TEXT NOT NULL,
    position INTEGER NOT NULL, batch_index INTEGER NOT NULL, version INTEGER NOT NULL,
    recommended TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
    resolved TEXT, outcome TEXT);
CREATE TABLE IF NOT EXISTS approvals(
    id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id TEXT NOT NULL, action TEXT NOT NULL,
    actor TEXT NOT NULL, mode TEXT NOT NULL, created TEXT NOT NULL, outcome TEXT,
    detail TEXT, UNIQUE(decision_id));
CREATE TABLE IF NOT EXISTS execution_requests(
    id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id TEXT NOT NULL, action TEXT NOT NULL,
    prepared_by TEXT NOT NULL, rationale TEXT NOT NULL, status TEXT NOT NULL,
    created TEXT NOT NULL, report_id INTEGER);
CREATE TABLE IF NOT EXISTS agent_reports(
    id INTEGER PRIMARY KEY AUTOINCREMENT, decision_id TEXT, created TEXT NOT NULL,
    mode TEXT NOT NULL, model TEXT, status TEXT NOT NULL, report TEXT NOT NULL,
    iterations INTEGER NOT NULL, duration_seconds REAL NOT NULL, error TEXT);
CREATE TABLE IF NOT EXISTS agent_tool_calls(
    id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, created TEXT NOT NULL,
    tool TEXT NOT NULL, arguments TEXT NOT NULL, status TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(
    id TEXT PRIMARY KEY, created TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
    progress REAL NOT NULL, message TEXT, cancel_requested INTEGER NOT NULL DEFAULT 0,
    heartbeat TEXT, pid INTEGER, payload TEXT NOT NULL, payload_hash TEXT NOT NULL,
    result TEXT, error TEXT, finished TEXT);
CREATE TABLE IF NOT EXISTS events(
    id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, kind TEXT NOT NULL,
    run_id TEXT, actor TEXT NOT NULL, payload TEXT NOT NULL);
"""

TABLES = ("settings", "runs", "batches", "predictions", "models", "decisions", "approvals",
          "execution_requests", "agent_reports", "agent_tool_calls", "jobs", "events")


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _plain(value):
    """Convert numpy scalars/arrays and other objects into JSON-safe values."""
    if hasattr(value, "item") and getattr(value, "shape", None) == ():
        value = value.item()
    elif hasattr(value, "tolist"):
        return value.tolist()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (set, tuple)):
        return list(value)
    if isinstance(value, Path):
        return value.name
    return value if isinstance(value, (str, int, float, bool, type(None), list, dict)) else str(value)


def _sanitize(obj):
    if isinstance(obj, dict):
        return {str(k): _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_sanitize(v) for v in obj]
    value = _plain(obj)
    if isinstance(value, (list, dict)) and value is not obj:
        return _sanitize(value)
    return value


def dumps(value) -> str:
    """Strict JSON: non-finite floats become null rather than invalid JSON."""
    return json.dumps(_sanitize(value), allow_nan=False)


def loads(text):
    return json.loads(text) if text else None


_LOGGER = None


def logger() -> logging.Logger:
    """Structured JSON-lines application log (``retrainwise.log``)."""
    global _LOGGER
    if _LOGGER is None:
        _LOGGER = logging.getLogger("retrainwise")
        if not _LOGGER.handlers:
            handler = logging.FileHandler(LOG_PATH, encoding="utf-8")
            handler.setFormatter(logging.Formatter("%(message)s"))
            _LOGGER.addHandler(handler)
            _LOGGER.setLevel(logging.INFO)
            _LOGGER.propagate = False
    return _LOGGER


def log(kind: str, **fields) -> None:
    try:
        logger().info(dumps({"time": now(), "kind": kind, **fields}))
    except Exception:  # logging must never break the application
        pass


class Database:
    def __init__(self, path: Path | str | None = None):
        self.path = str(path or DB_PATH)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")
        return conn

    @contextmanager
    def transaction(self):
        conn = self.connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    @contextmanager
    def reader(self):
        conn = self.connect()
        try:
            yield conn
        finally:
            conn.close()

    # ------------------------------------------------------------------ helpers
    def get_setting(self, key: str, default=None):
        with self.reader() as conn:
            row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put_setting(self, key: str, value, conn=None) -> None:
        sql = "INSERT INTO settings(key,value,updated) VALUES(?,?,?) " \
              "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated"
        if conn is None:
            with self.transaction() as c:
                c.execute(sql, (key, dumps(value), now()))
        else:
            conn.execute(sql, (key, dumps(value), now()))

    def event(self, kind: str, payload: dict, conn=None, run_id: str | None = None,
              actor: str = "system") -> None:
        sql = "INSERT INTO events(created,kind,run_id,actor,payload) VALUES(?,?,?,?,?)"
        args = (now(), kind, run_id, actor, dumps(payload))
        if conn is None:
            with self.transaction() as c:
                c.execute(sql, args)
        else:
            conn.execute(sql, args)
        log(kind, run_id=run_id, actor=actor)

    def query(self, sql: str, args: tuple = ()) -> list[dict]:
        if not sql.lstrip().upper().startswith("SELECT"):
            raise ValueError("query() is read-only")
        with self.reader() as conn:
            return [dict(r) for r in conn.execute(sql, args)]

    def one(self, sql: str, args: tuple = ()) -> dict | None:
        rows = self.query(sql, args)
        return rows[0] if rows else None

    def recent(self, table: str, limit: int = 100, run_id: str | None = None) -> list[dict]:
        if table not in TABLES:
            raise ValueError(f"Unknown table {table!r}")
        limit = max(1, min(int(limit), 10_000))
        if run_id is not None and table in ("batches", "predictions", "models", "decisions", "events"):
            return self.query(f"SELECT * FROM {table} WHERE run_id=? ORDER BY rowid DESC LIMIT ?",
                              (run_id, limit))
        return self.query(f"SELECT * FROM {table} ORDER BY rowid DESC LIMIT ?", (limit,))
