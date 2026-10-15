import type { Tone } from "@/components/rw";
import type { JobRow } from "@/lib/types";

export function jobTone(s: JobRow["status"]): Tone {
  return s === "completed" ? "ok" : s === "failed" ? "bad" : s === "cancelled" || s === "interrupted" ? "warn" : "info";
}
