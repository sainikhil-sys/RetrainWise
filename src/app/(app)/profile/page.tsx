import type { Metadata } from "next";

import { signOutAction } from "@/app/actions";
import { Reveal } from "@/components/motion";
import { DataTable, PageHeader, Section } from "@/components/rw";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/authz";
import { when } from "@/lib/format";
import { ROLE_LABELS, isRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { Profile } from "@/lib/profile";
import { ProfileForm, ResetTips } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const ctx = await requirePage("/profile");
  const [user, memberships, sessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } }),
    prisma.membership.findMany({ where: { userId: ctx.user.id }, include: { workspace: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.session.findMany({ where: { userId: ctx.user.id, expires: { gt: new Date() } }, select: { id: true, expires: true }, orderBy: { expires: "desc" } }),
  ]);

  return (
    <Reveal>
      <PageHeader title="Profile" description={`Signed in as ${user.email}. Member since ${when(user.createdAt.toISOString())}.`} />

      <Section title="Account" flush>
        <ProfileForm
          email={user.email}
          initial={{
            name: user.name ?? "",
            jobTitle: user.jobTitle ?? "",
            company: user.company ?? "",
            teamRole: (user.teamRole ?? "other") as Profile["teamRole"],
            useCase: (user.useCase ?? "Exploring / evaluating") as Profile["useCase"],
            modelsInProduction: (user.modelsInProduction ?? "none") as Profile["modelsInProduction"],
            notifyApprovals: user.notifyApprovals, notifyDecisions: user.notifyDecisions, notifyJobs: user.notifyJobs, emailApprovals: user.emailApprovals, emailReports: user.emailReports }}
        />
      </Section>

      <Section title="Workspaces">
        <DataTable
          caption="Your workspaces"
          rows={memberships}
          rowKey={(m) => m.id}
          columns={[
            { key: "n", header: "Workspace", cell: (m) => (m.workspaceId === ctx.workspace.id ? <span className="font-medium">{m.workspace.name} <span className="text-[11.5px] font-normal text-muted-foreground">current</span></span> : m.workspace.name) },
            { key: "r", header: "Role", cell: (m) => (isRole(m.role) ? ROLE_LABELS[m.role] : m.role) },
            { key: "j", header: "Joined", cell: (m) => <span className="text-[12.5px] text-muted-foreground">{when(m.createdAt.toISOString())}</span> },
          ]}
        />
        <p className="mt-2 text-[12px] text-muted-foreground">Switch workspaces from the switcher at the top of the sidebar.</p>
      </Section>

      <Section title="Sessions" description="Sign-in links create a session that expires automatically. Signing out ends this session.">
        <p className="text-[13px]">
          {sessions.length} active session{sessions.length === 1 ? "" : "s"}
          {sessions[0] && <span className="text-muted-foreground"> · latest expires {when(sessions[0].expires.toISOString())}</span>}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={signOutAction}>
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
          <ResetTips />
        </div>
      </Section>
    </Reveal>
  );
}
