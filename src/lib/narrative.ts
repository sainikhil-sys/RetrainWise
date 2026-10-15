import { describeEvent } from "./events";
import type { Tone as EventTone } from "./format";
import type { Decision, EventRow, ModelRow, Run, Settings, Telemetry } from "./types";

/** Plain-language summaries shared by the dashboard pages. */

export type UiTone = "ok" | "warn" | "bad" | "neutral" | "info";

export function toUiTone(t: EventTone): UiTone {
  return ({ good: "ok", warn: "warn", bad: "bad", info: "info", neutral: "neutral", accent: "info" } as const)[t];
}

export function v(version: number | null | undefined) {
  return version == null ? "—" : `v${String(version).padStart(3, "0")}`;
}

/** One sentence describing the model's current state. */
export function stateSentence(run: Run | null, tel: Telemetry[]): string {
  if (!run) return "No model is being monitored yet. Start a stream to deploy an initial model.";
  const last = tel.at(-1);
  if (!last) return `Model ${v(run.active_version)} is deployed on ${run.dataset}. Process the first batch to start collecting evidence.`;
  const age = run.batch_index - run.last_update_batch;
  const running = `This model has been running for ${age} batch${age === 1 ? "" : "es"}.`;
  if (run.active_version !== last.version) return `Model ${v(run.active_version)} was just promoted. Process the next batch to refresh evidence.`;
  const st = last.staleness;
  if (st?.available && st.classification === "avoidable staleness")
    return `${running} A fresh model makes ${((st.did ?? 0) * 100).toFixed(1)} pts fewer errors on the same data — avoidable staleness.`;
  if (st?.available && st.classification === "task harder for all models")
    return `${running} Errors rose for every model, so the task got harder rather than the model staler.`;
  if (last.covariate_signal && !last.predictive_signal) return `${running} Feature distribution changed, but predictive degradation is not confirmed.`;
  if (last.predictive_signal) return `${running} Predictive degradation is confirmed by label-based evidence.`;
  if (last.status.includes("insufficient")) return `${running} Not enough labels yet to judge performance.`;
  return `${running} Error is within its reference range.`;
}

/** Operational risk of continuing with the current model. */
export function riskLevel(run: Run | null, tel: Telemetry[], settings: Settings): { tone: UiTone; label: string; reason: string } {
  if (!run) return { tone: "neutral", label: "No model", reason: "Nothing is deployed." };
  const last = tel.at(-1);
  const budgetUsed = settings.budget > 0 ? run.spent / settings.budget : 0;
  if (budgetUsed > 0.9) return { tone: "bad", label: "High", reason: `${Math.round(budgetUsed * 100)}% of the budget is spent; updates may be blocked.` };
  if (!last) return { tone: "neutral", label: "Unknown", reason: "No evidence yet." };
  const avoidable = last.staleness?.available && last.staleness.classification === "avoidable staleness";
  if (last.predictive_signal && avoidable) return { tone: "bad", label: "High", reason: "Errors are up and a fresh model would avoid part of them." };
  if (last.predictive_signal || avoidable) return { tone: "warn", label: "Elevated", reason: avoidable ? "The probe shows avoidable staleness." : "Label-based detectors confirm degradation." };
  if (last.covariate_signal) return { tone: "warn", label: "Watch", reason: "Inputs shifted; accuracy impact not confirmed." };
  return { tone: "ok", label: "Low", reason: "Error is within its reference range." };
}

export type Step = { key: string; title: string; text: string; href?: string; action?: "start" | "batch" | "evaluate" | "train" | "benchmark" };

/** The single most useful next action. */
export function nextStep(opts: { run: Run | null; tel: Telemetry[]; decision: Decision | null; candidates: number; canOperate: boolean; canApprove: boolean }): Step {
  const { run, tel, decision, candidates, canOperate, canApprove } = opts;
  if (!run) return { key: "start", title: "Start a monitored stream", text: "Deploy an initial model on a synthetic or real dataset.", href: "/data", action: canOperate ? "start" : undefined };
  if (!tel.length) return { key: "batch", title: "Process the first batch", text: "The model predicts first; labels arrive afterwards and feed the monitors.", action: canOperate ? "batch" : undefined };
  if (decision?.status === "pending" && decision.recommended !== "defer")
    return {
      key: "review",
      title: canApprove ? "Review the recommendation before approving an update" : "An update is recommended",
      text: canApprove ? "Check the evidence, costs and guardrails, then approve or reject." : "Request it for review; an approver decides.",
      href: "/decisions",
    };
  if (candidates > 0) return { key: "candidates", title: "Validate and review trained candidates", text: `${candidates} trained model${candidates === 1 ? " is" : "s are"} waiting. Validation is required before promotion.`, href: "/models" };
  if (run.position >= run.n_rows) return { key: "benchmark", title: "Compare policies on this data", text: "The stream has ended. Run a reproducible benchmark.", href: "/experiments", action: canOperate ? "benchmark" : undefined };
  if (tel.at(-1)?.evaluation_suggested) return { key: "evaluate", title: "Evaluate update options", text: (tel.at(-1)?.trigger_reasons ?? []).join("; ") + ".", action: canOperate ? "evaluate" : undefined };
  return { key: "batch", title: "Process the next batch to refresh evidence", text: "No action is recommended yet.", action: canOperate ? "batch" : undefined };
}

/** Lifecycle stage for the Detect → Evaluate → Approve → Update → Monitor strip. */
export function lifecycleStage(run: Run | null, tel: Telemetry[], decision: Decision | null): number {
  if (!run || !tel.length) return 0;
  if (decision?.status === "pending") return 2;
  if (run.post_update) return 4;
  if (tel.at(-1)?.evaluation_suggested) return 1;
  return 0;
}

export function timelineFromEvents(events: EventRow[]) {
  return events.map((e) => {
    const d = describeEvent(e);
    return { id: e.id, title: d.text, tone: toUiTone(d.tone), tag: e.kind, actor: e.actor, created: e.created };
  });
}

export function chartAnnotations(tel: Telemetry[], registry: ModelRow[], decisions: { position: number; recommended: string; status: string }[]) {
  const byVersion = new Map(registry.map((m) => [m.version, m]));
  const out: { x: number; label: string; kind: "retrain" | "partial" | "alarm" | "decision" | "promotion" | "rollback" }[] = [];
  for (let i = 1; i < tel.length; i++) {
    if (tel[i].version !== tel[i - 1].version) {
      const m = byVersion.get(tel[i].version);
      const kind = m?.action === "partial" ? "partial" : m?.status === "active" && m.action === "initial" ? "rollback" : m?.action === "trained" ? "promotion" : "retrain";
      out.push({ x: tel[i].start_row, label: `${v(tel[i].version)}${m?.action === "partial" ? " partial" : m?.action === "full" ? " retrain" : ""}`, kind });
    }
  }
  let streak = false;
  for (const t of tel) {
    const alarm = t.adwin_error_increase || t.ddm_status === "drift";
    if (alarm && !streak) out.push({ x: t.end_row, label: "drift alarm", kind: "alarm" });
    streak = alarm;
  }
  for (const d of decisions.slice(0, 4)) if (d.recommended !== "defer") out.push({ x: d.position, label: "decision", kind: "decision" });
  return out.slice(-10);
}
