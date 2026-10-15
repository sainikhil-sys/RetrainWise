import { z } from "zod";

import { route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { searchEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";

const Query = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  q: z.string().max(200).optional(),
  kinds: z.string().max(2000).optional(),
  actor: z.string().max(120).optional(),
  since: z.string().max(40).optional(),
});

function csvCell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** Export the combined audit trail: engine events plus application events (sign-ins, team, exports). */
export const GET = route(async (req, _p, ctx) => {
  const q = Query.parse(Object.fromEntries(req.nextUrl.searchParams));
  const kinds = q.kinds ? q.kinds.split(",").filter(Boolean) : undefined;
  const engineEvents = await searchEvents(ctx.workspace.id, { q: q.q, kinds, actor: q.actor, since: q.since, limit: 5000 });
  const appEvents = await prisma.auditLog.findMany({
    where: {
      workspaceId: ctx.workspace.id,
      ...(kinds ? { kind: { in: kinds } } : {}),
      ...(q.actor ? { actorEmail: q.actor } : {}),
      ...(q.since ? { createdAt: { gte: new Date(q.since) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  const rows = [
    ...engineEvents.map((e) => ({ source: "engine", id: String(e.id), created: e.created, kind: e.kind, actor: e.actor, run_id: e.run_id ?? "", detail: e.payload })),
    ...appEvents
      .filter((a) => !q.q || `${a.kind} ${a.actorEmail} ${a.detail}`.toLowerCase().includes(q.q.toLowerCase()))
      .map((a) => ({ source: "app", id: a.id, created: a.createdAt.toISOString(), kind: a.kind, actor: a.actorEmail, run_id: "", detail: JSON.parse(a.detail) })),
  ].sort((a, b) => (a.created < b.created ? 1 : -1));
  await audit({ kind: "audit_exported", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { format: q.format, rows: rows.length } });
  if (q.format === "csv") {
    const lines = ["source,id,created,kind,actor,run_id,detail"].concat(
      rows.map((r) => [r.source, r.id, r.created, r.kind, r.actor, r.run_id, r.detail].map(csvCell).join(",")),
    );
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="retrainwise_audit.csv"' } });
  }
  return new Response(JSON.stringify(rows, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="retrainwise_audit.json"' } });
});
