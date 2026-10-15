import { z } from "zod";

import { body, route } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => {
  const items = await prisma.notification.findMany({
    where: { userId: ctx.user.id, workspaceId: ctx.workspace.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const unread = await prisma.notification.count({ where: { userId: ctx.user.id, workspaceId: ctx.workspace.id, readAt: null } });
  return { items, unread };
});

/** Mark notifications as read (`all` or specific ids). */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, z.object({ ids: z.array(z.string().max(40)).max(100).optional(), all: z.boolean().optional() }));
    await prisma.notification.updateMany({
      where: { userId: ctx.user.id, workspaceId: ctx.workspace.id, readAt: null, ...(b.all ? {} : { id: { in: b.ids ?? [] } }) },
      data: { readAt: new Date() },
    });
    return { ok: true };
  },
  { limit: { max: 120, windowMs: 60_000 } },
);
