"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

export type ActionState = { ok: boolean; message: string } | null;
export type FormAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function Submit({ children, className = "primary", pendingText, disabled }:
  { children: ReactNode; className?: string; pendingText?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending ? pendingText ?? "Working…" : children}
    </button>
  );
}

/** A form bound to a server action; shows the action's success or error message under the fields. */
export function ActionForm({ action, children, className, confirm }:
  { action: FormAction; children: ReactNode; className?: string; confirm?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className} onSubmit={(e) => {
      if (confirm && !window.confirm(confirm)) e.preventDefault();
    }}>
      {children}
      {state ? <div className={`alert ${state.ok ? "good" : "bad"}`} role="status">{state.message}</div> : null}
    </form>
  );
}

const NAV = [
  ["/", "🏠", "Overview"], ["/data", "🗂️", "Data and simulation"], ["/monitoring", "📈", "Monitoring"],
  ["/decision", "⚖️", "Decision analysis"], ["/lifecycle", "🧬", "Model lifecycle"], ["/experiments", "🧪", "Experiments"],
  ["/agent", "🤖", "Agent and audit"], ["/settings", "⚙️", "Settings"], ["/account", "👤", "Account"],
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Main">
      {NAV.map(([href, icon, label]) => (
        <Link key={href} href={href} className={path === href ? "active" : undefined}>
          <span aria-hidden>{icon}</span>{label}
        </Link>
      ))}
    </nav>
  );
}

export function Tabs({ labels, children }: { labels: string[]; children: ReactNode[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="tabs" role="tablist">
        {labels.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={i === active} className={i === active ? "active" : ""}
            onClick={() => setActive(i)}>{l}</button>
        ))}
      </div>
      <div role="tabpanel">{children[active]}</div>
    </div>
  );
}

/** Select that writes its value into the URL query string (server pages read it). */
export function QuerySelect({ name, value, options, label }:
  { name: string; value: string; options: [string, string][]; label: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set(name, e.target.value);
        router.push(`?${next.toString()}`, { scroll: false });
      }}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

/** Re-render the server page every `ms` while `active` (used for job progress). */
export function AutoRefresh({ active, ms = 2000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), ms);
    return () => clearInterval(id);
  }, [active, ms, router]);
  return null;
}

/** Number input that writes its value into the URL query string when committed (blur or Enter). */
export function QueryNumber({ name, value, label, min = 0 }: { name: string; value: number; label: string; min?: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const commit = (raw: string) => {
    const v = Number(raw);
    if (!Number.isInteger(v) || v < min || v === value) return;
    const next = new URLSearchParams(params.toString());
    next.set(name, String(v));
    router.push(`?${next.toString()}`, { scroll: false });
  };
  return (
    <label>
      {label}
      <input type="number" min={min} step={1} defaultValue={value} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }} />
    </label>
  );
}
