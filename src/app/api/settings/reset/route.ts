import { route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const POST = route(
  async (_req, _p, ctx) => {
    const r = await ctx.engine.call("reset_settings", { actor: ctx.user.email }, { timeoutMs: 60_000, dedupeKey: "settings" });
    await audit({ kind: "engine_settings_reset", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id });
    return r;
  },
  { permission: "settings.engine" },
);
