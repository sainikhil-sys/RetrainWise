import { z } from "zod";

import { body, reasonText, route } from "@/lib/api";
import { reportFor, ver } from "@/lib/report";

export const dynamic = "force-dynamic";

const Rollback = z.object({ approved: z.literal(true, { message: "Confirm the rollback to continue" }), reason: reasonText });

/** Restore an archived version of the active run (checksum verified by the engine). */
export const POST = route<{ version: string }>(
  async (req, { version }, ctx) => {
    const v = z.coerce.number().int().positive().parse(version);
    const b = await body(req, Rollback);
    const r = await ctx.engine.call("rollback", { version: v, approver: ctx.user.email, approved: true, reason: b.reason }, { timeoutMs: 120_000, dedupeKey: "rollback" });
    reportFor(ctx, {
      kind: "model_rolled_back",
      title: `Rolled back to ${ver(v)}`,
      summary: `${ver(v)} is serving again after its artifact checksum was verified. Monitors restarted against it.`,
      status: { label: "Rolled back", tone: "warn" },
      facts: [["Restored version", ver(v)], ["Reason", b.reason]],
      href: `/models/${v}`,
    });
    return r;
  },
  { permission: "model.rollback" },
);
