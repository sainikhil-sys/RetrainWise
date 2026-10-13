import { z } from "zod";

import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Re-score a candidate on withheld chronological data. Changes nothing in production. */
export const POST = route<{ version: string }>(
  async (_req, { version }, ctx) => {
    const v = z.coerce.number().int().positive().parse(version);
    return ctx.engine.call("revalidate_candidate", { version: v, actor: ctx.user.email }, { timeoutMs: 600_000, dedupeKey: `validate:${v}` });
  },
  { permission: "model.train" },
);
