import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { prefixSchema, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ENGINE_DIR, ENGINE_MODE } from "@/lib/engine";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".csv": "text/csv; charset=utf-8", ".json": "application/json", ".png": "image/png" };

/** Download exported result files (resolved by the engine to the workspace or reference folder). */
export const GET = route<{ prefix: string }>(async (req, { prefix }, ctx) => {
  const kind = z.enum(["summary", "aggregate", "details", "chart"]).parse(req.nextUrl.searchParams.get("kind"));
  const chart = req.nextUrl.searchParams.get("chart") ?? undefined;
  let r: { name: string };
  let data: Uint8Array<ArrayBuffer>;
  if (ENGINE_MODE === "local") {
    const local = await ctx.engine.call<{ path: string; name: string }>("result_file", { prefix: prefixSchema.parse(prefix), kind, chart });
    const file = path.resolve(local.path);
    const roots = [ENGINE_DIR, process.env.RETRAINWISE_WORKSPACES_DIR].filter(Boolean).map((d) => path.resolve(d as string) + path.sep);
    if (!roots.some((root) => file.startsWith(root))) return Response.json({ error: "Invalid file" }, { status: 400 });
    r = local;
    data = new Uint8Array(await fs.promises.readFile(file));
  } else {
    // Hosted: the file lives on the engine service's disk.
    const remote = await ctx.engine.call<{ name: string; data: string }>("read_result_file", { prefix: prefixSchema.parse(prefix), kind, chart }, { timeoutMs: 120_000 });
    r = remote;
    data = new Uint8Array(Buffer.from(remote.data, "base64"));
  }
  const inline = kind === "chart" && req.nextUrl.searchParams.get("inline") === "1";
  if (!inline) await audit({ kind: "experiment_exported", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { prefix, kind } });
  return new Response(data, {
    headers: {
      "Content-Type": TYPES[path.extname(r.name)] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${r.name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
