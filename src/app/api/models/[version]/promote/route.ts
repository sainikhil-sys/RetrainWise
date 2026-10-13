import { z } from "zod";

import { body, route } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { notify } from "@/lib/notify";
import { getModel } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Approve and promote a validated candidate. Only this changes the production model. */
export const POST = route<{ version: string }>(
  async (req, { version }, ctx) => {
    const v = z.coerce.number().int().positive().parse(version);
    await body(req, z.object({ approved: z.literal(true, { message: "Confirm the promotion to continue" }) }));
    const model = await getModel(ctx.workspace.id, v);
    if (!model) throw new AuthError(404, "Unknown model version");
    if (ctx.workspace.requireSeparateApprover && model.metadata.created_by === ctx.user.email) {
      throw new AuthError(403, "This workspace requires a different person to promote a model you trained.");
    }
    const r = await ctx.engine.call<{ status: string; version: number; run_id: string }>(
      "promote_candidate",
      { version: v, actor: ctx.user.email, role: ctx.role, approved: true },
      { timeoutMs: 600_000, dedupeKey: `promote:${v}` },
    );
    await notify({
      workspaceId: ctx.workspace.id,
      kind: "outcome",
      title: `Model v${String(v).padStart(3, "0")} promoted after chronological validation`,
      body: `Approved by ${ctx.user.email}.`,
      href: `/models/${v}`,
      dedupeKey: `promoted:${v}`,
    });
    return r;
  },
  { permission: "model.promote" },
);
