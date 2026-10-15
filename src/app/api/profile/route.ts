import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { errorResponse } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AuthError, currentUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { ProfileSchema } from "@/lib/profile";

export const dynamic = "force-dynamic";

const Update = z.object({
  name: z.string().trim().max(80).optional(),
  jobTitle: ProfileSchema.shape.jobTitle.optional(),
  company: ProfileSchema.shape.company.optional(),
  teamRole: ProfileSchema.shape.teamRole.optional(),
  useCase: ProfileSchema.shape.useCase.optional(),
  modelsInProduction: ProfileSchema.shape.modelsInProduction.optional(),
  notifyApprovals: z.boolean().optional(),
  notifyDecisions: z.boolean().optional(),
  notifyJobs: z.boolean().optional(),
  emailApprovals: z.boolean().optional(),
  emailReports: z.boolean().optional(),
  dismissTip: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  resetTips: z.boolean().optional(),
});

/** Update the signed-in user's profile and notification preferences. */
export async function PATCH(req: NextRequest) {
  try {
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new AuthError(415, "JSON required");
    const user = await currentUser();
    if (!user) throw new AuthError(401, "Sign in to continue.");
    const { dismissTip, resetTips, ...rest } = Update.parse(await req.json());
    const tips = new Set(user.dismissedTips.split(",").filter(Boolean));
    if (dismissTip) tips.add(dismissTip);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { ...rest, dismissedTips: resetTips ? "" : [...tips].join(",") },
    });
    if (Object.keys(rest).length) await audit({ kind: "profile_updated", actorEmail: user.email, actorId: user.id, detail: rest });
    return NextResponse.json({ user: { name: updated.name, email: updated.email } });
  } catch (err) {
    return errorResponse(err);
  }
}
