import { currentUser } from "@/lib/auth/session";
import { lifecycle } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/** Export the active settings as JSON. */
export async function GET() {
  if (!(await currentUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  return new Response(JSON.stringify(lifecycle().settings(), null, 2), { headers: { "Content-Type": "application/json",
    "Content-Disposition": 'attachment; filename="retrainwise_settings.json"' } });
}
