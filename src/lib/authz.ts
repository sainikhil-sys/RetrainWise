import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { can, isRole, type Permission, type Role } from "./permissions";
import { prisma } from "./prisma";

export const WORKSPACE_COOKIE = "rw_ws";

export type WorkspaceSummary = { id: string; name: string; slug: string; role: Role };

export type Ctx = {
  user: { id: string; email: string; name: string | null; dismissedTips: string[]; profileCompleted: boolean };
  workspace: { id: string; name: string; slug: string; onboardedAt: Date | null; defaultRegime: string; requireSeparateApprover: boolean };
  role: Role;
  workspaces: WorkspaceSummary[];
};

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function currentUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findUnique({ where: { id: session.user.id } });
}

/** Resolve the signed-in user and their current workspace (cookie, last used, or first). */
export async function getContext(): Promise<{ status: "anonymous" } | { status: "no-workspace"; user: Ctx["user"] } | ({ status: "ok" } & Ctx)> {
  const user = await currentUser();
  if (!user) return { status: "anonymous" };
  const u = { id: user.id, email: user.email, name: user.name, dismissedTips: user.dismissedTips.split(",").filter(Boolean), profileCompleted: !!user.profileCompletedAt };
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  const valid = memberships.filter((m) => isRole(m.role));
  if (!valid.length) return { status: "no-workspace", user: u };
  const wanted = (await cookies()).get(WORKSPACE_COOKIE)?.value || user.lastWorkspaceId;
  const current = valid.find((m) => m.workspaceId === wanted) ?? valid[0];
  const w = current.workspace;
  return {
    status: "ok",
    user: u,
    role: current.role as Role,
    workspace: { id: w.id, name: w.name, slug: w.slug, onboardedAt: w.onboardedAt, defaultRegime: w.defaultRegime, requireSeparateApprover: w.requireSeparateApprover },
    workspaces: valid.map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role as Role })),
  };
}

/** For pages: signed in with a workspace, otherwise redirect. */
export async function requirePage(path = "/overview"): Promise<Ctx> {
  const ctx = await getContext();
  if (ctx.status === "anonymous") redirect(`/signin?next=${encodeURIComponent(path)}`);
  if (ctx.status === "no-workspace") redirect("/onboarding");
  return ctx;
}

/** For API routes and server actions: throws AuthError (401/403/409). */
export async function requireApi(permission: Permission = "view"): Promise<Ctx> {
  const ctx = await getContext();
  if (ctx.status === "anonymous") throw new AuthError(401, "Sign in to continue.");
  if (ctx.status === "no-workspace") throw new AuthError(409, "Create or join a workspace first.");
  if (!can(ctx.role, permission)) {
    throw new AuthError(403, `Your role (${ctx.role}) does not allow this action. Ask a workspace admin for access.`);
  }
  return ctx;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export function actorLabel(ctx: Ctx) {
  return ctx.user.email;
}
