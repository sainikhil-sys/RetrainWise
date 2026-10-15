import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

export const POST = route(
  async (_req, _p, ctx) => {
    const r = await ctx.engine.call("reset_settings", { actor: ctx.user.email }, { timeoutMs: 60_000, dedupeKey: "settings" });
    await audit({ kind: "engine_settings_reset", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id });
    reportFor(ctx, {
      kind: "settings_reset",
      title: "Engine settings reset to defaults",
      summary: "Every engine setting was restored to its documented default. Pending decisions are now stale.",
      status: { label: "Reset", tone: "warn" },
      href: "/settings/engine",
    });
    return r;
  },
  { permission: "settings.engine" },
);
