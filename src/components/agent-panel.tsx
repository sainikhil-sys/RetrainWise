"use client";

import { Bot, Cpu, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, Field, api, inputClass, useAction } from "./client";
import { Alert, Badge } from "./ui";

type OllamaStatus = { available: boolean; models: string[]; error?: string };

export function AgentPanel({ decisionId, decisionStatus, defaultMode, defaultModel }: { decisionId: string | null; decisionStatus: string | null; defaultMode: "deterministic" | "ollama"; defaultModel: string }) {
  const [mode, setMode] = useState(defaultMode);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [model, setModel] = useState(defaultModel);
  const { run, pending } = useAction();

  useEffect(() => {
    api<OllamaStatus>("/api/agent/ollama")
      .then((s) => {
        setStatus(s);
        if (s.models.length) setModel(s.models.find((m) => m === defaultModel || m.startsWith(`${defaultModel}:`)) ?? s.models[0]);
      })
      .catch(() => setStatus({ available: false, models: [], error: "status check failed" }));
  }, [defaultModel]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Explanation mode" htmlFor="agent-mode" help={mode === "deterministic" ? "Template report from tool evidence. No language model." : "A local model calls read-only tools, then writes a report. Advisory only."}>
          <select id="agent-mode" className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="deterministic">Deterministic (default, no LLM)</option>
            <option value="ollama">Local Ollama (optional)</option>
          </select>
        </Field>
        <Field label="Ollama model" htmlFor="agent-model" help={status?.available ? `${status.models.length} local model(s) found` : "Install Ollama and pull a tool-calling model, e.g. llama3.1"}>
          {status?.models.length ? (
            <select id="agent-model" className={inputClass} value={model} disabled={mode !== "ollama"} onChange={(e) => setModel(e.target.value)}>
              {status.models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          ) : (
            <input id="agent-model" className={inputClass} value={model} disabled={mode !== "ollama"} onChange={(e) => setModel(e.target.value)} />
          )}
        </Field>
        <div className="flex flex-col justify-end gap-2">
          <div className="text-sm">
            {status == null ? (
              <Badge tone="neutral">checking Ollama…</Badge>
            ) : status.available ? (
              <Badge tone="good" dot>
                Ollama reachable on 127.0.0.1:11434
              </Badge>
            ) : (
              <Badge tone="warn" dot>
                Ollama not reachable — deterministic fallback
              </Badge>
            )}
          </div>
        </div>
      </div>

      {mode === "ollama" && !status?.available && status && (
        <Alert tone="warn">If you generate an Ollama report now, the attempt and its failure are recorded and the deterministic explanation is used instead (clearly labelled).</Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon={mode === "ollama" ? Sparkles : Bot}
          loading={pending}
          disabled={!decisionId}
          onClick={() =>
            decisionId &&
            run<{ report_id: number; status: string; duration_seconds: number; requests_prepared: number[] }>(
              "/api/agent/explain",
              { decisionId, mode, model: mode === "ollama" ? model : undefined },
              {
                success: (r) => `Report #${r.report_id}: ${r.status}`,
                successBody: (r) => `${r.duration_seconds.toFixed(1)} s${r.requests_prepared.length ? ` · prepared request #${r.requests_prepared.join(", #")} (awaiting approval)` : ""}`,
                failure: "Explanation failed",
              },
            )
          }
        >
          {pending ? (mode === "ollama" ? "Local model is gathering evidence…" : "Gathering tool evidence…") : "Explain the latest decision"}
        </Button>
        {decisionId ? (
          <span className="text-xs text-slate-500">
            Decision <span className="font-mono">{decisionId}</span> ({decisionStatus})
          </span>
        ) : (
          <span className="text-xs text-slate-500">Create a decision in Decision analysis first.</span>
        )}
      </div>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
        <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Tools available to the agent: telemetry, registry history, probe results (difference-in-differences staleness), pricing assumptions, action evaluations (all read-only), and prepare_execution_request, which only records a request for a human. The agent cannot execute anything; every tool call is stored in SQLite.
      </p>
    </div>
  );
}
