import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/shell/app-shell";
import { requirePage } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { getActiveRun, getSettings } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePage();
  // First sign-in: collect the profile, then (for admins) set up the workspace.
  if (!ctx.user.profileCompleted) redirect("/onboarding");
  if (!ctx.workspace.onboardedAt && can(ctx.role, "workspace.manage")) redirect("/onboarding");
  let run = null;
  try {
    const [r, settings] = await Promise.all([getActiveRun(ctx.workspace.id), getSettings(ctx.workspace.id)]);
    run = r && { id: r.id, dataset: r.dataset, position: r.position, rows: r.n_rows, version: r.active_version, batchSize: settings.batch_size };
  } catch {
    // The engine may still be starting; pages show the detailed state.
  }
  return (
    <AppShell
      user={{ email: ctx.user.email, name: ctx.user.name }}
      role={ctx.role}
      workspace={{ id: ctx.workspace.id, name: ctx.workspace.name }}
      workspaces={ctx.workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role }))}
      run={run}
      canOperate={can(ctx.role, "stream.operate")}
    >
      {children}
    </AppShell>
  );
}
