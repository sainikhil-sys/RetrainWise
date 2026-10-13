import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AuthError, currentUser, WORKSPACE_COOKIE } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const Create = z.object({ name: z.string().trim().min(2, "Use at least 2 characters").max(60) });

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
}

/** Create a workspace. The creator becomes its admin. */
export async function POST(req: NextRequest) {
  try {
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new AuthError(415, "JSON required");
    const user = await currentUser();
    if (!user) throw new AuthError(401, "Sign in to continue.");
    if (!rateLimit(`ws-create:${user.id}`, 5, 60 * 60_000).ok) throw new AuthError(429, "Too many workspaces created; try again later.");
    const b = Create.parse(await req.json());
    let slug = slugify(b.name);
    if (await prisma.workspace.findUnique({ where: { slug } })) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    const ws = await prisma.workspace.create({
      data: { name: b.name, slug, memberships: { create: { userId: user.id, role: "admin" } } },
    });
    await prisma.user.update({ where: { id: user.id }, data: { lastWorkspaceId: ws.id } });
    (await cookies()).set(WORKSPACE_COOKIE, ws.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 3600 });
    await audit({ kind: "workspace_created", actorEmail: user.email, actorId: user.id, workspaceId: ws.id, detail: { name: ws.name } });
    return NextResponse.json({ id: ws.id, slug: ws.slug });
  } catch (err) {
    return errorResponse(err);
  }
}
