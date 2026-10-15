"""RetrainWise engine as a Vercel Python Function (WSGI ``app``).

Same protocol as engine/server.py:
    GET  /health
    POST /call   {"command", "args", "isolated", "env"}   Authorization: Bearer <token>

State lives in PostgreSQL (cloud_store) because serverless functions have no
persistent disk; training and benchmark jobs run inside the request.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import threading
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

# Serverless defaults: writable /tmp for engine state and dataset caches, jobs run inline.
os.environ.setdefault("RETRAINWISE_WORKSPACES_DIR", "/tmp/retrainwise/workspaces")
os.environ.setdefault("RETRAINWISE_DATASETS_DIR", "/tmp/retrainwise/datasets")
os.environ.setdefault("RETRAINWISE_INLINE_JOBS", "1")
os.environ.setdefault("MPLCONFIGDIR", "/tmp/retrainwise/mpl")

import bridge  # noqa: E402
import cloud_store  # noqa: E402
import pipeline  # noqa: E402
from config import DATA_ROOT, WORKSPACES_ROOT  # noqa: E402

LOCK = threading.Lock()   # the bridge keeps per-request globals: one command at a time per instance
MAX_BODY = 2_000_000

# Commands that never change engine state (no lock, no write-back).
READ_ONLY = {
    "ping", "query", "settings", "datasets", "dataset_preview", "experiment_sets", "experiment_results",
    "experiment_traces", "pricing", "catalog", "training_options", "llm_status", "ollama_status",
    "result_file", "read_result_file", "what_if", "reference_window",
}


def engine_token() -> str:
    """Shared secret: RETRAINWISE_ENGINE_TOKEN, or derived from the database URL both projects share."""
    explicit = os.environ.get("RETRAINWISE_ENGINE_TOKEN", "")
    if explicit:
        return explicit
    url = cloud_store.database_url() or ""
    return hashlib.sha256(f"retrainwise-engine-token:{url}".encode()).hexdigest() if url else ""


def _json(start_response, status: str, payload: dict):
    body = bridge._encode(payload).encode("utf-8")
    start_response(status, [("Content-Type", "application/json"), ("Content-Length", str(len(body))),
                            ("Cache-Control", "no-store")])
    return [body]


def _run(command: str, args: dict, env: dict) -> dict:
    workspace = args.get("workspace")
    old_env = {k: os.environ.get(k) for k in env}
    os.environ.update(env)
    try:
        if not cloud_store.enabled() or not isinstance(workspace, str):
            return bridge.handle(command, args)
        folder = WORKSPACES_ROOT / workspace
        mutating = command not in READ_ONLY
        with cloud_store.connect() as conn:
            cloud_store.pull_datasets(conn, DATA_ROOT)
            if mutating:
                with cloud_store.workspace_lock(conn, workspace):
                    _restore(conn, workspace, folder)
                    response = bridge.handle(command, args)
                    if response.get("ok") or command in ("submit_training", "submit_job"):
                        cloud_store.push(conn, workspace, folder)
                    if response.get("ok") and command == "download_dataset":
                        cloud_store.push_dataset(conn, str(args.get("name")), DATA_ROOT)
                    return response
            _restore(conn, workspace, folder)
            response = bridge.handle(command, args)
            if command == "ping" and not cloud_store._versions.get(workspace):
                # First contact creates the workspace database: store it.
                with cloud_store.workspace_lock(conn, workspace):
                    cloud_store.push(conn, workspace, folder)
            return response
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _restore(conn, workspace: str, folder: Path) -> None:
    if cloud_store.pull(conn, workspace, folder):
        # Another instance changed this workspace: drop cached engine objects for it.
        bridge._LIVES.pop(workspace, None)
        pipeline._MODELS.clear()


def app(environ, start_response):
    path = environ.get("PATH_INFO", "/")
    method = environ.get("REQUEST_METHOD", "GET")
    if path.rstrip("/") in ("", "/health", "/api/health") and method == "GET":
        return _json(start_response, "200 OK", {"ok": True, "service": "retrainwise-engine", "storage": "postgres" if cloud_store.enabled() else "local"})
    if path.rstrip("/") not in ("/call", "/api/call") or method != "POST":
        return _json(start_response, "404 Not Found", {"ok": False, "kind": "not_found", "error": "Not found"})
    token = engine_token()
    auth = environ.get("HTTP_AUTHORIZATION", "")
    if len(token) < 24 or not auth.startswith("Bearer ") or not hmac.compare_digest(auth[7:].encode(), token.encode()):
        return _json(start_response, "401 Unauthorized", {"ok": False, "kind": "forbidden", "error": "Missing or invalid engine token"})
    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length <= 0 or length > MAX_BODY:
        return _json(start_response, "413 Payload Too Large", {"ok": False, "kind": "invalid", "error": "Request body missing or too large"})
    try:
        request = json.loads(environ["wsgi.input"].read(length))
        command, args = request["command"], request.get("args") or {}
        if not isinstance(command, str) or not isinstance(args, dict):
            raise ValueError
    except (ValueError, KeyError, json.JSONDecodeError):
        return _json(start_response, "400 Bad Request", {"ok": False, "kind": "invalid", "error": "Malformed request"})
    env = {k: str(v) for k, v in (request.get("env") or {}).items() if k == "LLM_API_KEY"}
    with LOCK:
        try:
            response = _run(command, args, env)
        except Exception as exc:  # noqa: BLE001 - always answer with JSON
            response = {"ok": False, "kind": "internal", "error": f"{type(exc).__name__}: {exc}"[:1000]}
    return _json(start_response, "200 OK", response)
