import "server-only";

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

/**
 * Bridge to the Python lifecycle engine (engine/bridge.py).
 *
 * A single long-lived Python process ("serve" mode) handles lifecycle commands
 * one at a time, so batches, evaluations, executions and rollbacks can never
 * interleave. Slow, self-contained commands (dataset downloads, Ollama
 * explanations) run in a separate one-shot process so they do not block the
 * dashboard. Only allow-listed command names are sent; arguments are JSON and
 * never reach a shell.
 */

export const ENGINE_DIR = path.join(process.cwd(), "engine");
const BRIDGE = path.join(ENGINE_DIR, "bridge.py");

export type EngineErrorKind =
  | "forbidden"
  | "conflict"
  | "not_found"
  | "invalid"
  | "internal"
  | "unavailable"
  | "busy"
  | "timeout";

const STATUS: Record<EngineErrorKind, number> = {
  forbidden: 403,
  conflict: 409,
  not_found: 404,
  invalid: 400,
  internal: 500,
  unavailable: 503,
  busy: 409,
  timeout: 504,
};

export class EngineError extends Error {
  readonly kind: EngineErrorKind;
  readonly status: number;
  constructor(kind: EngineErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.status = STATUS[kind] ?? 500;
  }
}

export type Command =
  | "ping"
  | "llm_status"
  | "query"
  | "read_result_file"
  | "ollama_pull"
  | "start_run"
  | "process_batches"
  | "evaluate"
  | "execute"
  | "rollback"
  | "dismiss_request"
  | "save_settings"
  | "reset_settings"
  | "settings"
  | "datasets"
  | "dataset_preview"
  | "download_dataset"
  | "what_if"
  | "reference_window"
  | "explain"
  | "ollama_status"
  | "submit_job"
  | "cancel_job"
  | "recover_jobs"
  | "experiment_sets"
  | "experiment_results"
  | "experiment_traces"
  | "pricing"
  | "catalog"
  | "submit_training"
  | "training_options"
  | "revalidate_candidate"
  | "review_candidate"
  | "promote_candidate"
  | "create_request"
  | "reject_request"
  | "delete_job"
  | "result_file";

/** Human-readable labels for the "engine busy" indicator. */
export const COMMAND_LABELS: Partial<Record<Command, string>> = {
  ping: "Starting the Python engine",
  start_run: "Loading data and training the initial model",
  process_batches: "Predicting batches and updating monitors",
  evaluate: "Training candidates and scoring them on a chronological hold-out",
  execute: "Re-checking guardrails and validating the candidate",
  rollback: "Rolling back the active model",
  save_settings: "Saving settings",
  reset_settings: "Restoring default settings",
  dataset_preview: "Reading the dataset",
  download_dataset: "Downloading and caching the dataset",
  explain: "Generating an explanation",
  submit_job: "Queueing the benchmark job",
  experiment_results: "Aggregating experiment results",
  experiment_traces: "Reading per-batch traces",
  reference_window: "Loading the model artifact",
  what_if: "Re-ranking actions under new assumptions",
  submit_training: "Queueing the training job",
  revalidate_candidate: "Validating the candidate on withheld data",
  promote_candidate: "Promoting the validated model",
  review_candidate: "Recording the review",
};

type CallOptions = { timeoutMs?: number; dedupeKey?: string };

type Job = {
  id: number;
  command: Command;
  args: Record<string, unknown>;
  timeoutMs: number;
  dedupeKey?: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  enqueued: number;
};

export type EngineStatus = {
  state: "idle" | "starting" | "ready" | "failed";
  python: string | null;
  pythonSource: string | null;
  active: { command: Command; label: string; since: number } | null;
  queued: number;
  isolated: string[];
  lastError: string | null;
  info: Record<string, unknown> | null;
  stderrTail: string[];
};

/** Find the Python interpreter that has the engine's requirements installed. */
export function resolvePython(): { path: string; source: string } {
  const env = process.env.RETRAINWISE_PYTHON;
  if (env && env.trim()) return { path: env.trim(), source: "RETRAINWISE_PYTHON" };
  const win = process.platform === "win32";
  const venvPython = (dir: string) => path.join(dir, win ? "Scripts/python.exe" : "bin/python");
  const candidates: Array<[string, string]> = [
    [venvPython(path.join(ENGINE_DIR, ".venv")), "engine/.venv"],
    [venvPython(path.join(process.cwd(), ".venv")), ".venv"],
  ];
  // In the user folder (not AppData): visible even to packaged desktop apps,
  // whose terminals get a private copy of AppData.
  candidates.push([venvPython(path.join(os.homedir(), ".venvs", "retrainwise")), "~/.venvs/retrainwise"]);
  if (win) {
    // %LOCALAPPDATA% is missing in some shells and services; fall back to its usual location.
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    candidates.push([venvPython(path.join(local, "RetrainWise", "venv")), "%LOCALAPPDATA%\\RetrainWise\\venv"]);
  }
  for (const [file, source] of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ file)) return { path: file, source };
  }
  return { path: win ? "python" : "python3", source: "PATH" };
}

function toError(payload: { kind?: string; error?: string }): EngineError {
  const kind = (payload.kind as EngineErrorKind) || "internal";
  return new EngineError(kind in STATUS ? kind : "internal", payload.error || "Engine error");
}

class EngineDaemon {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private active: Job | null = null;
  private activeSince = 0;
  private timer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private state: EngineStatus["state"] = "idle";
  private lastError: string | null = null;
  private info: Record<string, unknown> | null = null;
  private stderr: string[] = [];
  private python = resolvePython();
  private recovered = false;
  readonly isolated = new Map<string, Command>();

  status(): EngineStatus {
    return {
      state: this.state,
      python: this.python.path,
      pythonSource: this.python.source,
      active: this.active
        ? { command: this.active.command, label: COMMAND_LABELS[this.active.command] ?? this.active.command, since: this.activeSince }
        : null,
      queued: this.queue.length,
      isolated: [...this.isolated.values()].map((c) => COMMAND_LABELS[c] ?? c),
      lastError: this.lastError,
      info: this.info,
      stderrTail: this.stderr.slice(-12),
    };
  }

  isBusy(key: string): boolean {
    return (
      this.active?.dedupeKey === key || this.queue.some((j) => j.dedupeKey === key) || this.isolated.has(key)
    );
  }

  call<T>(command: Command, args: Record<string, unknown> = {}, opts: CallOptions = {}): Promise<T> {
    if (opts.dedupeKey && this.isBusy(opts.dedupeKey)) {
      return Promise.reject(new EngineError("busy", "This action is already in progress. Wait for it to finish."));
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: this.nextId++,
        command,
        args,
        timeoutMs: opts.timeoutMs ?? 180_000,
        dedupeKey: opts.dedupeKey,
        resolve: resolve as (v: unknown) => void,
        reject,
        enqueued: Date.now(),
      });
      void this.pump();
    });
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.python = resolvePython();
    this.state = "starting";
    this.ready = new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (message: string) => {
        this.state = "failed";
        this.lastError = message;
        this.proc = null;
        this.ready = null;
        if (!settled) {
          settled = true;
          reject(new EngineError("unavailable", message));
        }
      };
      if (!fs.existsSync(BRIDGE)) return fail(`Engine bridge not found at ${BRIDGE}`);
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawn(/*turbopackIgnore: true*/ this.python.path, ["-B", "-u", BRIDGE, "serve"], {
          cwd: ENGINE_DIR,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
          windowsHide: true,
          shell: false,
        });
      } catch (err) {
        return fail(`Could not start Python (${this.python.path}): ${(err as Error).message}`);
      }
      this.proc = proc;
      const startTimer = setTimeout(() => {
        fail("The Python engine did not start within 180 seconds.");
        proc.kill();
      }, 180_000);
      proc.on("error", (err) => {
        clearTimeout(startTimer);
        fail(
          `Could not start Python (${this.python.path}): ${err.message}. ` +
            "Run `npm run setup:python` or set RETRAINWISE_PYTHON to an interpreter with engine/requirements.txt installed.",
        );
        this.failAll(new EngineError("unavailable", this.lastError ?? "Engine unavailable"));
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) if (line.trim()) this.stderr.push(line.slice(0, 400));
        if (this.stderr.length > 200) this.stderr.splice(0, this.stderr.length - 200);
      });
      proc.on("exit", (code, signal) => {
        clearTimeout(startTimer);
        const tail = this.stderr.slice(-4).join(" | ");
        const message = `Python engine exited (code ${code ?? "?"}${signal ? `, ${signal}` : ""})${tail ? `: ${tail}` : ""}`;
        if (!settled) fail(message);
        else {
          this.state = "failed";
          this.lastError = message;
        }
        this.proc = null;
        this.ready = null;
        this.recovered = false; // re-run recovery after a restart (an execution may have been cut off)
        this.failAll(new EngineError("unavailable", message));
      });
      const rl = readline.createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          this.stderr.push(`[non-protocol stdout] ${line.slice(0, 300)}`);
          return;
        }
        if (msg.ready) {
          clearTimeout(startTimer);
          settled = true;
          this.state = "ready";
          this.lastError = null;
          resolve();
          return;
        }
        this.onResponse(msg);
      });
    });
    return this.ready;
  }

  private failAll(error: Error) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const jobs = [...(this.active ? [this.active] : []), ...this.queue];
    this.active = null;
    this.queue = [];
    for (const j of jobs) j.reject(error);
  }

  private async pump(): Promise<void> {
    if (this.active || this.queue.length === 0) return;
    try {
      await this.start();
      if (!this.recovered) {
        // First command after (re)start: mark executions interrupted by a previous
        // process as such and make sure default settings exist.
        this.recovered = true;
        this.queue.unshift({
          id: this.nextId++,
          command: "ping",
          args: { recover: true },
          timeoutMs: 60_000,
          resolve: (v) => {
            this.info = v as Record<string, unknown>;
          },
          reject: () => {
            this.recovered = false;
          },
          enqueued: Date.now(),
        });
      }
    } catch (err) {
      this.failAll(err as Error);
      return;
    }
    if (this.active || this.queue.length === 0 || !this.proc) return;
    const job = this.queue.shift()!;
    this.active = job;
    this.activeSince = Date.now();
    this.timer = setTimeout(() => {
      const message = `${COMMAND_LABELS[job.command] ?? job.command} timed out after ${Math.round(job.timeoutMs / 1000)} s; the engine was restarted.`;
      this.lastError = message;
      this.active = null;
      job.reject(new EngineError("timeout", message));
      this.proc?.kill();
    }, job.timeoutMs);
    this.proc.stdin.write(JSON.stringify({ id: job.id, command: job.command, args: job.args }) + "\n");
  }

  private onResponse(msg: Record<string, unknown>) {
    const job = this.active;
    if (!job || msg.id !== job.id) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    if (msg.ok) job.resolve(msg.result);
    else job.reject(toError(msg as { kind?: string; error?: string }));
    void this.pump();
  }

  /** One-shot process for slow, self-contained commands. */
  async isolatedCall<T>(command: Command, args: Record<string, unknown>, key: string, timeoutMs: number, extraEnv: Record<string, string> = {}): Promise<T> {
    if (this.isBusy(key)) throw new EngineError("busy", "This action is already in progress. Wait for it to finish.");
    this.isolated.set(key, command);
    try {
      return await new Promise<T>((resolve, reject) => {
        const python = resolvePython();
        const proc = spawn(/*turbopackIgnore: true*/ python.path, ["-B", BRIDGE, "call", command], {
          cwd: ENGINE_DIR,
          env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1", ...extraEnv },
          windowsHide: true,
          shell: false,
        });
        let out = "";
        let err = "";
        const timer = setTimeout(() => {
          proc.kill();
          reject(new EngineError("timeout", `${COMMAND_LABELS[command] ?? command} timed out after ${Math.round(timeoutMs / 1000)} s.`));
        }, timeoutMs);
        proc.stdout.setEncoding("utf8");
        proc.stderr.setEncoding("utf8");
        proc.stdout.on("data", (c: string) => (out += c));
        proc.stderr.on("data", (c: string) => (err = (err + c).slice(-4000)));
        proc.on("error", (e) => {
          clearTimeout(timer);
          reject(new EngineError("unavailable", `Could not start Python (${python.path}): ${e.message}`));
        });
        proc.on("close", () => {
          clearTimeout(timer);
          const line = out.trim().split(/\r?\n/).pop() ?? "";
          try {
            const msg = JSON.parse(line);
            if (msg.ok) resolve(msg.result as T);
            else reject(toError(msg));
          } catch {
            reject(new EngineError("internal", `Engine returned no result. ${err.trim().split(/\r?\n/).slice(-3).join(" ")}`));
          }
        });
        proc.stdin.end(JSON.stringify(args));
      });
    } finally {
      this.isolated.delete(key);
    }
  }
}

const globalForEngine = globalThis as unknown as { __retrainwiseEngine?: EngineDaemon };

/** Shared engine instance (survives Next.js hot reloads in development). */
export function engine(): EngineDaemon {
  if (!globalForEngine.__retrainwiseEngine) globalForEngine.__retrainwiseEngine = new EngineDaemon();
  return globalForEngine.__retrainwiseEngine;
}

export function engineCall<T>(command: Command, args: Record<string, unknown> = {}, opts: CallOptions = {}) {
  return engine().call<T>(command, args, opts);
}

export type WsEngine = {
  call<T>(command: Command, args?: Record<string, unknown>, opts?: CallOptions): Promise<T>;
  isolated<T>(command: Command, args: Record<string, unknown>, key: string, timeoutMs: number, env?: Record<string, string>): Promise<T>;
  workspace: string;
};

/* ------------------------------------------------------------------ remote engine
 * Hosted deployments (for example Vercel) cannot run Python. They set
 * RETRAINWISE_ENGINE_URL and RETRAINWISE_ENGINE_TOKEN, and every command goes to
 * the engine service (engine/server.py) over HTTPS instead of a local process.
 */
const REMOTE_URL = (process.env.RETRAINWISE_ENGINE_URL || "").replace(/\/$/, "");

/** "local": Python on this machine; "remote": engine service; "missing": hosted without an engine. */
export const ENGINE_MODE: "local" | "remote" | "missing" = REMOTE_URL ? "remote" : process.env.VERCEL ? "missing" : "local";

const remoteInFlight = new Set<string>();

/**
 * Shared secret for the engine service: RETRAINWISE_ENGINE_TOKEN, or (when both
 * run on Vercel with the same Neon database) derived from the database URL, so
 * no token has to be copied between projects. Must match engine/app.py.
 */
function engineToken(): string {
  if (process.env.RETRAINWISE_ENGINE_TOKEN) return process.env.RETRAINWISE_ENGINE_TOKEN;
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || "";
  return url ? createHash("sha256").update(`retrainwise-engine-token:${url}`).digest("hex") : "";
}

async function remoteCall<T>(command: Command, args: Record<string, unknown>, opts: { timeoutMs?: number; dedupeKey?: string; isolated?: boolean; env?: Record<string, string> } = {}): Promise<T> {
  if (!REMOTE_URL) {
    throw new EngineError("unavailable", "The ML engine is not connected yet. Set RETRAINWISE_ENGINE_URL and RETRAINWISE_ENGINE_TOKEN for this deployment.");
  }
  if (opts.dedupeKey && remoteInFlight.has(opts.dedupeKey)) {
    throw new EngineError("busy", "This action is already in progress. Wait for it to finish.");
  }
  if (opts.dedupeKey) remoteInFlight.add(opts.dedupeKey);
  try {
    let res: Response;
    try {
      res = await fetch(`${REMOTE_URL}/call`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${engineToken()}` },
        body: JSON.stringify({ command, args, isolated: !!opts.isolated, env: opts.env }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
        cache: "no-store",
      });
    } catch (e) {
      const err = e as Error;
      throw new EngineError(err.name === "TimeoutError" ? "timeout" : "unavailable", `The ML engine service is not reachable (${err.message}).`);
    }
    if (res.status === 401) throw new EngineError("unavailable", "The ML engine service rejected this deployment's RETRAINWISE_ENGINE_TOKEN.");
    const msg = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; kind?: string; error?: string } | null;
    if (!msg) throw new EngineError("internal", `The ML engine service returned HTTP ${res.status}.`);
    if (msg.ok) return msg.result as T;
    throw toError(msg);
  } finally {
    if (opts.dedupeKey) remoteInFlight.delete(opts.dedupeKey);
  }
}

/** Status of the remote engine service for the status indicator. */
export async function remoteStatus(): Promise<Omit<EngineStatus, "stderrTail">> {
  const base = { python: null, pythonSource: ENGINE_MODE === "remote" ? "engine service" : null, active: null, queued: 0, isolated: [], info: null };
  if (!REMOTE_URL) return { ...base, state: "failed", lastError: "The ML engine is not connected yet." };
  try {
    const res = await fetch(`${REMOTE_URL}/health`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    return res.ok ? { ...base, state: "ready", lastError: null } : { ...base, state: "failed", lastError: `Engine service HTTP ${res.status}` };
  } catch (e) {
    return { ...base, state: "failed", lastError: `Engine service not reachable (${(e as Error).message})` };
  }
}

/** Engine client scoped to one workspace (its own engine database and artifacts). */
export function wsEngine(workspaceId: string): WsEngine {
  if (ENGINE_MODE !== "local") {
    return {
      workspace: workspaceId,
      call<T>(command: Command, args: Record<string, unknown> = {}, opts: CallOptions = {}) {
        return remoteCall<T>(command, { ...args, workspace: workspaceId }, { timeoutMs: opts.timeoutMs, dedupeKey: opts.dedupeKey ? `${workspaceId}:${opts.dedupeKey}` : undefined });
      },
      isolated<T>(command: Command, args: Record<string, unknown>, key: string, timeoutMs: number, env?: Record<string, string>) {
        return remoteCall<T>(command, { ...args, workspace: workspaceId }, { timeoutMs, dedupeKey: `${workspaceId}:${key}`, isolated: true, env });
      },
    };
  }
  return {
    workspace: workspaceId,
    call<T>(command: Command, args: Record<string, unknown> = {}, opts: CallOptions = {}) {
      return engine().call<T>(command, { ...args, workspace: workspaceId }, {
        ...opts,
        dedupeKey: opts.dedupeKey ? `${workspaceId}:${opts.dedupeKey}` : undefined,
      });
    },
    isolated<T>(command: Command, args: Record<string, unknown>, key: string, timeoutMs: number, env?: Record<string, string>) {
      return engine().isolatedCall<T>(command, { ...args, workspace: workspaceId }, `${workspaceId}:${key}`, timeoutMs, env);
    },
  };
}

export function workspaceDir(workspaceId: string) {
  if (!/^[a-z0-9]{8,40}$/.test(workspaceId)) throw new EngineError("invalid", "Invalid workspace id");
  // RETRAINWISE_WORKSPACES_DIR puts engine state on a persistent disk in production (must match engine/config.py).
  return path.join(/*turbopackIgnore: true*/ process.env.RETRAINWISE_WORKSPACES_DIR || path.join(ENGINE_DIR, "workspaces"), workspaceId);
}
