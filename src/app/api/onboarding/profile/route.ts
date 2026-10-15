import { NextResponse, type NextRequest } from "next/server";

import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AuthError, currentUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ProfileSchema } from "@/lib/profile";
import { rateLimit } from "@/lib/rate-limit";
import { reportWork } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Save the profile collected at first sign-in. Needs a session, not a workspace. */
export async function POST(req: NextRequest) {
  try {
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new AuthError(415, "JSON required");
    const user = await currentUser();
    if (!user) throw new AuthError(401, "Sign in to continue.");
    if (!rateLimit(`profile:${user.id}`, 20, 60_000).ok) throw new AuthError(429, "Too many requests. Try again in a minute.");
    const p = ProfileSchema.parse(await req.json());
    const first = !user.profileCompletedAt;
    await prisma.user.update({
      where: { id: user.id },
      data: { ...p, profileCompletedAt: user.profileCompletedAt ?? new Date() },
    });
    await audit({
      kind: first ? "profile_completed" : "profile_updated",
      actorEmail: user.email,
      actorId: user.id,
      detail: { jobTitle: p.jobTitle, company: p.company, teamRole: p.teamRole, useCase: p.useCase, modelsInProduction: p.modelsInProduction },
    });
    if (first) {
      reportWork(
        { userId: user.id, email: user.email },
        {
          kind: "welcome",
          title: `Welcome to RetrainWise, ${p.name.split(" ")[0]}`,
          summary: "Your account is verified and your profile is saved. RetrainWise tells you when retraining a model is worth its cost, and nothing reaches production without a person approving it.",
          status: { label: "Account ready", tone: "ok" },
          facts: [["Name", p.name], ["Job title", p.jobTitle], ["Company", p.company]],
          href: "/onboarding",
          ctaLabel: "Continue setup",
          dedupeKey: `welcome:${user.id}`,
        },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
