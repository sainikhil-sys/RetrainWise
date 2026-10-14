import { currentUser } from "@/lib/auth/session";
import { lifecycle } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/** Export the audit log (latest 5,000 events, optionally one kind) as JSON. */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const kind = new URL(request.url).searchParams.get("kind");
  const db = lifecycle().db;
  const events = kind
    ? db.all("SELECT id, created, kind, run_id, actor, payload FROM events WHERE kind=? ORDER BY id DESC LIMIT 5000", kind)
    : db.all("SELECT id, created, kind, run_id, actor, payload FROM events ORDER BY id DESC LIMIT 5000");
  return new Response(JSON.stringify(events, null, 2), { headers: { "Content-Type": "application/json",
    "Content-Disposition": 'attachment; filename="retrainwise_audit.json"' } });
}
