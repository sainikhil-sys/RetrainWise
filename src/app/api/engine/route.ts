import { route } from "@/lib/api";
import { ENGINE_MODE, engine, remoteStatus } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Engine status for the status indicator. `?start=1` warms up the Python process. */
export const GET = route(async (req) => {
  if (ENGINE_MODE !== "local") return remoteStatus();
  const e = engine();
  const s = e.status();
  if (req.nextUrl.searchParams.get("start") === "1" && s.state !== "ready" && s.state !== "starting" && !s.active) {
    void e.call("ping", {}, { timeoutMs: 180_000, dedupeKey: "ping" }).catch(() => undefined);
  }
  const { stderrTail, ...rest } = e.status();
  void stderrTail;
  return rest;
});
