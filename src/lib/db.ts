import "server-only";

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { ENGINE_MODE, wsEngine, workspaceDir } from "./engine";

/**
 * Read-only access to a workspace's engine database
 * (engine/workspaces/<workspaceId>/retrainwise.db).
 *
 * Each workspace's engine store is the source of truth for its telemetry,
 * registry, decisions, jobs and engine audit events. The web server only reads
 * it; every write goes through the Python engine inside BEGIN IMMEDIATE
 * transactions. WAL mode lets these reads run while the engine writes.
 */
const globalForDb = globalThis as unknown as { __rwEngineDbs?: Map<string, Database.Database> };
const cache = (globalForDb.__rwEngineDbs ??= new Map());

function open(file: string): Database.Database {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

function hasSchema(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('runs','events','settings','probes','job_logs')")
    .get() as { n: number };
  return row.n === 5;
}

async function localDb(workspaceId: string): Promise<Database.Database> {
  const cached = cache.get(workspaceId);
  if (cached && cached.open) return cached;
  const file = path.join(workspaceDir(workspaceId), "retrainwise.db");
  if (!fs.existsSync(file)) await wsEngine(workspaceId).call("ping", {}, { timeoutMs: 180_000 });
  let db = open(file);
  if (!hasSchema(db)) {
    db.close();
    await wsEngine(workspaceId).call("ping", {}, { timeoutMs: 180_000 });
    db = open(file);
  }
  cache.set(workspaceId, db);
  return db;
}

/** Read-only access to one workspace's engine data, wherever the engine runs. */
export type EngineDb = {
  all(sql: string, ...params: unknown[]): Promise<unknown[]>;
  get(sql: string, ...params: unknown[]): Promise<unknown>;
};

/**
 * Local installs read the engine's SQLite file directly (fast, read-only).
 * Hosted deployments send the same read-only SELECT to the engine service.
 */
export async function getDb(workspaceId: string): Promise<EngineDb> {
  if (ENGINE_MODE !== "local") {
    const engine = wsEngine(workspaceId);
    const all = async (sql: string, ...params: unknown[]) =>
      (await engine.call<{ rows: unknown[] }>("query", { sql, params }, { timeoutMs: 60_000 })).rows;
    return { all, get: async (sql, ...params) => (await all(sql, ...params))[0] };
  }
  const db = await localDb(workspaceId);
  return {
    all: async (sql, ...params) => db.prepare(sql).all(...params),
    get: async (sql, ...params) => db.prepare(sql).get(...params),
  };
}

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
