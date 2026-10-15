"""RetrainWise engine service: the command bridge over authenticated HTTP.

Hosted deployments run the web app on Vercel and this service next to the
engine's databases and model artifacts (a container with a persistent disk).

    RETRAINWISE_ENGINE_TOKEN=<shared secret> python engine/server.py      # PORT defaults to 8000

Endpoints
    GET  /health          liveness (no authentication, no data)
    POST /call            {"command": str, "args": {...}, "isolated": bool}
                          Authorization: Bearer <RETRAINWISE_ENGINE_TOKEN>

Lifecycle commands run one at a time (as in the local bridge), so batches,
evaluations, promotions and rollbacks never interleave. Slow, self-contained
commands (downloads, language-model explanations, model pulls) run in their own
process so they cannot block the queue. Only the bridge's allow-listed commands
exist; arguments are validated by the bridge and the engine.
"""
from __future__ import annotations

import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

import bridge  # noqa: E402

TOKEN = os.environ.get("RETRAINWISE_ENGINE_TOKEN", "")
MAX_BODY = 2_000_000
LOCK = threading.Lock()
ISOLATED_TIMEOUT = 3600


def _authorised(header: str | None) -> bool:
    if not TOKEN or len(TOKEN) < 24:
        return False
    if not header or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].encode(), TOKEN.encode())


def _isolated(command: str, args: dict, env_extra: dict) -> dict:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", **env_extra}
    try:
        proc = subprocess.run([sys.executable, "-B", str(ENGINE_DIR / "bridge.py"), "call", command],
                              input=json.dumps(args), capture_output=True, text=True, encoding="utf-8",
                              timeout=ISOLATED_TIMEOUT, cwd=str(ENGINE_DIR), env=env)
    except subprocess.TimeoutExpired:
        return {"ok": False, "kind": "timeout", "error": f"{command} timed out"}
    lines = [ln for ln in proc.stdout.strip().splitlines() if ln.strip()]
    try:
        return json.loads(lines[-1])
    except (IndexError, json.JSONDecodeError):
        tail = " ".join(proc.stderr.strip().splitlines()[-3:])
        return {"ok": False, "kind": "internal", "error": f"Engine returned no result. {tail}"[:1000]}


class Handler(BaseHTTPRequestHandler):
    server_version = "RetrainWiseEngine/1"

    def log_message(self, fmt, *args):  # one compact line per request, no bodies
        sys.stderr.write("[engine] %s %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, payload: dict) -> None:
        body = bridge._encode(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.split("?")[0] == "/health":
            self._send(200, {"ok": True, "service": "retrainwise-engine", "token_configured": bool(TOKEN)})
        else:
            self._send(404, {"ok": False, "kind": "not_found", "error": "Not found"})

    def do_POST(self):  # noqa: N802
        if self.path.split("?")[0] != "/call":
            return self._send(404, {"ok": False, "kind": "not_found", "error": "Not found"})
        if not _authorised(self.headers.get("Authorization")):
            return self._send(401, {"ok": False, "kind": "forbidden", "error": "Missing or invalid engine token"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._send(413, {"ok": False, "kind": "invalid", "error": "Request body missing or too large"})
        try:
            request = json.loads(self.rfile.read(length))
            command, args = request["command"], request.get("args") or {}
            if not isinstance(command, str) or not isinstance(args, dict):
                raise ValueError
        except (ValueError, KeyError, json.JSONDecodeError):
            return self._send(400, {"ok": False, "kind": "invalid", "error": "Malformed request"})
        # Per-request environment for isolated commands (e.g. a workspace's model API key).
        env_extra = {k: str(v) for k, v in (request.get("env") or {}).items() if k in ("LLM_API_KEY",)}
        if request.get("isolated"):
            response = _isolated(command, args, env_extra)
        else:
            with LOCK:
                response = bridge.handle(command, args)
        self._send(200, response)


def main() -> None:
    if not TOKEN or len(TOKEN) < 24:
        sys.exit("Set RETRAINWISE_ENGINE_TOKEN to a random secret of at least 24 characters.")
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    print(f"[engine] RetrainWise engine service listening on :{port}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
