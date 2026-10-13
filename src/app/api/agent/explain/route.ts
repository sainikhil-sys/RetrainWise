import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Explain = z.object({ decisionId: ident, mode: z.enum(["deterministic", "ollama"]), model: z.string().regex(/^[A-Za-z0-9._:/-]{1,80}$/).optional() });

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
    if (b.mode === "ollama") {
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
    return r;
  },
  { permission: "agent.run" },
);
