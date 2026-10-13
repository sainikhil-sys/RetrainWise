import { money, version } from "./format";
import type { EventRow } from "./types";
import type { Tone } from "./format";

const ACTION: Record<string, string> = { defer: "defer", partial: "incremental update", full: "full retraining" };

/** Plain-language one-liners for audit events (the raw payload is always available too). */
export function describeEvent(e: EventRow): { text: string; tone: Tone } {
  const p = e.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.kind) {
    case "run_started":
      return { text: `Started a ${p.dataset} run (${Number(p.rows).toLocaleString()} rows, seed ${p.seed}); initial model ${version(p.version)} trained.`, tone: "accent" };
    case "batch_processed":
      return {
        text: `Batch ${p.batch} (rows ${p.rows?.[0]?.toLocaleString()}–${p.rows?.[1]?.toLocaleString()}): ${p.labels} labels revealed, status “${p.status}”${p.probe ? `; probe ran (${p.probe})` : ""}${p.avoidable != null ? `; avoidable staleness ${(p.avoidable * 100).toFixed(1)} pts` : ""}.`,
        tone: String(p.status).includes("predictive") ? "warn" : "neutral",
      };
    case "decision_created": {
      const nets = p.nets ? Object.entries(p.nets as Record<string, number>).map(([a, v]) => `${ACTION[a] ?? a} ${money(v)}`).join(", ") : "";
      return { text: `Decision ${p.decision}: recommends ${ACTION[p.recommended] ?? p.recommended}. Net values: ${nets}.`, tone: "info" };
    }
    case "approval":
      return { text: `${e.actor} approved ${ACTION[p.action] ?? p.action} for decision ${p.decision} (${p.mode}).`, tone: "info" };
    case "decision_promoted":
      return { text: `Candidate promoted: ${p.outcome}. Validation gate passed.`, tone: "good" };
    case "decision_rejected":
      return { text: `Candidate rejected for decision ${p.decision}: ${p.outcome}. Active model unchanged.`, tone: "bad" };
    case "decision_deferred":
      return { text: `Decision ${p.decision}: approved to keep the current model.`, tone: "good" };
    case "decision_failed":
      return { text: `Execution failed for decision ${p.decision}: ${p.outcome}.`, tone: "bad" };
    case "rollback":
      return { text: `${e.actor} rolled back ${version(p.from_version)} → ${version(p.to_version)}${p.reason ? `: ${p.reason}` : ""}.`, tone: "warn" };
    case "post_update_outcome":
      return {
        text: `Post-update check for ${version(p.version)}: predicted error reduction ${(p.predicted_reduction * 100).toFixed(1)} pts, realised ${(p.realized_reduction * 100).toFixed(1)} pts over ${p.n} labels.`,
        tone: p.realized_reduction > 0 ? "good" : "warn",
      };
    case "settings_saved":
      return { text: `Settings saved (${Object.keys(p.changed ?? {}).length} changed${p.stale_decisions ? `; ${p.stale_decisions} pending decision(s) marked stale` : ""}).`, tone: "neutral" };
    case "agent_report":
      return { text: `Agent report #${p.report} (${p.mode}) for decision ${p.decision}: ${p.status}.`, tone: p.status === "completed" ? "neutral" : "warn" };
    case "agent_tool_call":
      return { text: `Agent tool call ${p.tool} → ${p.status}.`, tone: p.status === "ok" ? "neutral" : "warn" };
    case "execution_request_prepared":
      return { text: `Agent prepared a request for ${ACTION[p.action] ?? p.action} on decision ${p.decision} (not executed).`, tone: "info" };
    case "execution_request_dismissed":
      return { text: `Request #${p.request} dismissed.`, tone: "neutral" };
    case "job_submitted":
      return { text: `Benchmark job ${p.job} queued.`, tone: "info" };
    case "job_completed":
      return { text: `Benchmark job ${p.job} completed (${p.result?.runs ?? "?"} runs).`, tone: "good" };
    case "job_failed":
      return { text: `Benchmark job ${p.job} failed.`, tone: "bad" };
    case "job_cancelled":
    case "job_cancel_requested":
      return { text: `Benchmark job ${p.job} ${e.kind === "job_cancelled" ? "cancelled" : "cancellation requested"}.`, tone: "warn" };
    case "job_interrupted":
      return { text: `Benchmark job ${p.job} interrupted (worker stopped).`, tone: "warn" };
    case "autonomy_held":
      return { text: `Bounded autonomy held back on decision ${p.decision}: ${p.reason}.`, tone: "neutral" };
    case "recovered_interrupted_executions":
      return { text: `${p.count} execution(s) interrupted by a restart were marked as interrupted.`, tone: "warn" };
    case "bridge_error":
      return { text: `Engine error in ${p.command}: ${p.error}`, tone: "bad" };
    default:
      return { text: e.kind.replace(/_/g, " "), tone: "neutral" };
  }
}
