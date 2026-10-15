"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { InfoTip, SimLabel } from "@/components/rw";
import { ConfirmDialog, Spinner, api } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SETTINGS_GROUPS, type FieldMeta } from "@/lib/settings-meta";
import type { Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

type Draft = Record<string, string | boolean>;

function toDraft(s: Settings): Draft {
  const d: Draft = {};
  for (const g of SETTINGS_GROUPS)
    for (const f of g.fields) {
      const v = s[f.key] as unknown;
      d[f.key] = f.kind === "toggle" ? Boolean(v) : f.kind === "list" ? (v as number[]).join(", ") : String(v);
    }
  return d;
}

function parse(f: FieldMeta, raw: string | boolean): { value?: unknown; error?: string } {
  if (f.kind === "toggle") return { value: raw === true };
  const s = String(raw).trim();
  if (f.kind === "select" || f.kind === "text") {
    if (!s) return { error: "Required" };
    if (f.options && !f.options.some((o) => o.value === s)) return { error: "Choose an option" };
    return { value: s };
  }
  if (f.kind === "list") {
    const xs = s.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!xs.length || xs.length > 1000 || xs.some((x) => !Number.isFinite(x) || x <= 0)) return { error: "1–1000 positive numbers, comma-separated" };
    return { value: xs };
  }
  if (s === "") return { error: "Required" };
  const n = Number(s);
  if (!Number.isFinite(n)) return { error: "Enter a number" };
  if (f.kind === "int" && !Number.isInteger(n)) return { error: "Whole number" };
  if (f.min != null && n < f.min) return { error: `At least ${f.min.toLocaleString()}` };
  if (f.max != null && n > f.max) return { error: `At most ${f.max.toLocaleString()}` };
  return { value: n };
}

export function EngineSettingsForm({ settings, editable, canReset }: { settings: Settings; editable: string[]; canReset: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const base = useMemo(() => toDraft(settings), [settings]);
  const allowed = new Set(editable);

  const parsed = useMemo(() => {
    const out: Record<string, { value?: unknown; error?: string }> = {};
    for (const g of SETTINGS_GROUPS) for (const f of g.fields) out[f.key] = parse(f, draft[f.key]);
    return out;
  }, [draft]);
  const dirty = Object.keys(draft).filter((k) => draft[k] !== base[k]);
  const invalid = Object.entries(parsed).some(([, p]) => p.error);

  async function put(next: Settings) {
    return api("/api/settings", { method: "PUT", body: { settings: next } });
  }

  async function save() {
    if (invalid || !dirty.length) return;
    const next = { ...settings } as Record<string, unknown>;
    for (const k of Object.keys(parsed)) next[k] = parsed[k].value;
    setSaving(true);
    try {
      await put(next as Settings);
      const previous = settings;
      toast.success(`Saved ${dirty.length} setting${dirty.length === 1 ? "" : "s"}`, {
        description: "Pending decisions computed under the old assumptions are now stale.",
        action: {
          label: "Undo",
          onClick: () => {
            put(previous)
              .then(() => {
                toast.success("Previous settings restored");
                setDraft(toDraft(previous));
                router.refresh();
              })
              .catch((e: Error) => toast.error("Could not undo", { description: e.message }));
          },
        },
      });
      router.refresh();
    } catch (e) {
      toast.error("Settings not saved", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pb-20">
      {SETTINGS_GROUPS.map((g) => {
        const groupEditable = g.fields.some((f) => allowed.has(f.key));
        return (
          <section key={g.id} id={g.id} className="grid gap-x-12 gap-y-4 border-t border-border py-8 first:border-t-0 first:pt-0 lg:grid-cols-[280px_1fr]">
            <div>
              <h2 className="font-serif text-[24px] leading-tight">{g.title}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{g.description}</p>
              {g.simulated && (
                <div className="mt-2">
                  <SimLabel>Assumed values</SimLabel>
                </div>
              )}
              {!groupEditable && <p className="mt-2 text-[12px] text-muted-foreground">Read-only for your role.</p>}
            </div>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {g.fields.map((f) => {
                const id = `s-${f.key}`;
                const can = allowed.has(f.key);
                const err = parsed[f.key].error;
                const changed = draft[f.key] !== base[f.key];
                const set = (v: string | boolean) => setDraft((d) => ({ ...d, [f.key]: v }));
                return (
                  <div key={f.key} className={cn("space-y-1.5", f.kind === "list" && "sm:col-span-2")}>
                    <div className="flex items-center gap-1.5">
                      <Label htmlFor={id} className="text-[13px]">
                        {f.label}
                        {f.unit && <span className="ml-1 font-normal text-muted-foreground">({f.unit})</span>}
                      </Label>
                      <InfoTip>{f.help}</InfoTip>
                      {changed && <span className="size-1.5 rounded-full bg-foreground" aria-label="changed" />}
                    </div>
                    {f.kind === "toggle" ? (
                      <Switch id={id} checked={draft[f.key] === true} onCheckedChange={(c) => set(c)} disabled={!can} />
                    ) : f.kind === "select" ? (
                      <Select value={String(draft[f.key])} onValueChange={set} disabled={!can}>
                        <SelectTrigger id={id} className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {f.options!.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        value={String(draft[f.key])}
                        onChange={(e) => set(e.target.value)}
                        disabled={!can}
                        inputMode={f.kind === "text" || f.kind === "list" ? undefined : "decimal"}
                        aria-invalid={!!err}
                        className={cn(f.kind === "text" && "font-mono text-[12.5px]")}
                      />
                    )}
                    {err && <p className="text-[12px] text-bad">{err}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {(dirty.length > 0 || canReset) && (
        <div className="sticky bottom-16 z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/95 px-4 py-3 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] backdrop-blur md:bottom-4">
          <span className="text-[13px] text-muted-foreground">{dirty.length ? `${dirty.length} unsaved change${dirty.length === 1 ? "" : "s"}${invalid ? " · fix the highlighted fields" : ""}` : "All changes saved."}</span>
          <div className="flex gap-2">
            {canReset && (
              <Button variant="ghost" onClick={() => setResetOpen(true)} disabled={saving}>
                Reset to defaults
              </Button>
            )}
            {dirty.length > 0 && (
              <>
                <Button variant="secondary" onClick={() => setDraft(base)} disabled={saving}>
                  Discard
                </Button>
                <Button onClick={save} disabled={invalid || saving}>
                  {saving && <Spinner />}
                  Save changes
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="Reset every engine setting?"
        description="All values return to the documented defaults. Pending decisions become stale. The change is recorded in the audit trail."
        confirmLabel="Reset to defaults"
        destructive
        pending={saving}
        onConfirm={async () => {
          setSaving(true);
          try {
            await api("/api/settings/reset", { method: "POST", body: {} });
            toast.success("Settings reset to defaults");
            setResetOpen(false);
            router.refresh();
          } catch (e) {
            toast.error("Could not reset", { description: (e as Error).message });
          } finally {
            setSaving(false);
          }
        }}
      />
    </div>
  );
}
