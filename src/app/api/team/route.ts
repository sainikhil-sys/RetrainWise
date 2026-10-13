import { z } from "zod";

import { body, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AuthError } from "@/lib/authz";
import { layout, sendMail } from "@/lib/mail";
import { notify } from "@/lib/notify";
import { ROLES, ROLE_LABELS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => {
  const members = await prisma.membership.findMany({
    where: { workspaceId: ctx.workspace.id },
    include: { user: { select: { id: true, email: true, name: true, emailVerified: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  const invitations = await prisma.invitation.findMany({ where: { workspaceId: ctx.workspace.id, acceptedAt: null }, orderBy: { createdAt: "desc" } });
  return { members, invitations };
});

const Invite = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200), role: z.enum(ROLES) });

/** Invite someone by email. They join with this role the next time they sign in with that address. */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, Invite);
    const existingUser = await prisma.user.findUnique({ where: { email: b.email } });
    if (existingUser) {
      const m = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId: existingUser.id } } });
      if (m) throw new AuthError(409, "That person is already a member.");
    }
    await prisma.invitation.upsert({
      where: { workspaceId_email: { workspaceId: ctx.workspace.id, email: b.email } },
      create: { workspaceId: ctx.workspace.id, email: b.email, role: b.role, invitedById: ctx.user.id },
      update: { role: b.role, acceptedAt: null },
    });
    const base = process.env.AUTH_URL || "http://localhost:3000";
    const { text, html } = layout(
      `You are invited to ${ctx.workspace.name}`,
      [`${ctx.user.email} invited you to the RetrainWise workspace “${ctx.workspace.name}” as ${ROLE_LABELS[b.role]}.`, "Sign in with this email address to join."],
      { label: "Sign in to RetrainWise", url: `${base}/signin` },
    );
    const delivery = await sendMail({ to: b.email, subject: `Invitation to ${ctx.workspace.name} on RetrainWise`, text, html, url: `${base}/signin` });
    await audit({ kind: "member_invited", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { email: b.email, role: b.role } });
    if (existingUser) {
      await prisma.membership.create({ data: { workspaceId: ctx.workspace.id, userId: existingUser.id, role: b.role } });
      await prisma.invitation.update({ where: { workspaceId_email: { workspaceId: ctx.workspace.id, email: b.email } }, data: { acceptedAt: new Date() } });
      await notify({ workspaceId: ctx.workspace.id, kind: "team", userIds: [existingUser.id], title: `You were added to ${ctx.workspace.name}`, body: `Role: ${ROLE_LABELS[b.role]}`, href: "/overview" });
    }
    return { ok: true, delivered: delivery.delivered };
  },
  { permission: "team.manage", limit: { max: 20, windowMs: 60_000 } },
);

const Change = z.object({ userId: z.string().max(40), role: z.enum(ROLES).optional(), remove: z.boolean().optional() });

async function adminCount(workspaceId: string) {
  return prisma.membership.count({ where: { workspaceId, role: "admin" } });
}

/** Change a member's role or remove them. The last admin cannot be demoted or removed. */
export const PATCH = route(
  async (req, _p, ctx) => {
    const b = await body(req, Change);
    const m = await prisma.membership.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspace.id, userId: b.userId } }, include: { user: true } });
    if (!m) throw new AuthError(404, "Member not found");
    const losingAdmin = m.role === "admin" && (b.remove || (b.role && b.role !== "admin"));
    if (losingAdmin && (await adminCount(ctx.workspace.id)) <= 1) throw new AuthError(409, "A workspace needs at least one admin.");
    if (b.remove) {
      await prisma.membership.delete({ where: { id: m.id } });
      await audit({ kind: "member_removed", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { email: m.user.email } });
    } else if (b.role) {
      await prisma.membership.update({ where: { id: m.id }, data: { role: b.role } });
      await audit({ kind: "member_role_changed", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { email: m.user.email, from: m.role, to: b.role } });
      await notify({ workspaceId: ctx.workspace.id, kind: "team", userIds: [m.userId], title: "Your role changed", body: `${ROLE_LABELS[m.role as never]} → ${ROLE_LABELS[b.role]}`, href: "/settings/team" });
    }
    return { ok: true };
  },
  { permission: "team.manage" },
);

/** Revoke a pending invitation. */
export const DELETE = route(
  async (req, _p, ctx) => {
    const id = z.string().max(40).parse(req.nextUrl.searchParams.get("invitation"));
    const inv = await prisma.invitation.findFirst({ where: { id, workspaceId: ctx.workspace.id, acceptedAt: null } });
    if (!inv) throw new AuthError(404, "Invitation not found");
    await prisma.invitation.delete({ where: { id } });
    await audit({ kind: "invitation_revoked", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { email: inv.email } });
    return { ok: true };
  },
  { permission: "team.manage" },
);
