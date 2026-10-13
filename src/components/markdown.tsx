import { Fragment, type ReactNode } from "react";

/**
 * Minimal, safe Markdown renderer for agent reports (no raw HTML is ever injected).
 * Supports headings, **bold**, `code`, bullet lists, > quotes, --- rules and the
 * <details>/<summary> wrapper the engine uses for verified figures.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={i++}>{tok.slice(2, -2)}</strong> : <code key={i++}>{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const cleaned = text
    .replace(/<details>\s*<summary>(.*?)<\/summary>/g, "\n### $1\n")
    .replace(/<\/details>/g, "")
    .replace(/<[^>]+>/g, "");
  const lines = cleaned.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={`l${blocks.length}`}>
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
    if (quote.length) {
      blocks.push(<blockquote key={`q${blocks.length}`}>{inline(quote.join(" "))}</blockquote>);
      quote = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      if (quote.length) flush();
      list.push(line.replace(/^\s*[-*]\s+/, ""));
      continue;
    }
    if (line.startsWith(">")) {
      if (list.length) flush();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flush();
    if (!line.trim()) continue;
    if (/^-{3,}$/.test(line.trim())) blocks.push(<hr key={`h${blocks.length}`} />);
    else if (/^#{1,6}\s/.test(line)) blocks.push(<h3 key={`t${blocks.length}`}>{inline(line.replace(/^#+\s/, ""))}</h3>);
    else if (/^\*\*[^*]+\*\*$/.test(line.trim())) blocks.push(<h3 key={`t${blocks.length}`}>{line.trim().slice(2, -2)}</h3>);
    else blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
  }
  flush();
  return <div className="prose-report text-sm text-slate-300">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
