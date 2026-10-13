import { z } from "zod";

import { body, reasonText, route } from "@/lib/api";

export const dynamic = "force-dynamic";

const Rollback = z.object({ approved: z.literal(true, { message: "Confirm the rollback to continue" }), reason: reasonText });

/** Restore an archived version of the active run (checksum verified by the engine). */
export const POST = route<{ version: string }>(
  async (req, { version }, ctx) => {
    const v = z.coerce.number().int().positive().parse(version);
    const b = await body(req, Rollback);
    return ctx.engine.call("rollback", { version: v, approver: ctx.user.email, approved: true, reason: b.reason }, { timeoutMs: 120_000, dedupeKey: "rollback" });
  },
  { permission: "model.rollback" },
);
