import type { ReactNode } from "react";
import { cellText, type Tone } from "@/lib/format";

export function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <h1>{title}</h1>
      <p className="subtitle">{subtitle}</p>
    </>
  );
}

const ICONS: Record<Tone, string> = { good: "✔", warn: "▲", bad: "✖", info: "ℹ", muted: "•" };

export function Badge({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{ICONS[tone]} {children}</span>;
}

export function Alert({ tone = "info", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`alert ${tone}`} role={tone === "bad" ? "alert" : "status"}>{children}</div>;
}

export function Metric({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label?: string;
  num?: boolean;
  render?: (row: T) => ReactNode;
}

/** Plain table; columns default to every key of the first row. */
export function DataTable<T extends Record<string, unknown>>({ rows, columns, empty = "No rows.", max = 500 }:
  { rows: T[]; columns?: Column<T>[]; empty?: string; max?: number }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  const cols: Column<T>[] = columns ?? Object.keys(rows[0]).map((key) => ({ key, num: typeof rows[0][key] === "number" }));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map((c) => <th key={c.key} className={c.num ? "num" : undefined}>{c.label ?? c.key}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <Cell key={c.key} num={c.num}>{c.render ? c.render(row) : cellText(row[c.key])}</Cell>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Short values stay on one line; long text (payloads, reasons) wraps. */
function Cell({ num, children }: { num?: boolean; children: ReactNode }) {
  const long = typeof children === "string" && children.length > 48;
  return <td className={num ? "num" : long ? "wrap" : "nowrap"}>{children}</td>;
}

export function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
