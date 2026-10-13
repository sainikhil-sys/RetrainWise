"use client";

import { Download, RotateCcw, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { SETTINGS_GROUPS, type FieldMeta } from "@/lib/settings-meta";
import type { Settings } from "@/lib/types";
import { Button, Field, Toggle, useAction } from "./client";
import { Alert, Card, CardBody, CardHeader, InfoTip, SimLabel, cn, inputClass } from "./ui";

type Draft = Record<string, string | boolean>;

function toDraft(s: Settings): Draft {
  const d: Draft = {};
  for (const [k, v] of Object.entries(s)) d[k] = typeof v === "boolean" ? v : Array.isArray(v) ? v.join(", ") : String(v);
  return d;
}

function validate(f: FieldMeta, raw: string | boolean): { value?: unknown; error?: string } {
  if (f.kind === "toggle") return { value: raw === true };
  const text = String(raw).trim();
  if (f.kind === "select") return f.options?.some((o) => o.value === text) ? { value: text } : { error: "Choose an option." };
  if (f.kind === "text") return /^[A-Za-z0-9._:/-]{1,80}$/.test(text) ? { value: text } : { error: "Use a short tag such as llama3.1." };
  if (f.kind === "list") {
    const parts = text.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!parts.length || parts.length > 1000 || parts.some((n) => !Number.isFinite(n) || n <= 0)) return { error: "Enter 1–1000 positive numbers separated by commas." };
    return { value: parts };
  }
  if (text === "") return { error: "Required." };
  const n = Number(text);
  if (!Number.isFinite(n)) return { error: "Enter a number." };
  if (f.kind === "int" && !Number.isInteger(n)) return { error: "Enter a whole number." };
  if (f.min != null && n < f.min) return { error: `Minimum ${f.min}.` };
  if (f.max != null && n > f.max) return { error: `Maximum ${f.max.toLocaleString()}.` };
  if (f.key === "label_fraction" && n <= 0) return { error: "Must be above 0." };
  if (f.key === "min_confidence" && n >= 1) return { error: "Must be below 1." };
  return { value: n };
}

export function SettingsForm({ settings, defaults }: { settings: Settings; defaults: Settings }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [showErrors, setShowErrors] = useState(false);
  const save = useAction();
  const reset = useAction();

  useEffect(() => setDraft(toDraft(settings)), [settings]);

  const fields = SETTINGS_GROUPS.flatMap((g) => g.fields);
  const checked = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, validate(f, draft[f.key])])), [draft, fields]);
  const errors = Object.entries(checked).filter(([, r]) => r.error);
  const initial = toDraft(settings);
  const changed = fields.filter((f) => String(draft[f.key]) !== String(initial[f.key]));

  const submit = async () => {
    setShowErrors(true);
    if (errors.length) return;
    const next: Record<string, unknown> = { ...settings };
    for (const f of fields) next[f.key] = checked[f.key].value;
    await save.run("/api/settings", { settings: next }, { method: "PUT", success: () => "Settings saved", successBody: () => "Validated by the engine. Pending decisions were marked stale because their assumptions changed.", failure: "Settings not saved" });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "retrainwise_settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-6"
    >
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-navy-900/95 px-4 py-3 backdrop-blur lg:top-2">
        <Button type="submit" variant="primary" icon={Save} loading={save.pending} disabled={!changed.length}>
          Save {changed.length ? `${changed.length} change${changed.length === 1 ? "" : "s"}` : "settings"}
        </Button>
        <Button variant="ghost" disabled={!changed.length || save.pending} onClick={() => setDraft(toDraft(settings))}>
          Discard
        </Button>
        <Button
          variant="ghost"
          icon={RotateCcw}
          loading={reset.pending}
          onClick={() => {
            if (window.confirm("Restore all default settings (the seed is kept)? Pending decisions will become stale.")) void reset.run("/api/settings/reset", {}, { success: () => "Defaults restored" });
          }}
        >
          Reset to defaults
        </Button>
        <Button variant="ghost" icon={Download} onClick={exportJson}>
          Export JSON
        </Button>
        {showErrors && errors.length > 0 && <span className="text-sm text-rose-300">{errors.length} field(s) need attention.</span>}
      </div>

      {save.error && <Alert tone="bad" title="The engine rejected these settings">{save.error}</Alert>}

      {SETTINGS_GROUPS.map((g) => (
        <Card key={g.id} id={g.id}>
          <CardHeader title={g.title} description={g.description} action={g.simulated ? <SimLabel kind="assumed" /> : undefined} />
          <CardBody className="grid gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
            {g.fields.map((f) => {
              const id = `s-${f.key}`;
              const err = showErrors ? checked[f.key]?.error : undefined;
              const isChanged = String(draft[f.key]) !== String(initial[f.key]);
              const def = (defaults as Record<string, unknown>)[f.key];
              const label = (
                <>
                  {f.label}
                  {f.unit && <span className="font-normal text-slate-500">({f.unit})</span>}
                  <InfoTip text={`${f.help} Default: ${Array.isArray(def) ? def.join(", ") : String(def)}.`} label={f.label} />
                  {isChanged && <span className="ml-auto rounded bg-teal-400/15 px-1.5 text-[10px] font-semibold uppercase text-teal-200">changed</span>}
                </>
              );
              if (f.kind === "toggle") {
                return (
                  <div key={f.key} className={cn("flex items-start justify-between gap-4 rounded-xl border p-3", draft[f.key] ? "border-amber-400/40 bg-amber-400/[0.05]" : "border-slate-800")}>
                    <div>
                      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
                        {label}
                      </label>
                      <p className="mt-1 text-xs text-slate-500">{f.help}</p>
                    </div>
                    <Toggle id={id} label={f.label} checked={draft[f.key] === true} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />
                  </div>
                );
              }
              return (
                <Field key={f.key} label={label} htmlFor={id} error={err} help={f.help}>
                  {f.kind === "select" ? (
                    <select id={id} className={inputClass} value={String(draft[f.key])} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>
                      {f.options!.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="relative">
                      {f.kind === "money" && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>}
                      <input
                        id={id}
                        className={cn(inputClass, f.kind === "money" && "pl-7")}
                        inputMode={f.kind === "text" || f.kind === "list" ? "text" : "decimal"}
                        value={String(draft[f.key])}
                        aria-invalid={!!err}
                        disabled={f.key === "cost_trace_custom" && draft.cost_trace_kind !== "custom"}
                        onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      />
                    </div>
                  )}
                </Field>
              );
            })}
          </CardBody>
        </Card>
      ))}
    </form>
  );
}
