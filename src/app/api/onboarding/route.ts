import { z } from "zod";

import { body, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Mark onboarding complete for the workspace (and remember the default cost regime). */
export const POST = route(async (req, _p, ctx) => {
  const b = await body(req, z.object({ defaultRegime: z.enum(["cheap", "balanced", "expensive"]).optional() }));
  await prisma.workspace.update({
    where: { id: ctx.workspace.id },
    data: { onboardedAt: new Date(), ...(b.defaultRegime ? { defaultRegime: b.defaultRegime } : {}) },
  });
  await audit({ kind: "onboarding_completed", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: b });
  return { ok: true };
});
