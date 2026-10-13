import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api";
import { AuthError, currentUser, WORKSPACE_COOKIE } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/** Switch the current workspace (membership required). */
export async function POST(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) throw new AuthError(401, "Sign in to continue.");
    const { id } = z.object({ id: z.string().max(40) }).parse(await req.json());
    const m = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: id, userId: user.id } } });
    if (!m) throw new AuthError(403, "You are not a member of that workspace.");
    await prisma.user.update({ where: { id: user.id }, data: { lastWorkspaceId: id } });
    (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 24 * 3600 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
