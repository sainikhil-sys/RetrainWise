import { z } from "zod";

import { body, reasonText, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Reject a pending request with a reason (recorded in the audit trail). */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const requestId = z.coerce.number().int().positive().parse(id);
    const b = await body(req, z.object({ reason: reasonText }));
    return ctx.engine.call("reject_request", { request_id: requestId, actor: ctx.user.email, reason: b.reason }, { dedupeKey: `reject:${requestId}` });
  },
  { permission: "action.approve" },
);
