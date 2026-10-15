import { z } from "zod";

import { body, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Mark onboarding complete for the workspace (and remember the default cost regime). */
export const POST = route(async (req, _p, ctx) => {
  const b = await body(req, z.object({ defaultRegime: z.enum(["cheap", "balanced", "expensive"]).optional() }));
  await prisma.workspace.update({
    where: { id: ctx.workspace.id },
    data: { onboardedAt: new Date(), ...(b.defaultRegime ? { defaultRegime: b.defaultRegime } : {}) },
  });
  await audit({ kind: "onboarding_completed", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: b });
  reportFor(ctx, {
    kind: "onboarding_completed",
    title: `${ctx.workspace.name} is ready`,
    summary: "Your workspace is set up. From the dashboard you can process batches, evaluate update options, train candidates and invite your team.",
    status: { label: "Set up", tone: "ok" },
    facts: [["Workspace", ctx.workspace.name], ["Default cost regime", b.defaultRegime ?? "balanced"], ["Your role", "Admin"]],
    href: "/overview",
    ctaLabel: "Open the dashboard",
    dedupeKey: `onboarded:${ctx.workspace.id}:${ctx.user.id}`,
  });
  return { ok: true };
});
