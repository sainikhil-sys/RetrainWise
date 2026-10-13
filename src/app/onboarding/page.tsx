import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getContext } from "@/lib/authz";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await getContext();
  if (ctx.status === "anonymous") redirect("/signin?next=/onboarding");
  return (
    <OnboardingFlow
      email={ctx.user.email}
      workspace={ctx.status === "ok" ? { id: ctx.workspace.id, name: ctx.workspace.name, defaultRegime: ctx.workspace.defaultRegime } : null}
      workspaces={ctx.status === "ok" ? ctx.workspaces.map((w) => ({ id: w.id, name: w.name })) : []}
      canAdmin={ctx.status === "ok" ? ctx.role === "admin" : true}
    />
  );
}
