"use client";

import { ArrowSquareOut, CheckCircle, CircleNotch, CloudArrowDown, Cpu, Globe, Robot, Sparkle } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Callout, Status } from "@/components/rw";
import { Spinner, api, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

type Mode = "deterministic" | "ollama" | "openai";
type CatalogItem = { id: string; name: string; vendor: string; size: string; note: string };
type Preset = { id: string; name: string; base_url: string; key_url: string | null; models: string[] };
type LlmStatus = {
  ollama: { available: boolean; models: string[]; error?: string };
  openai: { base_url: string; model: string; available: boolean; key_configured: boolean; models: string[]; error?: string };
  catalog: CatalogItem[];
  presets: Preset[];
};

const MODES: { id: Mode; title: string; text: string; icon: typeof Robot }[] = [
  { id: "deterministic", title: "Deterministic", text: "Template report from verified figures. No language model.", icon: Robot },
  { id: "ollama", title: "On this computer", text: "Open-source model through Ollama. Data stays local.", icon: Cpu },
  { id: "openai", title: "Hosted open-source", text: "Llama, Qwen, Mistral via Groq, OpenRouter, Together or Hugging Face.", icon: Globe },
];

const installed = (have: string[], id: string) => have.some((m) => m === id || m === `${id}:latest` || (id.includes(":") ? false : m.startsWith(`${id}:`)));

/**
 * Advisory explanation of the latest decision with a choice of open-source
 * models. The agent reads evidence and may prepare a request; it never executes.
 */
export function AgentPanel({
  decisionId,
  decisionStatus,
  settings,
  canRun,
  canConfigure,
}: {
  decisionId: string | null;
  decisionStatus: string | null;
  settings: Settings;
  canRun: boolean;
  canConfigure: boolean;
}) {
  const [mode, setMode] = useState<Mode>(settings.agent_mode);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [ollamaModel, setOllamaModel] = useState(settings.ollama_model);
  const [baseUrl, setBaseUrl] = useState(settings.llm_base_url);
  const [hostedModel, setHostedModel] = useState(settings.llm_model);
  const [pulling, setPulling] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { run, pending } = useAction();

  const refresh = useCallback(() => {
    api<LlmStatus>("/api/agent/llm")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);

  const ollamaHave = status?.ollama.models ?? [];
  const preset = status?.presets.find((p) => p.base_url === baseUrl.replace(/\/$/, ""));
  const model = mode === "ollama" ? ollamaModel : mode === "openai" ? hostedModel : undefined;
  // The engine uses the saved endpoint URL, so a hosted explanation needs the typed URL to be saved and reachable.
  const ready =
    mode === "deterministic" ||
    (mode === "ollama" ? !!status?.ollama.available && installed(ollamaHave, ollamaModel) : !!status?.openai.available && baseUrl.replace(/\/$/, "") === status.openai.base_url);

  async function pull(id: string) {
    setPulling(id);
    try {
      await api("/api/agent/ollama/pull", { body: { model: id } });
      toast.success(`${id} downloaded`, { description: "It is ready to explain decisions on this computer." });
      setOllamaModel(id);
      refresh();
    } catch (e) {
      toast.error("Download failed", { description: (e as Error).message });
    } finally {
      setPulling(null);
    }
  }

  async function saveDefault() {
    setSaving(true);
    try {
      const next = { ...settings, agent_mode: mode, ollama_model: ollamaModel, llm_base_url: baseUrl.replace(/\/$/, ""), llm_model: hostedModel };
      await api("/api/settings", { method: "PUT", body: { settings: next } });
      toast.success("Default explanation model saved");
      refresh();
    } catch (e) {
      toast.error("Not saved", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="Explanation model" className="grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            onClick={() => setMode(m.id)}
            className={cn("rounded-lg border p-3.5 text-left transition-colors", mode === m.id ? "border-foreground bg-subtle" : "border-border hover:border-foreground/40")}
          >
            <m.icon size={18} weight={mode === m.id ? "fill" : "regular"} />
            <div className="mt-2 text-[13.5px] font-medium">{m.title}</div>
            <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{m.text}</div>
          </button>
        ))}
      </div>

      {mode === "ollama" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            {status == null ? (
              <span className="text-muted-foreground">Checking for Ollama…</span>
            ) : status.ollama.available ? (
              <Status tone="ok">Ollama running · {ollamaHave.length} model{ollamaHave.length === 1 ? "" : "s"} installed</Status>
            ) : (
              <Status tone="warn">Ollama is not installed or not running</Status>
            )}
            <button type="button" onClick={refresh} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Check again
            </button>
          </div>
          {status && !status.ollama.available && (
            <Callout title="Install Ollama to run open-source models locally">
              Download it from{" "}
              <a href="https://ollama.com/download" target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                ollama.com/download
              </a>{" "}
              (or run <code className="font-mono text-[12px]">winget install Ollama.Ollama</code>), start it, then press Check again and download a model below.
            </Callout>
          )}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(status?.catalog ?? []).map((m) => {
              const have = installed(ollamaHave, m.id);
              const selected = ollamaModel === m.id;
              return (
                <li key={m.id} className={cn("flex flex-wrap items-center gap-3 px-3.5 py-3", selected && "bg-subtle")}>
                  <button type="button" onClick={() => setOllamaModel(m.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-pressed={selected}>
                    <span className={cn("mt-1 size-3.5 shrink-0 rounded-full border", selected ? "border-[4px] border-foreground" : "border-border")} />
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium">
                        {m.name} <span className="font-normal text-muted-foreground">· {m.vendor}</span>
                      </span>
                      <span className="block text-[12px] text-muted-foreground">
                        <code className="font-mono">{m.id}</code> · {m.size} · {m.note}
                      </span>
                    </span>
                  </button>
                  {have ? (
                    <span className="flex items-center gap-1 text-[12px] text-ok">
                      <CheckCircle size={14} weight="fill" /> Installed
                    </span>
                  ) : canConfigure ? (
                    <Button size="sm" variant="secondary" disabled={!status?.ollama.available || !!pulling} onClick={() => void pull(m.id)}>
                      {pulling === m.id ? <CircleNotch className="animate-spin" /> : <CloudArrowDown />}
                      {pulling === m.id ? "Downloading…" : "Download"}
                    </Button>
                  ) : (
                    <span className="text-[12px] text-muted-foreground">Not installed</span>
                  )}
                </li>
              );
            })}
          </ul>
          {pulling && <p className="text-[12px] text-muted-foreground">Downloading {pulling}. Several gigabytes; this can take a while. You can keep using the app.</p>}
        </div>
      )}

      {mode === "openai" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {(status?.presets ?? []).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setBaseUrl(p.base_url);
                  if (p.models[0]) setHostedModel(p.models[0]);
                }}
                className={cn("h-7 rounded-md border px-2.5 text-[12.5px]", preset?.id === p.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-subtle")}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="llm-url" className="text-[13px]">
                Endpoint URL
              </Label>
              <Input id="llm-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="font-mono text-[12.5px]" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-model" className="text-[13px]">
                Model
              </Label>
              <Input id="llm-model" list="llm-models" value={hostedModel} onChange={(e) => setHostedModel(e.target.value)} className="font-mono text-[12.5px]" />
              <datalist id="llm-models">
                {[...(preset?.models ?? []), ...(baseUrl.replace(/\/$/, "") === status?.openai.base_url ? status.openai.models : [])].map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          </div>
          <p className="text-[12.5px]">
            {status == null ? (
              <span className="text-muted-foreground">Checking the endpoint…</span>
            ) : baseUrl.replace(/\/$/, "") !== status.openai.base_url ? (
              <span className="text-muted-foreground">Save as default to test this endpoint.</span>
            ) : status.openai.available ? (
              <Status tone="ok">
                Endpoint reachable · {status.openai.models.length} models · API key {status.openai.key_configured ? "configured" : "not needed or not set"}
              </Status>
            ) : (
              <Status tone="warn">
                {status.openai.error ?? "Endpoint not reachable"}
                {!status.openai.key_configured && " · set LLM_API_KEY in .env and restart"}
              </Status>
            )}
          </p>
          <Callout title="API key">
            Hosted providers need a key. Put it in <code className="font-mono text-[12px]">.env</code> as <code className="font-mono text-[12px]">LLM_API_KEY=&quot;…&quot;</code> and restart the app. It is never stored in the database or shown in the app.
            {preset?.key_url && (
              <>
                {" "}
                Get a key from{" "}
                <a href={preset.key_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 underline underline-offset-4">
                  {preset.name} <ArrowSquareOut size={12} />
                </a>
                .
              </>
            )}{" "}
            The decision evidence is sent to the endpoint when you ask for an explanation.
          </Callout>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
        <Button
          disabled={!decisionId || pending || !canRun || !ready}
          onClick={() =>
            decisionId &&
            run<{ report_id: number; status: string; duration_seconds: number; requests_prepared: number[] }>(
              "/api/agent/explain",
              { decisionId, mode, model },
              {
                success: (r) => `Report #${r.report_id}: ${r.status}`,
                description: (r) => `${r.duration_seconds.toFixed(1)} s${r.requests_prepared.length ? ` · prepared request #${r.requests_prepared.join(", #")} for approval` : ""}`,
                failure: "Explanation failed",
              },
            )
          }
        >
          {pending ? <Spinner /> : mode === "deterministic" ? <Robot /> : <Sparkle />}
          {pending ? "Gathering evidence…" : "Explain the latest decision"}
        </Button>
        {canConfigure && (mode !== settings.agent_mode || ollamaModel !== settings.ollama_model || baseUrl !== settings.llm_base_url || hostedModel !== settings.llm_model) && (
          <Button variant="ghost" disabled={saving} onClick={() => void saveDefault()}>
            {saving && <Spinner />} Save as default
          </Button>
        )}
        <span className="text-[12px] text-muted-foreground">
          {!canRun
            ? "Requires the Operator role."
            : !decisionId
              ? "Evaluate update options first."
              : !ready
                ? mode === "ollama"
                  ? "Install Ollama and download the selected model first."
                  : baseUrl.replace(/\/$/, "") !== status?.openai.base_url
                    ? "Save this endpoint as the default first."
                    : "The endpoint is not reachable yet."
                : `Decision ${decisionId} (${decisionStatus})`}
        </span>
      </div>
    </div>
  );
}
