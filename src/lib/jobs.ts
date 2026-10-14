/**
 * Long-running benchmark jobs. Jobs run inside the server process (yielding to
 * the event loop between batches) and record progress, heartbeats,
 * cancellation and failures in SQLite. Requests are deduplicated and only one
 * job runs at a time. Jobs are NOT resumable: after a restart, jobs whose
 * heartbeat stopped are marked `interrupted` and must be submitted again.
 */
import crypto from "node:crypto";
import { REGIMES, SAMPLE_SIZES, settingsFrom } from "./config";
import { dumps, loads, now, type Store } from "./db";
import { DATASETS, isCached } from "./datasets";
import { benchmark, Cancelled, POLICIES, type Policy } from "./experiments";

export const STALE_AFTER_SECONDS = 45;
export const MAX_RUNS_PER_JOB = 400;

export interface JobPayload {
  datasets: string[];
  policies: Policy[];
  regimes: string[];
  seeds: number[];
  size: string;
  settings: Record<string, unknown>;
}

export interface Job {
  id: string;
  created: string;
  kind: string;
  status: string;
  progress: number;
  message: string | null;
  cancel_requested: number;
  heartbeat: string | null;
  payload: JobPayload;
  result: { files: string[]; runs: number; wall_seconds: number; prefix: string } | null;
  error: string | null;
  finished: string | null;
}

const globalJobs = globalThis as unknown as { __rwJobs?: Set<string> };
const running = (globalJobs.__rwJobs ??= new Set<string>()); // job ids executing in this process

export function validatePayload(payload: Partial<JobPayload>): JobPayload {
  const datasets = [...(payload.datasets || [])];
  const policies = [...(payload.policies || [])] as Policy[];
  const regimes = [...(payload.regimes || [])];
  const seeds = (payload.seeds || []).map(Number);
  const size = String(payload.size || "");
  if (!datasets.length || datasets.some((d) => !DATASETS.includes(d))) throw new Error("Choose datasets from the supported list");
  const missing = datasets.filter((d) => !isCached(d));
  if (missing.length) throw new Error(`Download ${missing.join(", ")} first; synthetic data is never substituted`);
  if (!policies.length || policies.some((p) => !POLICIES.includes(p))) throw new Error("Choose at least one valid policy");
  if (!regimes.length || regimes.some((r) => !(REGIMES as readonly string[]).includes(r))) {
    throw new Error("Choose at least one valid cost regime");
  }
  if (!seeds.length || seeds.length > 10 || new Set(seeds).size !== seeds.length ||
    seeds.some((s) => !Number.isInteger(s) || s < 0 || s > 2 ** 31)) {
    throw new Error("Provide 1-10 distinct non-negative integer seeds");
  }
  if (!(size in SAMPLE_SIZES)) throw new Error("Unknown sample size");
  const runs = datasets.length * policies.length * regimes.length * seeds.length;
  if (runs > MAX_RUNS_PER_JOB) throw new Error(`${runs} runs requested; the limit per job is ${MAX_RUNS_PER_JOB}`);
  const settings = settingsFrom(payload.settings || {});
  return { datasets, policies, regimes, seeds, size, settings: settings as unknown as Record<string, unknown> };
}

function ageSeconds(stamp: string | null): number {
  return stamp ? (Date.now() - Date.parse(stamp)) / 1000 : Number.POSITIVE_INFINITY;
}

/** Mark jobs that are not running in this process and stopped heart-beating as interrupted. */
export function recover(db: Store): number {
  let marked = 0;
  for (const job of db.all<{ id: string; heartbeat: string | null; created: string }>(
    "SELECT id, heartbeat, created FROM jobs WHERE status IN ('queued','running')")) {
    if (running.has(job.id)) continue;
    if (ageSeconds(job.heartbeat) > STALE_AFTER_SECONDS && ageSeconds(job.created) > STALE_AFTER_SECONDS) {
      db.tx(() => {
        const n = db.run("UPDATE jobs SET status='interrupted', finished=?, error=? WHERE id=? AND status IN " +
          "('queued','running')", now(), "Job stopped without finishing (server restart or crash). Jobs are not " +
          "resumable; submit it again.", job.id).changes;
        if (n) db.event("job_interrupted", { job: job.id });
        marked += n;
      });
    }
  }
  return marked;
}

/** Queue a job and start it. Returns [jobId, created]. */
export function submit(db: Store, raw: Partial<JobPayload>, actor = "user", launch = true): [string, boolean] {
  const payload = validatePayload(raw);
  const digest = crypto.createHash("sha256").update(dumps(payload)).digest("hex");
  recover(db);
  const [id, created] = db.tx((): [string, boolean] => {
    const same = db.one<{ id: string }>("SELECT id FROM jobs WHERE payload_hash=? AND status IN ('queued','running')", digest);
    if (same) return [same.id, false];
    if (db.one("SELECT 1 FROM jobs WHERE status IN ('queued','running')")) {
      throw new Error("Another job is running; wait for it or cancel it first");
    }
    const jobId = crypto.randomBytes(5).toString("hex");
    db.run("INSERT INTO jobs(id,created,kind,status,progress,message,payload,payload_hash,heartbeat) VALUES " +
      "(?,?,?,?,?,?,?,?,?)", jobId, now(), "benchmark", "queued", 0, "queued", dumps(payload), digest, now());
    db.event("job_submitted", { job: jobId, payload }, null, actor);
    return [jobId, true];
  });
  if (created && launch) void runJob(db, id);
  return [id, created];
}

/** Execute one queued job in this process. */
export async function runJob(db: Store, jobId: string): Promise<string> {
  const claimed = db.tx(() => db.run("UPDATE jobs SET status='running', heartbeat=?, message='starting' WHERE id=? AND " +
    "status='queued'", now(), jobId).changes);
  if (!claimed) return "not claimed";
  running.add(jobId);
  const row = db.one<{ payload: string }>("SELECT payload FROM jobs WHERE id=?", jobId)!;
  const payload = loads<JobPayload>(row.payload);
  let lastBeat = 0;
  let lastCancelCheck = 0;
  let cancelled = false;
  const heartbeat = setInterval(() => db.run("UPDATE jobs SET heartbeat=? WHERE id=?", now(), jobId), 5_000);
  const prefix = `experiment_${jobId}`;
  let status: string;
  let outcome: Job["result"] = null;
  let error: string | null = null;
  try {
    const result = await benchmark({
      datasets: payload.datasets, size: payload.size, seeds: payload.seeds, regimes: payload.regimes,
      policies: payload.policies, settings: settingsFrom(payload.settings), prefix,
      progress: (fraction, message) => {
        if (Date.now() - lastBeat < 500 && fraction < 1) return;
        lastBeat = Date.now();
        db.run("UPDATE jobs SET progress=?, message=?, heartbeat=? WHERE id=?", fraction, message.slice(0, 200), now(), jobId);
      },
      cancel: () => {
        if (Date.now() - lastCancelCheck > 500) {
          lastCancelCheck = Date.now();
          cancelled = Boolean(db.one<{ c: number }>("SELECT cancel_requested AS c FROM jobs WHERE id=?", jobId)?.c);
        }
        return cancelled;
      },
    });
    status = "completed";
    outcome = { files: result.files, runs: result.summary.length, wall_seconds: result.wall_seconds, prefix };
  } catch (exc) {
    if (exc instanceof Cancelled) {
      status = "cancelled";
      error = "Cancelled by user; partial results were not written.";
    } else {
      status = "failed";
      error = `${(exc as Error).name}: ${(exc as Error).message}\n${((exc as Error).stack || "").slice(-1500)}`;
    }
  } finally {
    clearInterval(heartbeat);
    running.delete(jobId);
  }
  db.tx(() => {
    db.run("UPDATE jobs SET status=?, result=?, error=?, finished=?, progress=CASE WHEN ?='completed' THEN 1.0 ELSE " +
      "progress END, message=? WHERE id=?", status, outcome ? dumps(outcome) : null, error, now(), status, status, jobId);
    db.event(`job_${status}`, { job: jobId, result: outcome, error: (error || "").slice(0, 300) }, null, "worker");
  });
  return status;
}

export function cancel(db: Store, jobId: string, actor = "user"): boolean {
  return db.tx(() => {
    const n = db.run("UPDATE jobs SET cancel_requested=1, message='cancellation requested' WHERE id=? AND status IN " +
      "('queued','running')", jobId).changes;
    if (n) db.event("job_cancel_requested", { job: jobId }, null, actor);
    return n > 0;
  });
}

export function listJobs(db: Store, limit = 20): Job[] {
  return db.all<Record<string, unknown>>("SELECT * FROM jobs ORDER BY created DESC LIMIT ?", limit).map((r) => ({
    ...(r as unknown as Job), payload: loads<JobPayload>(r.payload), result: loads(r.result),
  }));
}
