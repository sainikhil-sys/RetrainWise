import { z } from "zod";

import { actorName, body, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Dismiss an agent-prepared request without executing it. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const requestId = z.coerce.number().int().positive().parse(id);
  const b = await body(req, z.object({ actor: actorName.optional() }));
  return engineCall("dismiss_request", { request_id: requestId, actor: b.actor ?? "user" }, { dedupeKey: `dismiss:${requestId}` });
});
