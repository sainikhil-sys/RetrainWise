import { route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

export const GET = route(async () => engineCall("ollama_status", {}, { timeoutMs: 30_000 }));
