import { z } from "zod";

import { actorName, body, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

const Rollback = z.object({
  approver: actorName,
  approved: z.literal(true, { message: "Tick the approval box to confirm" }),
  reason: z.string().trim().max(500).default(""),
});

/** Restore an archived version of the active run (checksum verified by the engine). */
export const POST = route<{ version: string }>(async (req, { version }) => {
  const v = z.coerce.number().int().positive().parse(version);
  const b = await body(req, Rollback);
  return engineCall(
    "rollback",
    { version: v, approver: b.approver, approved: true, reason: b.reason },
    { timeoutMs: 120_000, dedupeKey: "rollback" },
  );
});
