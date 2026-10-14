import fs from "node:fs";
import { currentUser } from "@/lib/auth/session";
import { resultFile } from "@/lib/results";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { csv: "text/csv", json: "application/json", png: "image/png" };

/** Download one file of a saved result set. */
export async function GET(request: Request) {
  if (!(await currentUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const url = new URL(request.url);
  const file = resultFile(url.searchParams.get("set") || "", url.searchParams.get("file") || "");
  if (!file) return Response.json({ error: "Unknown result file" }, { status: 404 });
  const name = file.split(/[\\/]/).pop()!;
  return new Response(fs.readFileSync(file), { headers: {
    "Content-Type": TYPES[name.split(".").pop()!] ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename="${name}"`,
  } });
}
