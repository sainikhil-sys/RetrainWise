import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { Store } from "@/lib/db";
import { clearCaches } from "@/lib/lifecycle";

export const FAST = { batch_size: 250, initial_size: 500, train_window: 1500, min_evidence: 60, rolling_window: 500,
  post_update_window: 200 };

/** A fresh temporary directory and SQLite store per test. */
export function useTempStore(): { dir: () => string; db: () => Store } {
  let dir = "";
  let db: Store | null = null;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rw-test-"));
    db = new Store(path.join(dir, "t.db"));
  });
  afterEach(() => {
    db?.db.close();
    clearCaches();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir: () => dir, db: () => db! };
}
