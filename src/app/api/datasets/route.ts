import { route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const GET = route(async () => engineCall("datasets", {}, { timeoutMs: 120_000 }));
