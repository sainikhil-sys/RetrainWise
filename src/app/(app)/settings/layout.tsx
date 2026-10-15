import type { ReactNode } from "react";

import { PageHeader } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { ROLE_LABELS } from "@/lib/permissions";
import { SettingsNav } from "./_components/sub-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await requirePage("/settings");
  return (
    <>
      <PageHeader title="Settings" description={`${ctx.workspace.name} · you are ${ROLE_LABELS[ctx.role]}.`} />
      <SettingsNav />
      {children}
    </>
  );
}
