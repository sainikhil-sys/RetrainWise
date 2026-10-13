import { z } from "zod";

import { body, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const Update = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  defaultRegime: z.enum(["cheap", "balanced", "expensive"]).optional(),
  requireSeparateApprover: z.boolean().optional(),
});

/** Update workspace settings (admins). */
export const PATCH = route(
  async (req, _p, ctx) => {
    const b = await body(req, Update);
    const ws = await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: b });
    await audit({ kind: "workspace_updated", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: b });
    return { workspace: ws };
  },
  { permission: "workspace.manage" },
);
