/**
 * SQLite persistence: the source of truth for runs, telemetry, registry,
 * decisions, approvals, agent evidence, jobs, accounts and the audit log.
 *
 * Every write goes through `tx` (BEGIN IMMEDIATE) so concurrent requests and
 * background jobs cannot interleave partial updates.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, LOG_PATH } from "./config";

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
    password_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL,
    last_login TEXT, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT);
CREATE TABLE IF NOT EXISTS auth_codes(
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS auth_codes_lookup ON auth_codes(email, purpose, id);
CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created TEXT NOT NULL,
    expires TEXT NOT NULL, last_seen TEXT NOT NULL);
`;

export type Row = Record<string, unknown>;
export type DB = Database.Database;

export function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

/** Strict JSON: non-finite numbers become null; typed arrays become plain arrays. */
export function dumps(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) return Array.from(v as unknown as ArrayLike<number>);
    if (v instanceof Set) return Array.from(v);
    return v;
  });
}

export function loads<T = unknown>(text: unknown): T {
  return (typeof text === "string" && text ? JSON.parse(text) : null) as T;
}

export function log(kind: string, fields: Record<string, unknown> = {}): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, dumps({ time: now(), kind, ...fields }) + "\n");
  } catch {
    // logging must never break the application
  }
}

export class Store {
  readonly path: string;
  readonly db: DB;

  constructor(file: string = DB_PATH) {
    this.path = file;
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file, { timeout: 30_000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  /** Run `fn` inside BEGIN IMMEDIATE ... COMMIT (rolled back on any throw). */
  tx<T>(fn: (db: DB) => T): T {
    return this.db.transaction(() => fn(this.db)).immediate();
  }

  all<T = Row>(sql: string, ...args: unknown[]): T[] {
    return this.db.prepare(sql).all(...args) as T[];
  }

  one<T = Row>(sql: string, ...args: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined;
  }

  run(sql: string, ...args: unknown[]): Database.RunResult {
    return this.db.prepare(sql).run(...args);
  }

  getSetting<T>(key: string, fallback: T): T {
    const row = this.one<{ value: string }>("SELECT value FROM settings WHERE key=?", key);
    return row ? (JSON.parse(row.value) as T) : fallback;
  }

  putSetting(key: string, value: unknown): void {
    this.run("INSERT INTO settings(key,value,updated) VALUES(?,?,?) " +
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated", key, dumps(value), now());
  }

  event(kind: string, payload: Record<string, unknown>, runId: string | null = null, actor = "system"): void {
    this.run("INSERT INTO events(created,kind,run_id,actor,payload) VALUES(?,?,?,?,?)",
      now(), kind, runId, actor, dumps(payload));
    log(kind, { run_id: runId, actor });
  }
}

const globalStore = globalThis as unknown as { __rwStore?: Store };

/** Process-wide store (survives Next.js dev hot reloads). */
export function store(): Store {
  if (!globalStore.__rwStore) globalStore.__rwStore = new Store();
  return globalStore.__rwStore;
}
