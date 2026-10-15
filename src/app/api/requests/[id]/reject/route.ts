import { z } from "zod";

import { body, reasonText, route } from "@/lib/api";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Reject a pending request with a reason (recorded in the audit trail). */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const requestId = z.coerce.number().int().positive().parse(id);
    const b = await body(req, z.object({ reason: reasonText }));
    const r = await ctx.engine.call("reject_request", { request_id: requestId, actor: ctx.user.email, reason: b.reason }, { dedupeKey: `reject:${requestId}` });
    reportFor(ctx, {
      kind: "request_rejected",
      title: `Request #${requestId} rejected`,
      summary: "The request was closed without changing production. The reason is recorded in the audit trail.",
      status: { label: "Rejected", tone: "bad" },
      facts: [["Request", `#${requestId}`], ["Reason", b.reason || "—"]],
      href: "/audit",
    });
    return r;
  },
  { permission: "action.approve" },
);
