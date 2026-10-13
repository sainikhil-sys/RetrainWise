import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { prefixSchema, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { ENGINE_DIR } from "@/lib/engine";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".csv": "text/csv; charset=utf-8", ".json": "application/json", ".png": "image/png" };

/** Download exported result files (resolved by the engine to the workspace or reference folder). */
export const GET = route<{ prefix: string }>(async (req, { prefix }, ctx) => {
  const kind = z.enum(["summary", "aggregate", "details", "chart"]).parse(req.nextUrl.searchParams.get("kind"));
  const chart = req.nextUrl.searchParams.get("chart") ?? undefined;
  const r = await ctx.engine.call<{ path: string; name: string }>("result_file", { prefix: prefixSchema.parse(prefix), kind, chart });
  const file = path.resolve(r.path);
  if (!file.startsWith(path.resolve(ENGINE_DIR) + path.sep)) return Response.json({ error: "Invalid file" }, { status: 400 });
  const data = await fs.promises.readFile(file);
  const inline = kind === "chart" && req.nextUrl.searchParams.get("inline") === "1";
  if (!inline) await audit({ kind: "experiment_exported", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { prefix, kind } });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[path.extname(r.name)] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${r.name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
