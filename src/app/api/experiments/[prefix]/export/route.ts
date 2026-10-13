import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { prefixSchema, route } from "@/lib/api";
import { ENGINE_DIR } from "@/lib/engine";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".csv": "text/csv; charset=utf-8", ".json": "application/json", ".png": "image/png" };

/**
 * Download exported result files. Only `<prefix>_summary.csv`, `<prefix>_aggregate.csv`,
 * `<prefix>_details.json` or `<prefix>_chart_*.png` directly inside engine/ are served.
 */
export const GET = route<{ prefix: string }>(async (req, { prefix }) => {
  const p = prefixSchema.parse(prefix);
  const kind = z.enum(["summary", "aggregate", "details", "chart"]).parse(req.nextUrl.searchParams.get("kind"));
  let name: string;
  if (kind === "chart") {
    const chart = z.string().regex(/^[A-Za-z0-9_]{1,60}$/).parse(req.nextUrl.searchParams.get("chart"));
    name = `${p}_chart_${chart}.png`;
  } else {
    name = kind === "details" ? `${p}_details.json` : `${p}_${kind}.csv`;
  }
  const file = path.join(ENGINE_DIR, name);
  if (path.dirname(file) !== ENGINE_DIR || !fs.existsSync(file)) {
    return Response.json({ error: `${name} does not exist` }, { status: 404 });
  }
  const data = await fs.promises.readFile(file);
  const inline = kind === "chart" && req.nextUrl.searchParams.get("inline") === "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[path.extname(name)] ?? "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
