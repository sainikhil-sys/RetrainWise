import { ident, route } from "@/lib/api";
import { ACTION_LABELS } from "@/lib/catalog";
import { notify } from "@/lib/notify";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Probe evidence + shadow evaluation of candidates; ranks keep / partial / full. */
export const POST = route<{ id: string }>(
  async (_req, { id }, ctx) => {
    const runId = ident.parse(id);
    const r = await ctx.engine.call<{ id: string; recommended: keyof typeof ACTION_LABELS; charged: boolean; note: string | null }>(
      "evaluate",
      { run_id: runId, actor: ctx.user.email },
      { timeoutMs: 600_000, dedupeKey: `evaluate:${runId}` },
    );
    if (r.recommended !== "defer") {
      await notify({
        workspaceId: ctx.workspace.id,
        kind: "decision",
        title: `${ACTION_LABELS[r.recommended]} recommended`,
        body: `Decision ${r.id} needs review before any update.`,
        href: "/decisions",
        dedupeKey: `decision:${r.id}`,
      });
    }
    reportFor(ctx, {
      kind: "decision_made",
      title: r.recommended === "defer" ? "Evaluation complete: keep the existing model" : `Evaluation complete: ${ACTION_LABELS[r.recommended]} recommended`,
      summary:
        r.recommended === "defer"
          ? "No update cleared every guardrail with a positive net value, so keeping the current model is the lowest-cost option."
          : "Candidates were trained on earlier rows and scored on the newest labelled rows. An approver must accept before anything changes in production.",
      status: r.recommended === "defer" ? { label: "No action", tone: "neutral" } : { label: "Needs approval", tone: "warn" },
      facts: [["Decision", r.id], ["Recommendation", ACTION_LABELS[r.recommended]], ["Shadow evaluation", r.charged ? "run (cost charged once)" : r.note ?? "not run"]],
      href: "/decisions",
      ctaLabel: "Review the decision",
    });
    return r;
  },
  { permission: "stream.operate" },
);
