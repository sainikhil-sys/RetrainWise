"use client";

import {
  ArrowSquareOut,
  Bell,
  BookOpen,
  CaretUpDown,
  Check,
  Cube,
  Database,
  DotsThree,
  Flask,
  Gear,
  GitBranch,
  House,
  Keyboard,
  List,
  ListChecks,
  MagnifyingGlass,
  Plus,
  Pulse,
  Question,
  Scales,
  SignOut,
  UserCircle,
  X,
  type Icon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { signOutAction } from "@/app/actions";
import { PageTransition } from "@/components/motion";
import { Kbd } from "@/components/rw";
import { api } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { NAV, SHORTCUTS, type NavItem } from "./nav";

const ICONS: Record<string, Icon> = { house: House, database: Database, pulse: Pulse, scales: Scales, git: GitBranch, cube: Cube, flask: Flask, list: ListChecks, gear: Gear };

export type ShellProps = {
  user: { email: string; name: string | null };
  role: Role;
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string; role: Role }[];
  run: { id: string; dataset: string; position: number; rows: number; version: number | null; batchSize: number } | null;
  canOperate: boolean;
  children: ReactNode;
};

function initials(name: string | null, email: string) {
  const src = name?.trim() || email;
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-serif text-[22px] leading-none tracking-[-0.01em] text-foreground", className)}>
      RetrainWise
    </span>
  );
}

function WorkspaceSwitcher({ workspace, workspaces, role }: Pick<ShellProps, "workspace" | "workspaces" | "role">) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-white px-2.5 py-1.5 text-left text-[13px] transition-colors hover:border-foreground/40">
            <span className="min-w-0">
              <span className="block truncate font-medium">{workspace.name}</span>
              <span className="block text-[11px] text-muted-foreground">{ROLE_LABELS[role]}</span>
            </span>
            <CaretUpDown size={14} className="shrink-0 text-ink-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              className="text-[13px]"
              onSelect={async () => {
                if (w.id === workspace.id) return;
                await api("/api/workspaces/switch", { body: { id: w.id } });
                router.push("/overview");
                router.refresh();
              }}
            >
              <span className="flex-1 truncate">{w.name}</span>
              <span className="text-[11px] text-muted-foreground">{ROLE_LABELS[w.role]}</span>
              {w.id === workspace.id && <Check size={13} />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-[13px]" onSelect={() => setCreating(true)}>
            <Plus size={14} /> Create workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-[24px] font-normal">New workspace</DialogTitle>
            <DialogDescription className="text-[13px]">Workspaces keep runs, models and audit history separate. You will be its admin.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (name.trim().length < 2) return;
              setPending(true);
              try {
                await api("/api/workspaces", { body: { name } });
                setCreating(false);
                router.push("/onboarding");
                router.refresh();
              } catch (err) {
                toast.error("Workspace not created", { description: (err as Error).message });
              } finally {
                setPending(false);
              }
            }}
          >
            <input autoFocus className="h-9 w-full rounded-md border border-input px-3 text-[13.5px] outline-none focus:border-foreground" placeholder="e.g. Fraud models" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Workspace name" />
            <div className="flex justify-end">
              <Button type="submit" disabled={pending || name.trim().length < 2}>
                Create workspace
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === item.href || pathname.startsWith(item.href + "/");
  const IconC = ICONS[item.icon];
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13.5px] transition-colors",
        active ? "bg-sidebar-accent font-medium text-foreground" : "text-ink-2 hover:bg-sidebar-accent/60 hover:text-foreground",
      )}
    >
      {active && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-[2px] rounded-full bg-foreground" />}
      <IconC size={16} weight={active ? "fill" : "regular"} className={active ? "text-foreground" : "text-ink-3 group-hover:text-foreground"} />
      {item.label}
    </Link>
  );
}

function EngineStatus() {
  const [s, setS] = useState<{ state: string; active: { label: string } | null; isolated: string[]; lastError: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    let first = true;
    const poll = async () => {
      try {
        const r = await api<typeof s>(`/api/engine${first ? "?start=1" : ""}`);
        first = false;
        if (alive) setS(r);
      } catch {
        /* server restarting or signed out */
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  if (!s) return null;
  const busy = s.active?.label ?? s.isolated[0];
  const tone = s.state === "failed" ? "bg-bad" : busy ? "bg-warn" : s.state === "ready" ? "bg-ok" : "bg-ink-3";
  const text = s.state === "failed" ? "Engine unavailable" : s.state === "starting" ? "Starting engine…" : busy ? busy : s.state === "ready" ? "Engine ready" : "Engine idle";
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground" title={s.lastError ?? text} aria-live="polite">
      <span className={cn("size-1.5 shrink-0 rounded-full", tone, busy && "animate-pulse")} />
      <span className="truncate">{text}</span>
    </div>
  );
}

function Sidebar(props: ShellProps & { onNavigate?: () => void }) {
  const groups = ["Monitor", "Decide", "Analyze", "Workspace"] as const;
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-4 px-4 pt-5">
        <Link href="/overview" onClick={props.onNavigate} className="block px-1">
          <Wordmark />
        </Link>
        <WorkspaceSwitcher workspace={props.workspace} workspaces={props.workspaces} role={props.role} />
      </div>
      <nav aria-label="Main" className="mt-5 flex-1 space-y-5 overflow-y-auto px-4">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 px-2.5 text-[11px] font-medium tracking-wide text-ink-3">{g}</div>
            <div className="space-y-px">
              {NAV.filter((n) => n.group === g).map((item) => (
                <NavLink key={item.href} item={item} onNavigate={props.onNavigate} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-2 border-t border-border px-5 py-4">
        {props.run ? (
          <Link href="/data" onClick={props.onNavigate} className="block text-[12px] leading-snug text-ink-2 hover:text-foreground">
            <span className="font-medium text-foreground">{props.run.dataset}</span> · v{String(props.run.version ?? 0).padStart(3, "0")}
            <span className="mt-1.5 block h-[3px] overflow-hidden rounded-full bg-border">
              <span className="block h-full bg-foreground" style={{ width: `${Math.min(100, (props.run.position / props.run.rows) * 100)}%` }} />
            </span>
            <span className="mt-1 block tabular text-muted-foreground">
              row {props.run.position.toLocaleString()} of {props.run.rows.toLocaleString()}
            </span>
          </Link>
        ) : (
          <Link href="/data" onClick={props.onNavigate} className="block text-[12px] text-muted-foreground hover:text-foreground">
            No active stream. Start one →
          </Link>
        )}
        <EngineStatus />
      </div>
    </div>
  );
}

function Notifications() {
  const router = useRouter();
  const [data, setData] = useState<{ items: { id: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string; kind: string }[]; unread: number } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await api("/api/notifications"));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);
  return (
    <Popover onOpenChange={(o) => o && void load()}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${data?.unread ? ` (${data.unread} unread)` : ""}`} className="relative">
          <Bell size={17} />
          {!!data?.unread && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-bad" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <span className="text-[13px] font-medium">Notifications</span>
          {!!data?.unread && (
            <button
              className="text-[12px] text-muted-foreground hover:text-foreground"
              onClick={async () => {
                await api("/api/notifications", { body: { all: true } });
                void load();
              }}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {!data?.items.length ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">You are all caught up.</p>
          ) : (
            data.items.map((n) => (
              <button
                key={n.id}
                className="block w-full border-b border-border px-4 py-3 text-left last:border-0 hover:bg-subtle"
                onClick={async () => {
                  if (!n.readAt) await api("/api/notifications", { body: { ids: [n.id] } }).catch(() => undefined);
                  if (n.href) router.push(n.href);
                  void load();
                }}
              >
                <div className="flex items-start gap-2">
                  {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground" />}
                  <div className="min-w-0">
                    <div className={cn("text-[13px] leading-snug", n.readAt ? "text-ink-2" : "font-medium")}>{n.title}</div>
                    {n.body && <div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{n.body}</div>}
                    <div className="mt-1 text-[11px] text-ink-3">{new Date(n.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function UserMenu({ user, role }: { user: ShellProps["user"]; role: Role }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Account menu" className="flex size-8 items-center justify-center rounded-full border border-border bg-subtle text-[11px] font-medium transition-colors hover:border-foreground/50">
          {initials(user.name, user.email)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-[13px] font-medium">{user.name || user.email}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {user.email} · {ROLE_LABELS[role]}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-[13px]">
          <Link href="/profile">
            <UserCircle size={15} /> Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-[13px]">
          <Link href="/settings">
            <Gear size={15} /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-[13px]">
          <Link href="/docs">
            <BookOpen size={15} /> Documentation
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-[13px]" onSelect={() => void signOutAction()}>
          <SignOut size={15} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useShortcuts(handlers: Record<string, () => void>, goto: (key: string) => void) {
  const pendingG = useRef<number>(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handlers.palette?.();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (Date.now() - pendingG.current < 1200) {
        pendingG.current = 0;
        goto(e.key.toLowerCase());
        e.preventDefault();
        return;
      }
      if (e.key === "g") {
        pendingG.current = Date.now();
        return;
      }
      const h = handlers[e.key === "?" ? "help" : e.key === "/" ? "palette" : e.key.toLowerCase()];
      if (h) {
        e.preventDefault();
        h();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlers, goto]);
}

export function AppShell(props: ShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const busy = useRef(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  const processBatch = useCallback(async () => {
    if (!props.run) return toast("No active stream", { description: "Start a stream in Data & streams first." });
    if (!props.canOperate) return toast.error("Your role cannot process batches.");
    if (busy.current) return;
    busy.current = true;
    const id = toast.loading("Processing the next batch…");
    try {
      const r = await api<{ noop: boolean; processed: { batch_index: number; status: string }[] }>(`/api/runs/${props.run.id}/batches`, {
        body: { expectedPosition: props.run.position, count: 1 },
      });
      toast.success(r.noop ? "Already processed" : `Batch ${r.processed[0]?.batch_index} processed`, { id, description: r.processed[0]?.status });
      router.refresh();
    } catch (err) {
      toast.error("Batch not processed", { id, description: (err as Error).message });
    } finally {
      busy.current = false;
    }
  }, [props.run, props.canOperate, router]);

  const evaluate = useCallback(async () => {
    if (!props.run) return toast("No active stream");
    if (!props.canOperate) return toast.error("Your role cannot evaluate options.");
    const id = toast.loading("Training candidates and scoring them on withheld data…");
    try {
      const r = await api<{ id: string; recommended: string }>(`/api/runs/${props.run.id}/evaluate`, { body: {} });
      toast.success("Decision ready", { id, description: `Decision ${r.id}` });
      router.push("/decisions");
      router.refresh();
    } catch (err) {
      toast.error("Evaluation failed", { id, description: (err as Error).message });
    }
  }, [props.run, props.canOperate, router]);

  const goto = useCallback(
    (key: string) => {
      const item = NAV.find((n) => n.shortcut === `g ${key}`);
      if (item) router.push(item.href);
    },
    [router],
  );
  const handlers = useMemo(
    () => ({ palette: () => setPaletteOpen(true), help: () => setHelpOpen(true), b: processBatch, e: evaluate, r: () => router.push("/decisions") }),
    [processBatch, evaluate, router],
  );
  useShortcuts(handlers, goto);

  const run = (fn: () => void) => () => {
    setPaletteOpen(false);
    fn();
  };

  return (
    <div className="min-h-screen bg-white">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded focus:bg-foreground focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar lg:block">
        <Sidebar {...props} />
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Sidebar {...props} onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border bg-white/90 px-3 backdrop-blur sm:px-5">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
            <List size={18} />
          </Button>
          <Link href="/overview" className="lg:hidden">
            <Wordmark className="text-[19px]" />
          </Link>
          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-8 w-full max-w-[360px] items-center gap-2 rounded-md border border-border bg-subtle px-2.5 text-[13px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-white max-sm:hidden lg:ml-0"
          >
            <MagnifyingGlass size={14} />
            <span className="flex-1 text-left">Search or run a command…</span>
            <Kbd>⌘K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search" onClick={() => setPaletteOpen(true)}>
              <MagnifyingGlass size={17} />
            </Button>
            <Notifications />
            <Button variant="ghost" size="icon" asChild aria-label="Documentation">
              <Link href="/docs">
                <BookOpen size={17} />
              </Link>
            </Button>
            <Button variant="ghost" size="icon" aria-label="Keyboard shortcuts and help" onClick={() => setHelpOpen(true)}>
              <Question size={17} />
            </Button>
            <div className="ml-1.5">
              <UserMenu user={props.user} role={props.role} />
            </div>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-8 sm:px-8 lg:pb-16 lg:pt-10">
          <PageTransition key={pathname}>{props.children}</PageTransition>
        </main>
      </div>

      <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-white/95 backdrop-blur lg:hidden">
        {NAV.filter((n) => n.mobile).map((n) => {
          const IconC = ICONS[n.icon];
          const active = pathname.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 py-2 text-[10.5px]", active ? "text-foreground" : "text-muted-foreground")}>
              <IconC size={19} weight={active ? "fill" : "regular"} />
              {n.label.split(" ")[0]}
            </Link>
          );
        })}
        <button onClick={() => setMobileOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[10.5px] text-muted-foreground">
          <DotsThree size={19} />
          More
        </button>
      </nav>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen} title="Command palette" description="Search pages and run actions">
        <CommandInput placeholder="Search pages and actions…" />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={run(processBatch)} disabled={!props.run || !props.canOperate}>
              <Pulse /> Process next batch <CommandShortcut>B</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(evaluate)} disabled={!props.run || !props.canOperate}>
              <Scales /> Evaluate update options <CommandShortcut>E</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => router.push("/decisions"))}>
              <ListChecks /> View recommendation <CommandShortcut>R</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => router.push("/models?train=1"))} disabled={!props.canOperate}>
              <Cube /> Train a model
            </CommandItem>
            <CommandItem onSelect={run(() => router.push("/data#start"))} disabled={!props.canOperate}>
              <Database /> Start a stream
            </CommandItem>
            <CommandItem onSelect={run(() => router.push("/experiments#new"))} disabled={!props.canOperate}>
              <Flask /> Run a benchmark
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {NAV.map((n) => {
              const IconC = ICONS[n.icon];
              return (
                <CommandItem key={n.href} onSelect={run(() => router.push(n.href))}>
                  <IconC /> {n.label}
                  {n.shortcut && <CommandShortcut>{n.shortcut.toUpperCase()}</CommandShortcut>}
                </CommandItem>
              );
            })}
            <CommandItem onSelect={run(() => router.push("/profile"))}>
              <UserCircle /> Profile
            </CommandItem>
            <CommandItem onSelect={run(() => router.push("/docs"))}>
              <ArrowSquareOut /> Documentation
            </CommandItem>
          </CommandGroup>
          {props.workspaces.length > 1 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Switch workspace">
                {props.workspaces
                  .filter((w) => w.id !== props.workspace.id)
                  .map((w) => (
                    <CommandItem
                      key={w.id}
                      onSelect={run(async () => {
                        await api("/api/workspaces/switch", { body: { id: w.id } });
                        router.push("/overview");
                        router.refresh();
                      })}
                    >
                      <CaretUpDown /> {w.name}
                    </CommandItem>
                  ))}
              </CommandGroup>
            </>
          )}
          <CommandSeparator />
          <CommandGroup heading="Account">
            <CommandItem onSelect={run(() => setHelpOpen(true))}>
              <Keyboard /> Keyboard shortcuts <CommandShortcut>?</CommandShortcut>
            </CommandItem>
            <CommandItem onSelect={run(() => void signOutAction())}>
              <SignOut /> Sign out
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-[26px] font-normal">Keyboard shortcuts</DialogTitle>
            <DialogDescription className="text-[13px]">Shortcuts work anywhere outside text fields.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border text-[13px]">
            {SHORTCUTS.map((s) => (
              <li key={s.label} className="flex items-center justify-between gap-4 py-2">
                <span className="text-ink-2">{s.label}</span>
                <span className="flex gap-1">
                  {s.keys.split(" ").map((k, i) =>
                    ["then", "/"].includes(k) ? (
                      <span key={i} className="px-0.5 text-[11px] text-muted-foreground">
                        {k}
                      </span>
                    ) : (
                      <Kbd key={i}>{k}</Kbd>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => setHelpOpen(false)}>
              <X size={13} /> Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
