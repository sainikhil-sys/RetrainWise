import { z } from "zod";

import { route } from "@/lib/api";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** Explicit download from the original source; writes a cache file and a provenance record. */
export const POST = route<{ name: string }>(
  async (_req, { name }, ctx) => {
    const dataset = z.enum(["electricity", "airlines", "covertype"]).parse(name);
    const r = await ctx.engine.isolated("download_dataset", { name: dataset }, `download:${dataset}`, 900_000);
    await audit({ kind: "dataset_downloaded", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { dataset } });
    return r;
  },
  { permission: "stream.operate", limit: { max: 6, windowMs: 60_000 } },
);
