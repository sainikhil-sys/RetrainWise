"use client";

import { CircleNotch } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** JSON fetch helper for the app's API routes. */
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

type RunOptions<T> = {
  method?: string;
  success?: (r: T) => string | null;
  description?: (r: T) => string | undefined;
  failure?: string;
  refresh?: boolean;
};

/**
 * Run a mutating request at most once at a time (repeat clicks are ignored
 * while it is in flight), toast the outcome and refresh server data.
 */
export function useAction() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T,>(url: string, body: unknown, opts: RunOptions<T> = {}): Promise<T | null> => {
      if (inFlight.current) return null;
      inFlight.current = true;
      setPending(true);
      setError(null);
      try {
        const result = await api<T>(url, { method: opts.method ?? "POST", body: body ?? {} });
        const title = opts.success ? opts.success(result) : null;
        if (title) toast.success(title, { description: opts.description?.(result) });
        if (opts.refresh !== false) startTransition(() => router.refresh());
        return result;
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        toast.error(opts.failure ?? "Action failed", { description: message });
        return null;
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [router],
  );
  return { run, pending, refreshing, busy: pending || refreshing, error, clearError: () => setError(null) };
}

/** Re-render server components periodically while `active`. */
export function useAutoRefresh(active: boolean, ms = 2500) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
}

export function Spinner({ className }: { className?: string }) {
  return <CircleNotch aria-hidden className={`size-3.5 animate-spin ${className ?? ""}`} />;
}

/**
 * Confirmation dialog for consequential actions (promotion, rollback, risky
 * updates): crisp panel, serif title, explicit primary action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  destructive,
  pending,
  onConfirm,
  disabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  disabled?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <AlertDialogContent className="max-w-lg gap-5 rounded-lg border-border p-6 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.35)]">
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-[26px] font-normal leading-tight">{title}</AlertDialogTitle>
          {description && <AlertDialogDescription className="text-[13.5px] leading-relaxed text-ink-2">{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="h-8 text-[13px]">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || disabled}
            onClick={(e) => {
              e.preventDefault();
              void onConfirm();
            }}
            className={destructive ? "h-8 bg-bad text-[13px] text-white hover:bg-bad/90" : "h-8 text-[13px]"}
          >
            {pending && <Spinner />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Right-side contextual panel for details, activity, help or approval actions. */
export function RightPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={`w-full gap-0 overflow-y-auto border-l border-border p-0 sm:max-w-md ${wide ? "lg:max-w-2xl" : ""}`}>
        <SheetHeader className="border-b border-border px-6 py-5">
          <SheetTitle className="font-serif text-[24px] font-normal leading-tight">{title}</SheetTitle>
          {description && <SheetDescription className="text-[13px]">{description}</SheetDescription>}
        </SheetHeader>
        <div className="px-6 py-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** Button that opens a RightPanel with the given content. */
export function PanelButton({ label, title, description, children, variant = "secondary", wide }: { label: ReactNode; title: ReactNode; description?: ReactNode; children: ReactNode; variant?: "secondary" | "ghost" | "outline" | "default"; wide?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <RightPanel open={open} onOpenChange={setOpen} title={title} description={description} wide={wide}>
        {children}
      </RightPanel>
    </>
  );
}

/** Dismissible onboarding callout; remembered per user on the server. */
export function TipCallout({ id, title, children, dismissed }: { id: string; title: string; children: ReactNode; dismissed: boolean }) {
  const [hidden, setHidden] = useState(dismissed);
  if (hidden) return null;
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-subtle px-4 py-3 text-[13.5px]" role="note" data-reveal>
      <div>
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 leading-relaxed text-ink-2">{children}</div>
      </div>
      <button
        type="button"
        className="shrink-0 text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => {
          setHidden(true);
          void api("/api/profile", { method: "PATCH", body: { dismissTip: id } }).catch(() => undefined);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
