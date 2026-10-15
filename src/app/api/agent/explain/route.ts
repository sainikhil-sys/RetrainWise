import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/queries";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

const Explain = z.object({ decisionId: ident, mode: z.enum(["deterministic", "ollama", "openai"]), model: z.string().regex(/^[A-Za-z0-9._:/@-]{1,120}$/).optional() });

/**
 * Generate an advisory explanation. The agent reads telemetry, registry, probe
 * results, pricing and evaluations through bounded read-only tools and may only
 * prepare a request, which is routed to approvers.
 */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, Explain);
    const args = { decision_id: b.decisionId, mode: b.mode, model: b.model };
    let r: { report_id: number; requests_prepared: number[] };
    if (b.mode !== "deterministic") {
      const settings = await getSettings(ctx.workspace.id);
      r = await ctx.engine.isolated("explain", args, `explain:${b.decisionId}`, (settings.agent_timeout_seconds + 90) * 1000);
    } else {
      r = await ctx.engine.call("explain", args, { timeoutMs: 120_000, dedupeKey: `explain:${b.decisionId}` });
    }
    for (const id of r.requests_prepared ?? []) {
      await notify({
        workspaceId: ctx.workspace.id,
        kind: "approval",
        permission: "action.approve",
        title: `Agent prepared request #${id}`,
        body: "Advisory only. An approver must review it before anything changes.",
        href: "/lifecycle",
        dedupeKey: `agent-request:${id}`,
      });
    }
    reportFor(ctx, {
      kind: "agent_report",
      title: `Agent report #${r.report_id} ready`,
      summary: "The advisory agent explained the decision from stored evidence. It cannot approve or change anything.",
      status: { label: b.mode === "ollama" ? "Ollama model" : b.mode === "openai" ? "Open-source model" : "Deterministic", tone: "neutral" },
      facts: [["Decision", b.decisionId], ["Mode", b.mode + (b.model ? ` · ${b.model}` : "")], ["Requests prepared", r.requests_prepared?.length ? r.requests_prepared.map((x) => `#${x}`).join(", ") : "none"]],
      href: "/audit",
      ctaLabel: "Read the report",
    });
    return r;
  },
  { permission: "agent.run" },
);
