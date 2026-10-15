import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { currentUser, getContext } from "@/lib/authz";
import type { Profile } from "@/lib/profile";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Get started" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await getContext();
  if (ctx.status === "anonymous") redirect("/signin?next=/onboarding");
  const user = await currentUser();
  const needsProfile = !user?.profileCompletedAt;
  const isAdmin = ctx.status === "ok" && ctx.role === "admin";
  const workspaceReady = ctx.status === "ok" && (!!ctx.workspace.onboardedAt || !isAdmin);
  if (!needsProfile && workspaceReady) redirect("/overview");
  const profile: Partial<Profile> = {
    name: user?.name ?? undefined,
    jobTitle: user?.jobTitle ?? undefined,
    company: user?.company ?? undefined,
    teamRole: user?.teamRole ?? undefined,
    useCase: (user?.useCase as Profile["useCase"]) ?? undefined,
    modelsInProduction: (user?.modelsInProduction as Profile["modelsInProduction"]) ?? undefined,
    emailApprovals: user?.emailApprovals ?? true,
  };
  return (
    <OnboardingFlow
      email={ctx.user.email}
      workspace={ctx.status === "ok" ? { id: ctx.workspace.id, name: ctx.workspace.name, defaultRegime: ctx.workspace.defaultRegime } : null}
      workspaces={ctx.status === "ok" ? ctx.workspaces.map((w) => ({ id: w.id, name: w.name })) : []}
      canAdmin={ctx.status === "ok" ? ctx.role === "admin" : true}
      needsProfile={needsProfile}
      profile={profile}
      workspaceReady={workspaceReady}
    />
  );
}
