/** Display helpers shared by server and client components. */
export function money(v: unknown): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function pct(v: unknown, digits = 1): string {
  return typeof v === "number" && Number.isFinite(v) ? `${(100 * v).toFixed(digits)}%` : "—";
}

export function num(v: unknown, digits = 3): string {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

export function int(v: unknown): string {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—";
}

export function version(v: unknown): string {
  return typeof v === "number" ? `v${String(v).padStart(3, "0")}` : "—";
}

export type Tone = "good" | "warn" | "bad" | "info" | "muted";

export function statusTone(status: string | null | undefined): Tone {
  if (!status) return "info";
  if (status.includes("predictive")) return "bad";
  if (status.includes("covariate") || status.includes("insufficient")) return "warn";
  return "good";
}

export function decisionTone(status: string | null | undefined): Tone {
  return ({ pending: "info", promoted: "good", deferred: "good", rejected: "bad", failed: "bad", stale: "warn",
    interrupted: "warn" } as Record<string, Tone>)[status || ""] ?? "warn";
}

export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : Number(v.toFixed(4)).toString();
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

/** Tiny Markdown subset (headings, lists, quotes, rules, bold/italic/code). Everything is HTML-escaped first. */
export function markdownToHtml(md: string): string {
  const out: string[] = [];
  let list = false;
  const closeList = () => {
    if (list) out.push("</ul>");
    list = false;
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (/^\s*[-*] /.test(line)) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(line.replace(/^\s*[-*] /, ""))}</li>`);
      continue;
    }
    closeList();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`);
    else if (/^---+$/.test(line.trim())) out.push("<hr/>");
    else if (line.startsWith(">")) out.push(`<blockquote>${inline(line.replace(/^>\s?/, ""))}</blockquote>`);
    else out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("\n");
}
