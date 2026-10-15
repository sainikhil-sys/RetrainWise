import type { Metadata } from "next";

import { DataTable, Section } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { ago, when } from "@/lib/format";
import { ROLE_LABELS, can, isRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { InviteForm, MemberRole, RevokeInvite } from "../_components/team";

export const metadata: Metadata = { title: "Team" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const ctx = await requirePage("/settings/team");
  const canManage = can(ctx.role, "team.manage");
  const [members, invitations] = await Promise.all([
    prisma.membership.findMany({ where: { workspaceId: ctx.workspace.id }, include: { user: { select: { id: true, email: true, name: true, createdAt: true } } }, orderBy: { createdAt: "asc" } }),
    canManage ? prisma.invitation.findMany({ where: { workspaceId: ctx.workspace.id, acceptedAt: null }, orderBy: { createdAt: "desc" } }) : Promise.resolve([]),
  ]);
  const admins = members.filter((m) => m.role === "admin").length;

  return (
    <>
      {canManage && (
        <Section title="Invite" description="They join with this role the next time they sign in with that email address." flush>
          <InviteForm />
        </Section>
      )}

      <Section title="Members" description={`${members.length} member${members.length === 1 ? "" : "s"} · ${admins} admin${admins === 1 ? "" : "s"}. A workspace always keeps at least one admin.`} flush={!canManage}>
        <DataTable
          caption="Members"
          rows={members}
          rowKey={(m) => m.id}
          columns={[
            {
              key: "u",
              header: "Member",
              cell: (m) => (
                <div>
                  <div className="text-[13.5px]">
                    {m.user.name || m.user.email}
                    {m.user.id === ctx.user.id && <span className="ml-2 text-[11.5px] text-muted-foreground">you</span>}
                  </div>
                  {m.user.name && <div className="text-[12px] text-muted-foreground">{m.user.email}</div>}
                </div>
              ),
            },
            { key: "j", header: "Joined", mobile: false, cell: (m) => <span className="text-[12.5px] text-muted-foreground">{when(m.createdAt.toISOString())}</span> },
            {
              key: "r",
              header: "Role",
              align: "right",
              cell: (m) => <MemberRole userId={m.user.id} email={m.user.email} role={isRole(m.role) ? m.role : "viewer"} isSelf={m.user.id === ctx.user.id} canEdit={canManage} />,
            },
          ]}
        />
      </Section>

      {canManage && invitations.length > 0 && (
        <Section title="Pending invitations">
          <DataTable
            caption="Pending invitations"
            rows={invitations}
            rowKey={(i) => i.id}
            columns={[
              { key: "e", header: "Email", cell: (i) => i.email },
              { key: "r", header: "Role", cell: (i) => (isRole(i.role) ? ROLE_LABELS[i.role] : i.role) },
              { key: "c", header: "Sent", cell: (i) => <span className="text-[12.5px] text-muted-foreground">{ago(i.createdAt.toISOString())}</span> },
              { key: "x", header: "", align: "right", cell: (i) => <RevokeInvite id={i.id} email={i.email} /> },
            ]}
          />
        </Section>
      )}
    </>
  );
}
