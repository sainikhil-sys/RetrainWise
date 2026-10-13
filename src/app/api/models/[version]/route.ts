import { z } from "zod";

import { AuthError } from "@/lib/authz";
import { route } from "@/lib/api";
import { getModel, getModelEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = route<{ version: string }>(async (_req, { version }, ctx) => {
  const v = z.coerce.number().int().positive().parse(version);
  const model = await getModel(ctx.workspace.id, v);
  if (!model) throw new AuthError(404, "Unknown model version");
  return { model, events: await getModelEvents(ctx.workspace.id, v) };
});
