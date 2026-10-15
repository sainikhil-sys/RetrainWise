/** Display helpers shared by server and client components. */

export function money(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "−" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function num(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fixed(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function signed(v: number | null | undefined, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;
}

export function version(v: number | null | undefined): string {
  return v == null ? "—" : `v${String(v).padStart(3, "0")}`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ago(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export type Tone = "good" | "warn" | "bad" | "info" | "neutral" | "accent";

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "neutral";
  if (status.includes("predictive")) return "bad";
  if (status.includes("covariate") || status.includes("insufficient")) return "warn";
  if (status === "stable") return "good";
  return "neutral";
}

export function decisionTone(status: string | null | undefined): Tone {
  switch (status) {
    case "pending":
      return "info";
    case "promoted":
    case "deferred":
      return "good";
    case "rejected":
    case "failed":
      return "bad";
    case "stale":
    case "interrupted":
      return "warn";
    default:
      return "neutral";
  }
}

export function jobTone(status: string): Tone {
  return (
    { completed: "good", running: "info", queued: "info", failed: "bad", cancelled: "warn", interrupted: "warn" } as Record<string, Tone>
  )[status] ?? "neutral";
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
