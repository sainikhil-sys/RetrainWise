import { z } from "zod";

import { route } from "@/lib/api";
import { getEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Query = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  kinds: z.string().max(2000).optional(),
  actor: z.string().max(80).optional(),
});

function csvCell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? "'" + text : text; // avoid spreadsheet formula injection
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** Export the append-only audit log (filtered like the table on the Agent and audit page). */
export const GET = route(async (req) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const kinds = q.kinds ? q.kinds.split(",").filter(Boolean) : undefined;
  const events = await getEvents({ limit: 5000, kinds, actor: q.actor || undefined });
  if (q.format === "csv") {
    const lines = ["id,created,kind,run_id,actor,payload"].concat(
      events.map((e) => [e.id, e.created, e.kind, e.run_id ?? "", e.actor, e.payload].map(csvCell).join(",")),
    );
    return new Response(lines.join("\n"), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="retrainwise_audit.csv"' },
    });
  }
  return new Response(JSON.stringify(events, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="retrainwise_audit.json"' },
  });
});
