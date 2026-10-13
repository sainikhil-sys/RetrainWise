import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Tone } from "@/lib/format";

/* Presentational primitives. No hooks, so they work in server and client components. */

export function cn(...args: Parameters<typeof clsx>) {
  return clsx(...args);
}

const TONE_BADGE: Record<Tone, string> = {
  good: "bg-emerald-500/12 text-emerald-300 ring-emerald-400/30",
  warn: "bg-amber-500/12 text-amber-300 ring-amber-400/30",
  bad: "bg-rose-500/12 text-rose-300 ring-rose-400/30",
  info: "bg-sky-500/12 text-sky-300 ring-sky-400/30",
  neutral: "bg-slate-500/15 text-slate-300 ring-slate-400/25",
  accent: "bg-teal-400/12 text-teal-300 ring-teal-400/30",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Marks numbers that come from assumptions or generated data rather than measurement. */
export function SimLabel({ kind = "simulated", className }: { kind?: "simulated" | "assumed" | "synthetic"; className?: string }) {
  const text = { simulated: "Simulated cost", assumed: "Assumed pricing", synthetic: "Synthetic data" }[kind];
  return (
    <Tip text={kind === "synthetic" ? "Generated locally by the engine with known drift points; not real-world data." : "Dollar figures come from assumed prices and engineer-hour estimates in pricing_snapshot.json and Settings. No real money or cloud billing is involved."}>
      <span className={cn("inline-flex items-center gap-1 rounded-md border border-dashed border-amber-400/40 bg-amber-400/5 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-300/90", className)}>
        {text}
      </span>
    </Tip>
  );
}

export function Card({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-2xl border border-slate-800/80 bg-navy-900/80 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset] backdrop-blur", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  info,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  info?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/70 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-100">
          {Icon && <Icon aria-hidden className="h-4 w-4 text-teal-300" />}
          {title}
          {info && <InfoTip text={info} />}
        </h2>
        {description && <p className="mt-1 text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}

/** Accessible CSS tooltip: shown on hover and on keyboard focus. */
export function Tip({ text, children, side = "top" }: { text: string; children: ReactNode; side?: "top" | "bottom" }) {
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-72 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-200 opacity-0 shadow-xl shadow-black/40 transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {text}
      </span>
    </span>
  );
}

export function InfoTip({ text, label = "More information" }: { text: string; label?: string }) {
  return (
    <Tip text={text}>
      <button type="button" aria-label={`${label}: ${text}`} className="inline-flex h-4 w-4 items-center justify-center rounded-full text-slate-500 hover:text-teal-300">
        <Info aria-hidden className="h-3.5 w-3.5" />
      </button>
    </Tip>
  );
}

const STAT_TONE: Record<Tone, string> = {
  good: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  info: "text-sky-300",
  neutral: "text-slate-50",
  accent: "text-teal-300",
};

export function StatCard({
  label,
  value,
  sub,
  tone = "neutral",
  info,
  icon: Icon,
  footer,
  simulated,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  info?: string;
  icon?: LucideIcon;
  footer?: ReactNode;
  simulated?: boolean;
}) {
  return (
    <Card className="flex flex-col justify-between p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-slate-400">
          {label}
          {info && <InfoTip text={info} label={label} />}
        </span>
        {Icon && <Icon aria-hidden className="h-4 w-4 text-slate-500" />}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular", STAT_TONE[tone])}>{value}</div>
      {sub && <div className="mt-1 text-xs leading-relaxed text-slate-400">{sub}</div>}
      {(footer || simulated) && (
        <div className="mt-3 flex items-center gap-2">
          {footer}
          {simulated && <SimLabel />}
        </div>
      )}
    </Card>
  );
}

const ALERT_STYLE: Record<Tone, { box: string; icon: LucideIcon }> = {
  good: { box: "border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-100", icon: CheckCircle2 },
  warn: { box: "border-amber-400/25 bg-amber-400/[0.06] text-amber-100", icon: AlertTriangle },
  bad: { box: "border-rose-400/30 bg-rose-400/[0.07] text-rose-100", icon: OctagonAlert },
  info: { box: "border-sky-400/25 bg-sky-400/[0.06] text-sky-100", icon: Info },
  neutral: { box: "border-slate-700 bg-slate-800/40 text-slate-200", icon: Info },
  accent: { box: "border-teal-400/25 bg-teal-400/[0.06] text-teal-50", icon: Info },
};

export function Alert({ tone = "info", title, children, className, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  const { box, icon: Icon } = ALERT_STYLE[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm", box, className)}>
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 opacity-90" />
      <div className="min-w-0 flex-1 leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "opacity-90")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, children, action, className }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-700/80 px-6 py-10 text-center", className)}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-teal-400/10 ring-1 ring-teal-400/25">
        <Icon aria-hidden className="h-5 w-5 text-teal-300" />
      </div>
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      {children && <div className="mt-1 max-w-md text-sm leading-relaxed text-slate-400">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ value, label, tone = "accent", className, showValue = true }: { value: number; label?: string; tone?: Tone; className?: string; showValue?: boolean }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const color = { accent: "bg-teal-400", good: "bg-emerald-400", warn: "bg-amber-400", bad: "bg-rose-400", info: "bg-sky-400", neutral: "bg-slate-400" }[tone];
  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
          <span>{label}</span>
          {showValue && <span className="tabular">{(v * 100).toFixed(0)}%</span>}
        </div>
      )}
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label} className="h-2 overflow-hidden rounded-full bg-slate-800">
        <div className={cn("h-full rounded-full transition-all duration-500", color)} style={{ width: `${v * 100}%` }} />
      </div>
    </div>
  );
}

export function KV({ items, className }: { items: Array<[ReactNode, ReactNode]>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-slate-800/60 py-1.5">
          <dt className="text-slate-400">{k}</dt>
          <dd className="text-right font-medium text-slate-200 tabular">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ children, className, caption }: { children: ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-xl border border-slate-800/80", className)}>
      <table className="w-full min-w-max border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: "right" | "center" }) {
  return (
    <th scope="col" className={cn("sticky top-0 bg-navy-850 px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-slate-400", align === "right" && "text-right", align === "center" && "text-center", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className, align, mono }: { children?: ReactNode; className?: string; align?: "right" | "center"; mono?: boolean }) {
  return (
    <td className={cn("border-t border-slate-800/70 px-3 py-2.5 text-slate-300", align === "right" && "text-right tabular", align === "center" && "text-center", mono && "font-mono text-xs", className)}>
      {children}
    </td>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-teal-300/80">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50 sm:text-[28px]">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-400 sm:text-[15px]">{description}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Explainer({ title = "In plain language", children }: { title?: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 text-sm text-slate-300 open:bg-slate-900/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-slate-200 marker:hidden">
        <span aria-hidden className="text-teal-300 transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="mt-2 space-y-2 leading-relaxed text-slate-400">{children}</div>
    </details>
  );
}

export const inputClass =
  "h-10 w-full rounded-lg border border-slate-700 bg-navy-950/60 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-400/70 focus:outline-none focus:ring-2 focus:ring-teal-400/20 disabled:opacity-50 aria-[invalid=true]:border-rose-400/70";
