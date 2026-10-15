/**
 * The one email design used by RetrainWise: sign-in codes, approval requests,
 * invitations and work reports. Table layout with inline styles so it renders
 * the same in Gmail, Outlook and Apple Mail; plain-text twin for every email.
 */

export type EmailFact = [label: string, value: string];
export type EmailTone = "neutral" | "ok" | "warn" | "bad";

export type EmailContent = {
  /** Hidden preview line shown by inboxes next to the subject. */
  preheader: string;
  /** Small label above the title, e.g. "Work report" or "Sign-in". */
  eyebrow?: string;
  title: string;
  /** Status chip next to the eyebrow. */
  status?: { label: string; tone: EmailTone };
  paragraphs?: string[];
  /** Large one-time code block. */
  code?: string;
  /** Key facts as a two-column table (values are shown exactly as given). */
  facts?: EmailFact[];
  cta?: { label: string; url: string };
  /** Small print under the card (why you got this, security notes). */
  footnote?: string;
  /** Workspace or context line shown in the header. */
  context?: string;
};

const INK = "#0a0a0a";
const INK2 = "#3f3f3c";
const MUTED = "#8a8a87";
const LINE = "#e7e7e4";
const PAPER = "#f6f6f4";
const TONES: Record<EmailTone, { fg: string; bg: string }> = {
  neutral: { fg: "#3f3f3c", bg: "#efefec" },
  ok: { fg: "#16794a", bg: "#e8f4ed" },
  warn: { fg: "#8a4b00", bg: "#fbf1e2" },
  bad: { fg: "#b42318", bg: "#fbeceb" },
};
const FONT = "Montserrat,'Segoe UI',-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,'SF Mono','Cascadia Mono',Consolas,'Courier New',monospace";

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function appUrl() {
  return (process.env.AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function renderEmail(c: EmailContent): { html: string; text: string } {
  const base = appUrl();
  const status = c.status
    ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:${TONES[c.status.tone].bg};color:${TONES[c.status.tone].fg};font-size:11px;font-weight:600;letter-spacing:0.02em;vertical-align:middle">${esc(c.status.label)}</span>`
    : "";
  const paragraphs = (c.paragraphs ?? [])
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px;font-size:14.5px;line-height:1.65;color:${INK2}">${esc(p)}</p>`)
    .join("");
  const code = c.code
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 22px"><tr>${c.code
        .split("")
        .map(
          (d) =>
            `<td style="padding:0 4px 0 0"><div style="width:46px;height:58px;line-height:58px;text-align:center;border:1px solid ${LINE};border-radius:10px;background:${PAPER};font-family:${MONO};font-size:28px;font-weight:700;color:${INK}">${esc(d)}</div></td>`,
        )
        .join("")}</tr></table>`
    : "";
  const facts = c.facts?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 22px;border:1px solid ${LINE};border-radius:10px;border-collapse:separate;overflow:hidden">${c.facts
        .map(
          ([k, v], i) =>
            `<tr><td style="padding:11px 16px;${i ? `border-top:1px solid ${LINE};` : ""}font-size:12.5px;color:${MUTED};width:42%;vertical-align:top">${esc(k)}</td><td style="padding:11px 16px;${i ? `border-top:1px solid ${LINE};` : ""}font-size:13.5px;color:${INK};font-weight:500;vertical-align:top;word-break:break-word">${esc(v)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const cta = c.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px"><tr><td style="border-radius:8px;background:${INK}"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${esc(c.cta.label)} &rarr;</a></td></tr></table>
       <p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;color:${MUTED};word-break:break-all">Or open: <a href="${esc(c.cta.url)}" style="color:${MUTED}">${esc(c.cta.url)}</a></p>`
    : "";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(c.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${PAPER};font-family:${FONT};color:${INK};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 4px 14px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-size:19px;font-weight:700;letter-spacing:-0.02em;color:${INK}"><span style="display:inline-block;width:22px;height:22px;line-height:22px;margin-right:8px;border-radius:6px;background:${INK};color:#fff;text-align:center;font-size:12px;font-weight:700;vertical-align:-3px">R</span>RetrainWise</td>
        <td align="right" style="font-size:12px;color:${MUTED}">${c.context ? esc(c.context) : ""}</td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden">
      <div style="height:4px;background:${INK}"></div>
      <div style="padding:30px 32px 28px">
        ${c.eyebrow ? `<div style="margin:0 0 10px;font-size:11.5px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED}">${esc(c.eyebrow)}${status}</div>` : status ? `<div style="margin:0 0 10px">${status}</div>` : ""}
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${INK}">${esc(c.title)}</h1>
        ${paragraphs}${code}${facts}${cta}
      </div>
    </td></tr>
    <tr><td style="padding:18px 8px 0;font-size:11.5px;line-height:1.6;color:${MUTED}">
      ${c.footnote ? `<p style="margin:0 0 10px">${esc(c.footnote)}</p>` : ""}
      <p style="margin:0">RetrainWise · cost-aware model retraining · <a href="${base}/profile" style="color:${MUTED}">Email preferences</a> · <a href="${base}/privacy" style="color:${MUTED}">Privacy</a></p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    "RetrainWise" + (c.context ? ` · ${c.context}` : ""),
    "",
    (c.eyebrow ? `${c.eyebrow.toUpperCase()}${c.status ? ` · ${c.status.label}` : ""}\n` : "") + c.title,
    "",
    ...(c.paragraphs ?? []).filter(Boolean).flatMap((p) => [p, ""]),
    ...(c.code ? [`Code: ${c.code}`, ""] : []),
    ...(c.facts?.length ? [...c.facts.map(([k, v]) => `${k}: ${v}`), ""] : []),
    ...(c.cta ? [`${c.cta.label}: ${c.cta.url}`, ""] : []),
    ...(c.footnote ? [c.footnote, ""] : []),
    `Email preferences: ${base}/profile`,
  ].join("\n");

  return { html, text };
}
