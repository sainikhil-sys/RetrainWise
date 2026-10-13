import { ArrowRight, Info } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/*
 * RetrainWise product components. Editorial black-and-white: hierarchy comes
 * from type, spacing and hairlines, not from cards and color. Color appears
 * only as operational status (ok / warn / bad).
 */

export type Tone = "ok" | "warn" | "bad" | "neutral" | "info";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 pb-8 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl" data-reveal>
        {eyebrow && <div className="mb-2 text-[12px] font-medium tracking-wide text-muted-foreground">{eyebrow}</div>}
        <h1 className="font-serif text-[40px] leading-[1.05] tracking-[-0.01em] text-foreground md:text-[44px]">{title}</h1>
        {description && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{description}</p>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2" data-reveal>
          {actions}
        </div>
      )}
    </header>
  );
}

export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} className="inline-flex size-4 items-center justify-center rounded-full text-ink-3 transition-colors hover:text-foreground">
          <Info size={13} weight="regular" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-[12px] leading-relaxed">{children}</TooltipContent>
    </Tooltip>
  );
}

export type Metric = { label: string; value: ReactNode; sub?: ReactNode; info?: string; tone?: Tone };

/** A restrained strip of 3–5 key figures separated by hairlines (not cards). */
export function MetricStrip({ items, className }: { items: Metric[]; className?: string }) {
  return (
    <div
      className={cn("grid grid-cols-2 border-y border-border md:grid-cols-[repeat(var(--n),minmax(0,1fr))]", className)}
      style={{ ["--n" as string]: items.length }}
      data-reveal
    >
      {items.map((m, i) => (
        <div key={m.label} className={cn("px-0 py-5 md:px-6 md:first:pl-0", i > 0 && "md:border-l md:border-border", i % 2 === 1 && "max-md:border-l max-md:pl-5", i >= 2 && "max-md:border-t")}>
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {m.tone && m.tone !== "neutral" && <StatusDot tone={m.tone} />}
            {m.label}
            {m.info && <InfoTip label={m.label}>{m.info}</InfoTip>}
          </div>
          <div className="mt-1.5 text-[28px] font-medium leading-none tracking-tight tabular text-foreground">{m.value}</div>
          {m.sub && <div className="mt-2 text-[12.5px] leading-snug text-muted-foreground">{m.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  className,
  id,
  flush,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  flush?: boolean;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20", !flush && "pt-10", className)} data-reveal>
      {(title || action) && (
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-2xl">
            {title && <h2 className="font-serif text-[24px] leading-tight tracking-[-0.005em]">{title}</h2>}
            {description && <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

const DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", neutral: "bg-ink-3", info: "bg-foreground" };
const TEXT: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", bad: "text-bad", neutral: "text-ink-2", info: "text-foreground" };

export function StatusDot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", DOT[tone], className)} />;
}

/** Mostly monochrome status: a dot plus text; color only carries operational meaning. */
export function Status({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[12.5px] font-medium", TEXT[tone], className)}>
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/** Small neutral tag (mono), e.g. for event kinds, versions and states. */
export function Tag({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px font-mono text-[11px] leading-[18px]",
        tone === "neutral" && "border-border bg-subtle text-ink-2",
        tone === "info" && "border-foreground/80 bg-white text-foreground",
        tone === "ok" && "border-ok/30 bg-ok-soft text-ok",
        tone === "warn" && "border-warn/30 bg-warn-soft text-warn",
        tone === "bad" && "border-bad/30 bg-bad-soft text-bad",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-white px-1 font-mono text-[10.5px] text-ink-2 shadow-[0_1px_0_rgba(0,0,0,0.06)]", className)}>
      {children}
    </kbd>
  );
}

export function SimLabel({ children = "Simulated cost", hint }: { children?: ReactNode; hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help text-[11.5px] text-muted-foreground underline decoration-dotted decoration-ink-3 underline-offset-[3px]">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-[12px] leading-relaxed">
        {hint ??
          "Dollar figures use an assumed pricing snapshot, assumed engineer hours and an expected incident cost. No real billing is involved; deployment is a local registry swap."}
      </TooltipContent>
    </Tooltip>
  );
}

export function EmptyState({ icon: IconC, title, children, action, className }: { icon?: Icon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-6 py-10 sm:items-center sm:text-center", className)}>
      {IconC && <IconC size={28} weight="thin" className="text-ink-3" />}
      <div>
        <h3 className="text-[15px] font-medium">{title}</h3>
        {children && <div className="mx-auto mt-1 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">{children}</div>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** The one obvious next action for the current state. */
export function NextStep({ title, children, action, step }: { title: ReactNode; children?: ReactNode; action?: ReactNode; step?: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-foreground bg-white p-5 sm:flex-row sm:items-center sm:justify-between" data-reveal>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <ArrowRight size={12} weight="bold" className="text-foreground" />
          Next step{step && <span className="text-ink-3">· {step}</span>}
        </div>
        <div className="mt-1 font-serif text-[22px] leading-tight">{title}</div>
        {children && <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{children}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export type TimelineItem = { id: string | number; when: ReactNode; title: ReactNode; meta?: ReactNode; tone?: Tone; tag?: string };

/** Linear-style activity timeline. */
export function Timeline({ items, empty = "No activity yet." }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="text-[13.5px] text-muted-foreground">{empty}</p>;
  return (
    <ol className="relative">
      {items.map((item, i) => (
        <li key={item.id} className="relative flex gap-4 pb-5 last:pb-0">
          {i < items.length - 1 && <span aria-hidden className="absolute left-[3px] top-3 h-full w-px bg-border" />}
          <span aria-hidden className={cn("relative mt-[7px] size-[7px] shrink-0 rounded-full ring-4 ring-white", DOT[item.tone ?? "neutral"])} />
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] leading-snug text-foreground">{item.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              <span>{item.when}</span>
              {item.meta && (
                <>
                  <span aria-hidden>·</span>
                  {item.meta}
                </>
              )}
              {item.tag && <Tag>{item.tag}</Tag>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function KV({ items, className, columns = 1 }: { items: Array<[ReactNode, ReactNode]>; className?: string; columns?: 1 | 2 }) {
  return (
    <dl className={cn("grid gap-x-8 text-[13.5px]", columns === 2 && "sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 border-b border-border py-2">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 text-right font-medium tabular text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; align?: "right" | "center"; className?: string; mobile?: boolean };

/**
 * Compact table with sticky header and subtle row hover; on narrow screens it
 * becomes a list of label/value rows per record.
 */
export function DataTable<T>({ columns, rows, rowKey, empty, caption, className, onRowHref }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: ReactNode;
  caption?: string;
  className?: string;
  onRowHref?: (row: T) => string;
}) {
  if (!rows.length) return <div className="py-8 text-center text-[13.5px] text-muted-foreground">{empty ?? "Nothing here yet."}</div>;
  return (
    <div className={className}>
      <div className="hidden max-h-[560px] overflow-auto rounded-md border border-border md:block">
        <table className="w-full border-collapse text-left text-[13px]">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="sticky top-0 z-10 bg-subtle">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("border-b border-border px-3 py-2 text-[11.5px] font-medium text-muted-foreground", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border last:border-0 transition-colors hover:bg-subtle">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-3 py-2.5 align-top tabular", c.align === "right" && "text-right", c.align === "center" && "text-center", c.className)}>
                    {onRowHref && i === 0 ? (
                      <Link href={onRowHref(row)} className="font-medium underline decoration-border underline-offset-4 hover:decoration-foreground">
                        {c.cell(row)}
                      </Link>
                    ) : (
                      c.cell(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-border rounded-md border border-border md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="px-3 py-3">
            {columns
              .filter((c) => c.mobile !== false)
              .map((c, i) => (
                <div key={c.key} className={cn("flex items-baseline justify-between gap-3 py-0.5 text-[13px]", i === 0 && "pb-1.5 text-[14px] font-medium")}>
                  {i > 0 && <span className="text-[12px] text-muted-foreground">{c.header}</span>}
                  <span className={cn("min-w-0 tabular", i > 0 && "text-right")}>
                    {onRowHref && i === 0 ? <Link href={onRowHref(row)} className="underline underline-offset-4">{c.cell(row)}</Link> : c.cell(row)}
                  </span>
                </div>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Plain-language explanation block (collapsible, native details). */
export function Explainer({ title = "How to read this", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="group border-t border-border pt-4 text-[13.5px]" data-reveal>
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground marker:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-3 max-w-3xl space-y-2 leading-relaxed text-ink-2">{children}</div>
    </details>
  );
}

export function Callout({ tone = "neutral", title, children, action, className }: { tone?: Tone; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div
      role={tone === "bad" ? "alert" : "note"}
      className={cn(
        "flex flex-col gap-2 rounded-md border px-4 py-3 text-[13.5px] sm:flex-row sm:items-start sm:justify-between",
        tone === "neutral" && "border-border bg-subtle",
        tone === "info" && "border-foreground/80 bg-white",
        tone === "ok" && "border-ok/25 bg-ok-soft",
        tone === "warn" && "border-warn/25 bg-warn-soft",
        tone === "bad" && "border-bad/25 bg-bad-soft",
        className,
      )}
      data-reveal
    >
      <div className="min-w-0">
        {title && <div className={cn("font-medium", TEXT[tone === "neutral" ? "info" : tone])}>{title}</div>}
        {children && <div className="mt-0.5 leading-relaxed text-ink-2">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
