"use client";

import { Bot, CheckCircle2, History, ShieldCheck, Undo2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { ACTION_LABELS } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { Action, ExecutionRequest, Guardrail } from "@/lib/types";
import { Button, Field, inputClass, useAction } from "./client";
import { Alert, Badge, cn } from "./ui";

const APPROVER_KEY = "retrainwise.approver";

function useApprover(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      setName(localStorage.getItem(APPROVER_KEY) ?? "");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const set = (v: string) => {
    setName(v);
    try {
      localStorage.setItem(APPROVER_KEY, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [name, set];
}

type Option = { action: Action; net: number; cost: number; feasible: boolean; failed: Guardrail[] };
type ExecResult = { status: string; outcome: string; version?: number; validation?: { passed: boolean; checks: { check: string; passed: boolean; detail: string }[] } };

export function ApproveForm({ decisionId, recommended, options }: { decisionId: string; recommended: Action; options: Option[] }) {
  const [action, setAction] = useState<Action>(recommended);
  const [approver, setApprover] = useApprover();
  const [approved, setApproved] = useState(false);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const { run, pending, error } = useAction();
  const chosen = options.find((o) => o.action === action)!;
  const nameError = touched && !approver.trim() ? "Enter your name for the audit log." : null;
  const boxError = touched && !approved ? "Tick the box to confirm your approval." : null;

  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (!approver.trim() || !approved) return;
        const r = await run<ExecResult>(`/api/decisions/${decisionId}/execute`, { action, approver: approver.trim(), approved: true }, {
          success: (r) => (r.status === "promoted" ? `Promoted ${r.outcome.replace("promoted as ", "")}` : r.status === "deferred" ? "Current model kept" : `Outcome: ${r.status}`),
          successBody: (r) => r.outcome,
          failure: "Not executed",
        });
        if (r) setResult(r);
      }}
    >
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-200">Action</legend>
        <div className="grid gap-3 md:grid-cols-3">
          {options.map((o) => (
            <label
              key={o.action}
              className={cn(
                "cursor-pointer rounded-xl border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-400",
                action === o.action ? "border-teal-400/60 bg-teal-400/[0.07]" : "border-slate-800 hover:border-slate-600",
              )}
            >
              <input type="radio" name="action" value={o.action} checked={action === o.action} onChange={() => setAction(o.action)} className="sr-only" />
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-100">{ACTION_LABELS[o.action]}</span>
                {o.action === recommended && <Badge tone="accent">recommended</Badge>}
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Net {money(o.net)} · cost {money(o.cost)} <span className="text-amber-300/80">(simulated)</span>
              </div>
              <div className={cn("mt-1 text-xs", o.feasible ? "text-emerald-300" : "text-rose-300")}>{o.feasible ? "All guardrails pass" : `Blocked: ${o.failed.map((g) => g.name).join(", ")}`}</div>
            </label>
          ))}
        </div>
      </fieldset>

      {!chosen.feasible && chosen.action !== "defer" && (
        <Alert tone="warn" title="This action is currently blocked by guardrails">
          You may still approve it, but the engine re-checks guardrails before acting and will record it as rejected without changing the model.
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Approver name" htmlFor="approver" error={nameError} help="Recorded with the approval in SQLite. Remembered in this browser.">
          <input id="approver" className={inputClass} value={approver} maxLength={80} aria-invalid={!!nameError} onChange={(e) => setApprover(e.target.value)} placeholder="e.g. Alex (ML engineer)" />
        </Field>
        <div className="flex flex-col justify-end">
          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-400" checked={approved} onChange={(e) => setApproved(e.target.checked)} aria-invalid={!!boxError} />
            <span>I approve this action. I understand guardrails and the chronological validation gate are still enforced before promotion.</span>
          </label>
          {boxError && <p className="mt-1 text-xs text-rose-300">{boxError}</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" icon={ShieldCheck} loading={pending}>
          {pending ? "Re-checking guardrails and validating…" : `Approve and execute: ${ACTION_LABELS[action]}`}
        </Button>
        <span className="text-xs text-slate-500">Each decision can be approved exactly once. Duplicate submissions are rejected by the database.</span>
      </div>

      {error && <Alert tone="bad" title="Not executed">{error}</Alert>}
      {result && (
        <Alert tone={result.status === "promoted" || result.status === "deferred" ? "good" : "bad"} title={`Outcome: ${result.status}`}>
          <p>{result.outcome}</p>
          {result.validation && (
            <ul className="mt-2 space-y-1">
              {result.validation.checks.map((c) => (
                <li key={c.check} className="flex items-center gap-2">
                  {c.passed ? <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-label="passed" /> : <XCircle className="h-4 w-4 text-rose-300" aria-label="failed" />}
                  {c.check} — {c.detail}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </form>
  );
}

export function RequestRow({ req, pendingDecisionId }: { req: ExecutionRequest; pendingDecisionId: string | null }) {
  const [approver] = useApprover();
  const approve = useAction();
  const dismiss = useAction();
  const stale = req.decision_id !== pendingDecisionId;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Bot className="h-4 w-4 text-violet-300" aria-hidden />
          <span className="font-medium text-slate-100">Request #{req.id}: {ACTION_LABELS[req.action]}</span>
          <span className="font-mono text-xs text-slate-500">decision {req.decision_id}</span>
          <Badge tone="info">awaiting approval</Badge>
          {stale && <Badge tone="warn">decision no longer pending</Badge>}
        </div>
        <p className="mt-1.5 text-sm text-slate-400">
          <span className="text-slate-500">Agent rationale:</span> {req.rationale}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          loading={approve.pending}
          disabled={!approver.trim() || stale}
          title={!approver.trim() ? "Enter an approver name in the approval form first" : undefined}
          onClick={() =>
            approve.run<ExecResult>(`/api/decisions/${req.decision_id}/execute`, { action: req.action, approver: approver.trim(), approved: true, requestId: req.id }, { success: (r) => `Request #${req.id}: ${r.status}`, successBody: (r) => r.outcome, failure: `Request #${req.id} not executed` })
          }
        >
          Approve
        </Button>
        <Button size="sm" variant="ghost" loading={dismiss.pending} onClick={() => dismiss.run(`/api/requests/${req.id}/dismiss`, { actor: approver.trim() || undefined }, { success: () => `Request #${req.id} dismissed` })}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function RollbackForm({ versions }: { versions: { version: number; label: string }[] }) {
  const [version, setVersion] = useState<number>(versions[0]?.version ?? 0);
  const [approver, setApprover] = useApprover();
  const [reason, setReason] = useState("");
  const [approved, setApproved] = useState(false);
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  if (!versions.length) return <p className="text-sm text-slate-400">No archived versions in this run yet. After the first promotion, the previous model can be restored here.</p>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setTouched(true);
        if (!approver.trim() || !approved) return;
        const r = await run(`/api/models/${version}/rollback`, { approver: approver.trim(), approved: true, reason }, { success: () => `Rolled back to v${String(version).padStart(3, "0")}`, successBody: () => "Monitors were reset against the restored model; pending decisions became stale.", failure: "Rollback failed" });
        if (r) {
          setApproved(false);
          setReason("");
          setTouched(false);
        }
      }}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Restore version" htmlFor="rb-version">
          <select id="rb-version" className={inputClass} value={version} onChange={(e) => setVersion(Number(e.target.value))}>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Approver name" htmlFor="rb-approver" error={touched && !approver.trim() ? "Required." : null}>
          <input id="rb-approver" className={inputClass} value={approver} maxLength={80} onChange={(e) => setApprover(e.target.value)} />
        </Field>
        <Field label="Reason" htmlFor="rb-reason" help="Optional; stored in the audit log.">
          <input id="rb-reason" className={inputClass} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. post-update error rose" />
        </Field>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-slate-300">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-teal-400" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
        I approve rolling back the active model. The artifact&apos;s SHA-256 is verified before it is restored.
      </label>
      {touched && !approved && <p className="text-xs text-rose-300">Tick the box to confirm.</p>}
      <Button type="submit" variant="danger" icon={Undo2} loading={pending}>
        Roll back
      </Button>
    </form>
  );
}

export function RegistryDetails({ json }: { json: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="inline-flex items-center gap-1 text-xs text-teal-300 hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>
        <History className="h-3.5 w-3.5" aria-hidden /> {open ? "Hide" : "Metadata"}
      </button>
      {open && <pre className="mt-2 max-h-72 max-w-xl overflow-auto whitespace-pre-wrap rounded-lg bg-navy-950 p-3 text-left font-mono text-[11px] text-slate-300">{json}</pre>}
    </>
  );
}
