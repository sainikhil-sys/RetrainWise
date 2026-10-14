"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/components/client";
import { explain } from "@/lib/agent";
import { AuthError } from "@/lib/auth/auth";
import { auth, requireUser } from "@/lib/auth/session";
import { DEFAULT_SETTINGS, replaceSettings, settingsFrom, type Settings } from "@/lib/config";
import { download } from "@/lib/datasets";
import { ACTION_LABELS, rankActions, type Action } from "@/lib/economics";
import type { Policy } from "@/lib/experiments";
import { cancel, submit } from "@/lib/jobs";
import { lifecycle } from "@/lib/lifecycle";
import type { Evidence } from "@/lib/ml/models";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Run `fn` for the signed-in user; refresh every page on success; turn known errors into messages. */
async function act(fn: (actor: string) => string | Promise<string>): Promise<ActionState> {
  const user = await requireUser();
  try {
    const message = await fn(user.email);
    revalidatePath("/", "layout");
    return { ok: true, message };
  } catch (exc) {
    if (exc instanceof Error && !("digest" in exc)) return { ok: false, message: exc.message };
    throw exc;
  }
}

export async function startDemoAction(): Promise<ActionState> {
  return act((actor) => {
    const life = lifecycle();
    const run = life.startRun("synthetic", "standard", life.settings().seed, actor);
    return `Demo run ${run.id} started. Process a few batches next.`;
  });
}

export async function startRunAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    const life = lifecycle();
    if (life.activeRun() && form.get("confirm") !== "on") throw new Error("Tick the box to close the current run first.");
    const seed = Number(field(form, "seed"));
    if (!Number.isInteger(seed) || seed < 0) throw new Error("Seed must be a non-negative integer.");
    const run = life.startRun(field(form, "dataset"), field(form, "size"), seed, actor);
    return `Run ${run.id} started on ${run.dataset} (${run.n_rows.toLocaleString("en-US")} rows).`;
  });
}

export async function downloadDatasetAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const info = await download(field(form, "dataset"));
    return `Cached ${Number(info.rows).toLocaleString("en-US")} rows (sha256 ${String(info.cache_sha256).slice(0, 12)}…).`;
  });
}

export async function processBatchesAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    const life = lifecycle();
    const run = life.activeRun();
    if (!run) throw new Error("No active run.");
    const n = Math.min(40, Math.max(1, Math.trunc(Number(field(form, "n")) || 1)));
    let done = 0;
    const notes: string[] = [];
    for (let i = 0; i < n; i++) {
      const current = life.run(run.id)!;
      if (current.position >= current.n_rows) break;
      const out = life.processBatch(run.id, current.position, actor);
      if (!out.noop) done += 1;
      if (out.autonomy?.acted) notes.push(`bounded autonomy executed ${out.autonomy.status} (${out.autonomy.outcome})`);
    }
    return `Processed ${done} batch(es).${notes.length ? ` ${notes.join("; ")}.` : ""}`;
  });
}

export async function evaluateAction(): Promise<ActionState> {
  return act((actor) => {
    const life = lifecycle();
    const run = life.activeRun();
    if (!run) throw new Error("No active run.");
    const d = life.evaluate(run.id, actor);
    return `Decision ${d.id}: recommend ${ACTION_LABELS[d.recommended]}.`;
  });
}

export async function executeAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    if (form.get("approve") !== "on") throw new Error("Tick the approval box to confirm.");
    const result = lifecycle().execute(field(form, "decision_id"), field(form, "action") as Action, actor, true);
    return `Outcome: ${result.status} - ${result.outcome}`;
  });
}

export async function approveRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    const result = lifecycle().execute(field(form, "decision_id"), field(form, "action") as Action, actor, true, "manual",
      Number(field(form, "request_id")));
    return `Request #${field(form, "request_id")}: ${result.status} - ${result.outcome}`;
  });
}

export async function dismissRequestAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    lifecycle().dismissRequest(Number(field(form, "request_id")), actor);
    return `Request #${field(form, "request_id")} dismissed.`;
  });
}

export async function rollbackAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    const version = Number(field(form, "version"));
    lifecycle().rollback(version, actor, form.get("approve") === "on", field(form, "reason"));
    return `Rolled back to v${String(version).padStart(3, "0")}.`;
  });
}

export async function submitJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    const seeds = field(form, "seeds").replace(/\s+/g, "").split(",").filter(Boolean).map(Number);
    const [id, created] = submit(lifecycle().db, {
      datasets: form.getAll("datasets").map(String), policies: form.getAll("policies").map(String) as Policy[],
      regimes: form.getAll("regimes").map(String), seeds, size: field(form, "size"),
      settings: lifecycle().settings() as unknown as Record<string, unknown>,
    }, actor);
    return `Job ${id} ${created ? "started" : "is already running with the same settings"}.`;
  });
}

export async function cancelJobAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => (cancel(lifecycle().db, field(form, "job_id"), actor) ? "Cancellation requested."
    : "The job is no longer running."));
}

export async function explainAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act(async () => {
    const life = lifecycle();
    const run = life.activeRun();
    const d = run ? life.latestDecision(run.id) : null;
    if (!d) throw new Error("Create a decision in Decision analysis first.");
    const mode = field(form, "mode") === "ollama" ? "ollama" : "deterministic";
    const result = await explain(life, d, mode, field(form, "model") || life.settings().ollama_model);
    return `Report #${result.report_id} (${result.status}, ${result.duration_seconds.toFixed(1)}s).`;
  });
}

const BOOLEAN_FIELDS = new Set(["autonomy"]);
const TEXT_FIELDS = new Set(["regime", "cost_trace_kind", "agent_mode", "ollama_model", "estimator"]);

export async function saveSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  return act((actor) => {
    const life = lifecycle();
    const data: Record<string, unknown> = { ...life.settings() };
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (BOOLEAN_FIELDS.has(key)) data[key] = form.get(key) === "on";
      else if (key === "cost_trace_custom") {
        if (form.has(key)) data[key] = field(form, key).replace(/\s+/g, "").split(",").filter(Boolean).map(Number);
      } else if (form.has(key)) data[key] = TEXT_FIELDS.has(key) ? field(form, key) : Number(field(form, key));
    }
    life.saveSettings(settingsFrom(data), actor);
    return "Settings saved. Pending decisions were marked stale.";
  });
}

export async function resetSettingsAction(): Promise<ActionState> {
  return act((actor) => {
    const life = lifecycle();
    life.saveSettings(replaceSettings(DEFAULT_SETTINGS, { seed: life.settings().seed }), actor);
    return "Defaults restored.";
  });
}

export async function changePasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  try {
    auth().changePassword(user.email, field(form, "current"), field(form, "password"), field(form, "confirm"));
    return { ok: true, message: "Password updated." };
  } catch (exc) {
    if (exc instanceof AuthError) return { ok: false, message: exc.message };
    throw exc;
  }
}

export interface WhatIfResult {
  recommended: string;
  rows: { action: string; net: number; feasible: boolean }[];
}

/** Informational re-ranking of a stored decision under different assumptions (nothing is saved). */
export async function whatIfAction(decisionId: string, errorMult: number, horizonMult: number,
  regime: Settings["regime"]): Promise<WhatIfResult> {
  await requireUser();
  const life = lifecycle();
  const d = life.decision(decisionId);
  if (!d) throw new Error("Unknown decision");
  const cfg = life.settings();
  const alt = replaceSettings(cfg, { error_value: cfg.error_value * errorMult, regime,
    horizon_predictions: Math.max(1, Math.trunc(cfg.horizon_predictions * horizonMult)) });
  const evidence = Object.fromEntries(d.ranked.filter((r) => r.action !== "defer").map((r) => [r.action, r.evidence as Evidence]));
  const what = rankActions(evidence, { ...d.context, horizon: alt.horizon_predictions }, alt);
  return { recommended: ACTION_LABELS[what.recommended],
    rows: what.ranked.map((r) => ({ action: r.label, net: r.net_value, feasible: r.feasible })) };
}
