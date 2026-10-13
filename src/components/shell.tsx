"use client";

import {
  Activity,
  Bot,
  Database,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Loader2,
  Menu,
  Scale,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { money, version } from "@/lib/format";
import type { EngineStatus } from "@/lib/engine";
import { Tip, cn } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/data", label: "Data & simulation", icon: Database },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/decisions", label: "Decision analysis", icon: Scale },
  { href: "/lifecycle", label: "Model lifecycle", icon: GitBranch },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/agent", label: "Agent & audit", icon: Bot },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export type ShellRun = {
  id: string;
  dataset: string;
  size: string;
  position: number;
  rows: number;
  version: number | null;
  spent: number;
  budget: number;
} | null;

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-teal-300 to-teal-600 shadow-lg shadow-teal-500/20">
        <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5 text-navy-950" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.7" />
          <path d="M20 4v4.7h-4.7" />
          <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.3" />
          <path d="M4 20v-4.7h4.7" />
        </svg>
      </div>
      <div>
        <div className="text-[15px] font-semibold tracking-tight text-slate-50">RetrainWise</div>
        <div className="text-[11px] text-slate-400">Lifecycle-aware ML decisions</div>
      </div>
    </div>
  );
}

function EngineIndicator() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    let alive = true;
    let first = true;
    const poll = async () => {
      try {
        const res = await fetch(`/api/engine${first ? "?start=1" : ""}`, { cache: "no-store" });
        first = false;
        if (res.ok && alive) setStatus(await res.json());
      } catch {
        /* server restarting */
      }
    };
    void poll();
    const t = setInterval(poll, 2500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!status) return null;
  const busy = status.active ?? (status.isolated.length ? { label: status.isolated[0] } : null);
  const tone =
    status.state === "failed" ? "bg-rose-400" : status.state === "ready" ? (busy ? "bg-amber-400" : "bg-emerald-400") : "bg-sky-400";
  const text =
    status.state === "failed"
      ? "Engine unavailable"
      : status.state === "starting"
        ? "Starting Python engine…"
        : busy
          ? busy.label
          : status.state === "ready"
            ? "Python engine ready"
            : "Engine idle";
  const detail =
    status.state === "failed"
      ? `${status.lastError ?? ""} Interpreter: ${status.python}. Run "npm run setup:python" or set RETRAINWISE_PYTHON.`
      : `Interpreter: ${status.python} (${status.pythonSource}). Lifecycle commands run one at a time in this process.${status.queued ? ` ${status.queued} queued.` : ""}`;
  return (
    <Tip text={detail} side="top">
      <div tabIndex={0} className="flex items-center gap-2 rounded-lg border border-slate-800 bg-navy-950/60 px-3 py-2 text-xs text-slate-300" aria-live="polite">
        {busy || status.state === "starting" ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin text-amber-300" />
        ) : (
          <span aria-hidden className={cn("h-2 w-2 rounded-full", tone)} />
        )}
        <span className="truncate">{text}</span>
      </div>
    </Tip>
  );
}

function Sidebar({ run, autonomy, onNavigate }: { run: ShellRun; autonomy: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-5 px-4 py-5">
      <Logo />
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-teal-400/10 text-teal-200 ring-1 ring-inset ring-teal-400/25" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100",
              )}
            >
              <Icon aria-hidden className={cn("h-4 w-4", active ? "text-teal-300" : "text-slate-500 group-hover:text-slate-300")} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-3">
        {run ? (
          <div className="rounded-xl border border-slate-800 bg-navy-950/50 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold uppercase tracking-wider text-slate-400">Active run</span>
              <span className="font-mono text-slate-500">{run.id}</span>
            </div>
            <div className="mt-1.5 text-sm text-slate-200">
              {run.dataset} · {run.size}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label="Stream progress" aria-valuenow={Math.round((run.position / run.rows) * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-teal-400" style={{ width: `${Math.min(100, (run.position / run.rows) * 100)}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-slate-400 tabular">
              <span>
                row {run.position.toLocaleString()} / {run.rows.toLocaleString()}
              </span>
              <span>{version(run.version)}</span>
            </div>
            <div className="mt-1 text-slate-400 tabular">
              spent {money(run.spent)} of {money(run.budget, 0)} <span className="text-amber-300/80">(simulated)</span>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700 p-3 text-xs text-slate-400">
            No active run. Start one in <Link href="/data" className="text-teal-300 underline-offset-2 hover:underline" onClick={onNavigate}>Data & simulation</Link>.
          </div>
        )}
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-xs font-medium ring-1 ring-inset",
            autonomy ? "bg-amber-400/10 text-amber-200 ring-amber-400/30" : "bg-emerald-400/10 text-emerald-200 ring-emerald-400/25",
          )}
        >
          {autonomy ? "Bounded autonomy ON — limits enforced" : "Recommendation-only · human approval required"}
        </div>
        <EngineIndicator />
      </div>
    </div>
  );
}

export function AppShell({ run, autonomy, children }: { run: ShellRun; autonomy: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-teal-400 focus:px-3 focus:py-2 focus:text-navy-950">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-slate-800/80 bg-navy-900/90 backdrop-blur lg:block">
        <Sidebar run={run} autonomy={autonomy} />
      </aside>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800/80 bg-navy-900/90 px-4 py-3 backdrop-blur lg:hidden">
        <Logo />
        <button aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-slate-800 bg-navy-900">
            <Sidebar run={run} autonomy={autonomy} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <main id="main" className="lg:pl-64">
        <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
      </main>
    </div>
  );
}
