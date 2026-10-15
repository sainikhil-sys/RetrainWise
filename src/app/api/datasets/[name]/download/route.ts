import { z } from "zod";

import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Explicit download from the original source; writes a cache file and a provenance record. */
export const POST = route<{ name: string }>(
  async (_req, { name }, ctx) => {
    const dataset = z.enum(["electricity", "airlines", "covertype"]).parse(name);
    const r = await ctx.engine.isolated("download_dataset", { name: dataset }, `download:${dataset}`, 900_000);
    await audit({ kind: "dataset_downloaded", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { dataset } });
    const d = r as { rows?: number; target_column?: string; cache_sha256?: string };
    reportFor(ctx, {
      kind: "dataset_downloaded",
      title: `Dataset downloaded: ${dataset}`,
      summary: "The original file was downloaded, verified and cached with a provenance record. It is ready for streams, training and benchmarks.",
      status: { label: "Verified", tone: "ok" },
      facts: [["Dataset", dataset], ["Rows", d.rows != null ? d.rows.toLocaleString() : "—"], ["Target", d.target_column ?? "—"], ["SHA-256", d.cache_sha256 ? `${d.cache_sha256.slice(0, 24)}…` : "—"]],
      href: "/data",
    });
    return r;
  },
  { permission: "stream.operate", limit: { max: 6, windowMs: 60_000 } },
);
