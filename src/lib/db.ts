import "server-only";

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import { ENGINE_DIR, engineCall } from "./engine";

/**
 * Read-only access to the engine's SQLite database (engine/retrainwise.db).
 *
 * SQLite is the single source of truth. The web server only reads it directly;
 * every write goes through the Python engine, which wraps changes in
 * BEGIN IMMEDIATE transactions. WAL mode lets these reads run while the engine
 * or a benchmark worker is writing.
 */
export const DB_PATH = path.join(ENGINE_DIR, "retrainwise.db");

const globalForDb = globalThis as unknown as { __retrainwiseDb?: Database.Database };

function open(): Database.Database {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return db;
}

/** True when the schema exists (the engine creates it on first start). */
function hasSchema(db: Database.Database): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('runs','events','settings')").get() as { n: number };
  return row.n === 3;
}

export async function getDb(): Promise<Database.Database> {
  const cached = globalForDb.__retrainwiseDb;
  if (cached && cached.open) return cached;
  if (!fs.existsSync(DB_PATH)) {
    // First start: the engine creates the schema and default settings.
    await engineCall("ping", {}, { timeoutMs: 180_000 });
  }
  let db = open();
  if (!hasSchema(db)) {
    db.close();
    await engineCall("ping", {}, { timeoutMs: 180_000 });
    db = open();
  }
  globalForDb.__retrainwiseDb = db;
  return db;
}

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
