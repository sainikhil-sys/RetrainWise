import { z } from "zod";

import { body, route, sizeEnum } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { DATASETS, REGIMES } from "@/lib/catalog";
import { can } from "@/lib/permissions";
import { getSettings, listRuns } from "@/lib/queries";
import { reportFor, ver } from "@/lib/report";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => ({ runs: await listRuns(ctx.workspace.id, 50) }));

const StartRun = z.object({
  dataset: z.enum(DATASETS),
  size: sizeEnum,
  seed: z.number().int().min(0).max(2_147_483_647),
  regime: z.enum(REGIMES).optional(),
});

/** Start a monitored run: loads data in source order and trains the initial model. */
export const POST = route(
  async (req, _p, ctx) => {
    const args = await body(req, StartRun);
    if (args.regime && !can(ctx.role, "settings.engine")) {
      const current = await getSettings(ctx.workspace.id);
      if (current.regime !== args.regime) throw new AuthError(403, "Only admins can change the cost regime.");
      delete args.regime;
    }
    const r = await ctx.engine.call<{ id: string; dataset: string; size: string; rows: number; seed: number; active_version: number }>(
      "start_run",
      { ...args, actor: ctx.user.email },
      { timeoutMs: 600_000, dedupeKey: "start_run" },
    );
    reportFor(ctx, {
      kind: "run_started",
      title: `Monitored stream started on ${r.dataset}`,
      summary: `${r.rows.toLocaleString()} rows were loaded in source order and the initial model ${ver(r.active_version)} was trained on the first window. Process batches to start collecting evidence.`,
      status: { label: "Started", tone: "ok" },
      facts: [["Run", r.id], ["Dataset", `${r.dataset} · ${r.size} sample`], ["Rows", r.rows.toLocaleString()], ["Seed", String(r.seed)], ["Initial model", ver(r.active_version)]],
      href: "/data",
      ctaLabel: "Open Data & streams",
    });
    return r;
  },
  { permission: "stream.operate" },
);
