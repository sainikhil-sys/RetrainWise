"""Durable engine state for serverless hosting (Vercel).

Serverless functions have no persistent disk, so each workspace's engine folder
(its SQLite database and model artifacts) is kept in PostgreSQL as one
compressed archive, and downloaded datasets likewise. A request:

  1. takes a per-workspace PostgreSQL advisory lock (mutating commands only),
  2. restores the workspace folder into /tmp if this instance's copy is stale,
  3. runs the engine command,
  4. writes the folder back with a new version number.

Reads skip the lock and the write. Tables are created by the web app's Prisma
schema ("EngineStore", "EngineDataset").
"""
from __future__ import annotations

import io
import os
import shutil
import sqlite3
import ssl
import tarfile
import zlib
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import unquote, urlparse

_versions: dict[str, int] = {}   # workspace -> archive version restored in this instance
_datasets_loaded: set[str] = set()


def database_url() -> str | None:
    # Advisory locks need a session-level connection, so prefer the direct (unpooled) URL.
    return os.environ.get("DATABASE_URL_UNPOOLED") or os.environ.get("POSTGRES_URL_NON_POOLING") or os.environ.get("DATABASE_URL")


def enabled() -> bool:
    url = database_url() or ""
    return url.startswith(("postgres://", "postgresql://"))


@contextmanager
def connect():
    import pg8000.native
    u = urlparse(database_url())
    conn = pg8000.native.Connection(
        user=unquote(u.username or ""), password=unquote(u.password or ""), host=u.hostname, port=u.port or 5432,
        database=(u.path or "/").lstrip("/") or "postgres", ssl_context=ssl.create_default_context(), timeout=30,
    )
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def workspace_lock(conn, workspace: str):
    conn.run("SELECT pg_advisory_lock(hashtext(:k))", k=f"rw-ws:{workspace}")
    try:
        yield
    finally:
        conn.run("SELECT pg_advisory_unlock(hashtext(:k))", k=f"rw-ws:{workspace}")


def _pack(folder: Path, skip_suffixes=("-wal", "-shm", "-journal")) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for path in sorted(folder.rglob("*")):
            if path.is_file() and not path.name.endswith(skip_suffixes):
                tar.add(path, arcname=str(path.relative_to(folder)))
    return zlib.compress(buf.getvalue(), 6)


def _unpack(blob: bytes, folder: Path) -> None:
    if folder.exists():
        shutil.rmtree(folder)
    folder.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(zlib.decompress(blob)), mode="r") as tar:
        for member in tar.getmembers():   # refuse absolute paths and traversal
            target = (folder / member.name).resolve()
            if not str(target).startswith(str(folder.resolve())) or not (member.isfile() or member.isdir()):
                raise ValueError(f"unsafe archive member {member.name}")
        tar.extractall(folder)


def pull(conn, workspace: str, folder: Path) -> bool:
    """Make the local folder match the stored archive. Returns True if it changed."""
    rows = conn.run('SELECT version FROM "EngineStore" WHERE workspace=:w', w=workspace)
    stored = int(rows[0][0]) if rows else 0
    if _versions.get(workspace) == stored and (stored == 0 or folder.exists()):
        return False
    if stored == 0:
        if folder.exists():
            shutil.rmtree(folder)
    else:
        blob = conn.run('SELECT archive FROM "EngineStore" WHERE workspace=:w', w=workspace)[0][0]
        _unpack(bytes(blob), folder)
    _versions[workspace] = stored
    return True


def push(conn, workspace: str, folder: Path) -> None:
    db = folder / "retrainwise.db"
    if db.exists():                                   # fold the WAL into the main file before archiving
        con = sqlite3.connect(str(db), timeout=30)
        try:
            con.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        finally:
            con.close()
    version = _versions.get(workspace, 0) + 1
    conn.run(
        'INSERT INTO "EngineStore" (workspace, version, archive, updated) VALUES (:w, :v, :a, now()) '
        'ON CONFLICT (workspace) DO UPDATE SET version=:v, archive=:a, updated=now()',
        w=workspace, v=version, a=_pack(folder),
    )
    _versions[workspace] = version


def pull_datasets(conn, folder: Path) -> None:
    """Restore downloaded datasets (shared by all workspaces) that this instance lacks."""
    names = [r[0] for r in conn.run('SELECT name FROM "EngineDataset"')]
    for name in names:
        if name in _datasets_loaded:
            continue
        blob = conn.run('SELECT archive FROM "EngineDataset" WHERE name=:n', n=name)[0][0]
        folder.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(zlib.decompress(bytes(blob))), mode="r") as tar:
            for member in tar.getmembers():
                if "/" in member.name or "\\" in member.name or not member.isfile():
                    raise ValueError(f"unsafe dataset member {member.name}")
            tar.extractall(folder)
        _datasets_loaded.add(name)


def push_dataset(conn, name: str, folder: Path) -> None:
    files = [p for p in folder.glob(f"data_{name}*") if p.is_file()]
    if not files:
        return
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for p in files:
            tar.add(p, arcname=p.name)
    conn.run(
        'INSERT INTO "EngineDataset" (name, archive, updated) VALUES (:n, :a, now()) '
        'ON CONFLICT (name) DO UPDATE SET archive=:a, updated=now()',
        n=name, a=zlib.compress(buf.getvalue(), 1),
    )
    _datasets_loaded.add(name)
