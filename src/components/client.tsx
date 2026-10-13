"use client";

import { CheckCircle2, Loader2, OctagonAlert, X, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

import { cn, inputClass } from "./ui";

/* ------------------------------------------------------------------ Button */
const VARIANT = {
  primary: "bg-teal-400 text-navy-950 hover:bg-teal-300 shadow-[0_0_0_1px_rgba(45,212,191,0.4),0_8px_24px_-8px_rgba(45,212,191,0.5)]",
  secondary: "bg-slate-800 text-slate-100 ring-1 ring-inset ring-slate-700 hover:bg-slate-700",
  ghost: "text-slate-300 hover:bg-slate-800 hover:text-slate-100",
  danger: "bg-rose-500/90 text-white hover:bg-rose-500",
  outline: "text-teal-200 ring-1 ring-inset ring-teal-400/40 hover:bg-teal-400/10",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon: Icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof VARIANT;
  size?: "sm" | "md";
  loading?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        VARIANT[variant],
        className,
      )}
    >
      {loading ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : Icon ? <Icon aria-hidden className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- Toasts */
type Toast = { id: number; tone: "good" | "bad" | "info"; title: string; body?: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.tone === "bad" ? 9000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "bad" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex gap-3 rounded-xl border bg-navy-900/95 px-4 py-3 text-sm shadow-2xl shadow-black/50 backdrop-blur",
              t.tone === "good" && "border-emerald-400/30",
              t.tone === "bad" && "border-rose-400/40",
              t.tone === "info" && "border-sky-400/30",
            )}
          >
            {t.tone === "bad" ? (
              <OctagonAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
            ) : (
              <CheckCircle2 aria-hidden className={cn("mt-0.5 h-4 w-4 shrink-0", t.tone === "good" ? "text-emerald-300" : "text-sky-300")} />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-100">{t.title}</div>
              {t.body && <div className="mt-0.5 break-words text-slate-400">{t.body}</div>}
            </div>
            <button aria-label="Dismiss notification" className="text-slate-500 hover:text-slate-200" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* --------------------------------------------------------------- API calls */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 300) };
  }
  if (!res.ok) throw new ApiError((data as { error?: string })?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

/**
 * Run a mutating request once at a time (duplicate clicks are ignored while it
 * is in flight), show a toast for the outcome and refresh server data.
 */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(
      url: string,
      body: unknown,
      opts: { method?: string; success?: (r: T) => string | null; successBody?: (r: T) => string | undefined; failure?: string } = {},
    ): Promise<T | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await api<T>(url, { method: opts.method ?? "POST", body: body ?? {} });
        const title = opts.success ? opts.success(result) : "Done";
        if (title) toast({ tone: "good", title, body: opts.successBody?.(result) });
        startTransition(() => router.refresh());
        return result;
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        toast({ tone: "bad", title: opts.failure ?? "Action failed", body: message });
        startTransition(() => router.refresh());
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [router, toast],
  );
  return { run, pending: pending || refreshing, error, clearError: () => setError(null) };
}

/** Refresh server components on an interval while `active` is true. */
export function useAutoRefresh(active: boolean, ms = 2000) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
}

/* ---------------------------------------------------------------- Tabs */
export function Tabs({ tabs, initial }: { tabs: { id: string; label: string; content: ReactNode; badge?: ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const base = useId();
  return (
    <div>
      <div role="tablist" aria-label="Sections" className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-navy-900/70 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`${base}-panel-${t.id}`}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === t.id);
              if (e.key === "ArrowRight") setActive(tabs[(i + 1) % tabs.length].id);
              if (e.key === "ArrowLeft") setActive(tabs[(i - 1 + tabs.length) % tabs.length].id);
            }}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
              active === t.id ? "bg-slate-800 text-teal-200 shadow ring-1 ring-slate-700" : "text-slate-400 hover:text-slate-200",
            )}
          >
            {t.label}
            {t.badge}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-panel-${t.id}`} aria-labelledby={`${base}-tab-${t.id}`} hidden={active !== t.id} className="mt-4">
          {active === t.id && t.content}
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Inputs */
export { inputClass };

export function Field({ label, help, error, children, htmlFor }: { label: ReactNode; help?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-200">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-rose-300">
          {error}
        </p>
      ) : help ? (
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{help}</p>
      ) : null}
    </div>
  );
}

export function Toggle({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", checked ? "bg-teal-400" : "bg-slate-700")}
    >
      <span className={cn("inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform", checked ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
  labels,
  disabled,
  ariaLabel,
}: {
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  labels?: Partial<Record<T, string>>;
  disabled?: (o: T) => boolean;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        const off = disabled?.(o) ?? false;
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            disabled={off}
            onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              on ? "bg-teal-400/15 text-teal-200 ring-teal-400/50" : "bg-slate-800/60 text-slate-400 ring-slate-700 hover:text-slate-200",
            )}
          >
            {labels?.[o] ?? o}
          </button>
        );
      })}
    </div>
  );
}
