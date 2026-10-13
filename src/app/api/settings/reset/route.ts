import { route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const POST = route(async () => engineCall("reset_settings", {}, { timeoutMs: 60_000, dedupeKey: "settings" }));
