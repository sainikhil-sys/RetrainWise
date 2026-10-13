import { route } from "@/lib/api";
import { engine } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Engine status for the header indicator. `?start=1` warms up the Python process. */
export const GET = route(async (req) => {
  const e = engine();
  const s = e.status();
  if (req.nextUrl.searchParams.get("start") === "1" && s.state !== "ready" && s.state !== "starting" && !s.active) {
    void e.call("ping", {}, { timeoutMs: 180_000, dedupeKey: "ping" }).catch(() => undefined);
  }
  return e.status();
});
