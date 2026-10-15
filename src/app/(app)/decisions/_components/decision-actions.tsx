"use client";

import { useState } from "react";

import { Callout, KV, Tag } from "@/components/rw";
import { ConfirmDialog, Spinner, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ACTION_LABELS } from "@/lib/catalog";
import { money } from "@/lib/format";
import type { Action } from "@/lib/types";

type Option = { action: Action; feasible: boolean; net: number; cost: number };
type PendingRequest = { id: number; action: Action; prepared_by: string; rationale: string };

/**
 * Request, approve or reject an action for a pending decision. Operators can
 * only request; approvers approve (which validates and then promotes). The
 * API enforces the same rules, including separate-approver workspaces.
 */
export function DecisionActions({
  decisionId,
  recommended,
  options,
  canRequest,
  canApprove,
  requireSeparate,
  me,
  pending,
}: {
  decisionId: string;
  recommended: Action;
  options: Option[];
  canRequest: boolean;
  canApprove: boolean;
  requireSeparate: boolean;
  me: string;
  pending: PendingRequest | null;
}) {
  const [mode, setMode] = useState<"request" | "approve" | "approve-request" | "reject" | null>(null);
  const [choice, setChoice] = useState<Action>(recommended);
  const [text, setText] = useState("");
  const act = useAction();
  const chosen = options.find((o) => o.action === choice);
  const ownRequest = pending?.prepared_by === me;

  const close = () => {
    setMode(null);
    setText("");
  };

  async function submit() {
    let ok: unknown = null;
    if (mode === "request") {
      ok = await act.run(`/api/decisions/${decisionId}/request`, { action: choice, rationale: text }, { success: () => "Approval requested", description: () => "Approvers in this workspace have been notified.", failure: "Could not request approval" });
    } else if (mode === "approve") {
      ok = await act.run<{ status: string; outcome: string }>(`/api/decisions/${decisionId}/execute`, { action: choice, approved: true }, { success: (r) => `Decision ${r.status}`, description: (r) => r.outcome, failure: "Action failed" });
    } else if (mode === "approve-request" && pending) {
      ok = await act.run<{ status: string; outcome: string }>(`/api/requests/${pending.id}/approve`, { approved: true }, { success: (r) => `Request #${pending.id} ${r.status}`, description: (r) => r.outcome, failure: "Action failed" });
    } else if (mode === "reject" && pending) {
      ok = await act.run(`/api/requests/${pending.id}/reject`, { reason: text }, { success: () => `Request #${pending.id} rejected`, failure: "Could not reject the request" });
    }
    if (ok) close();
  }

  const picker = (
    <RadioGroup value={choice} onValueChange={(v) => setChoice(v as Action)} className="gap-0 overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <Label key={o.action} htmlFor={`opt-${o.action}`} className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 font-normal last:border-b-0 has-[[data-state=checked]]:bg-subtle">
          <RadioGroupItem id={`opt-${o.action}`} value={o.action} disabled={!o.feasible && o.action !== "defer"} />
          <span className="flex-1 text-[13.5px]">
            {ACTION_LABELS[o.action]}
            {o.action === recommended && <span className="ml-2 text-[11.5px] text-muted-foreground">recommended</span>}
          </span>
          <span className="tabular text-[12.5px] text-muted-foreground">{o.action === "defer" ? "no cost" : o.feasible ? `net ${money(o.net)}` : "blocked"}</span>
        </Label>
      ))}
    </RadioGroup>
  );

  return (
    <div className="space-y-4">
      {pending && (
        <Callout tone="info" title={`Request #${pending.id}: ${ACTION_LABELS[pending.action]}`}>
          Requested by {pending.prepared_by}: “{pending.rationale}”
        </Callout>
      )}

      <div className="flex flex-wrap gap-2">
        {pending && canApprove && (
          <>
            <Button disabled={act.pending || (requireSeparate && ownRequest)} onClick={() => setMode("approve-request")}>
              Approve request
            </Button>
            <Button variant="destructive" disabled={act.pending} onClick={() => setMode("reject")}>
              Reject
            </Button>
          </>
        )}
        {!pending && canApprove && (
          <Button disabled={act.pending} onClick={() => setMode("approve")}>
            Approve an action
          </Button>
        )}
        {!pending && canRequest && (
          <Button variant={canApprove ? "secondary" : "default"} disabled={act.pending} onClick={() => setMode("request")}>
            Request approval
          </Button>
        )}
      </div>
      {pending && requireSeparate && ownRequest && canApprove && <p className="text-[12px] text-muted-foreground">This workspace requires a different person to approve your own request.</p>}
      {!pending && canApprove && requireSeparate && <p className="text-[12px] text-muted-foreground">This workspace requires updates to be requested by one person and approved by another. You can approve keeping the existing model directly.</p>}
      {!canRequest && !canApprove && <p className="text-[12px] text-muted-foreground">Viewers can read decisions. Requesting an update requires the Operator role; approving requires the Approver role.</p>}

      <ConfirmDialog
        open={mode === "request"}
        onOpenChange={(o) => !o && close()}
        title="Request approval"
        description="Nothing changes until an approver accepts. They see your rationale and the stored evidence."
        confirmLabel="Send request"
        pending={act.pending}
        disabled={text.trim().length < 3}
        onConfirm={submit}
      >
        <div className="space-y-4">
          {picker}
          <div className="space-y-1.5">
            <Label htmlFor="rationale" className="text-[13px]">
              Rationale
            </Label>
            <Textarea id="rationale" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why this action, in a sentence." maxLength={1000} />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={mode === "approve"}
        onOpenChange={(o) => !o && close()}
        title={choice === "defer" ? "Keep the existing model?" : `Approve: ${ACTION_LABELS[choice]}`}
        description={
          choice === "defer"
            ? "The decision is closed and the current model stays in production."
            : "The engine re-checks guardrails with current spend, verifies the candidate checksum and re-runs chronological validation. Production changes only if every check passes. You can roll back from Model lifecycle."
        }
        confirmLabel={choice === "defer" ? "Keep current model" : "Approve and promote"}
        pending={act.pending}
        disabled={requireSeparate && choice !== "defer"}
        onConfirm={submit}
      >
        <div className="space-y-3">
          {picker}
          {chosen && chosen.action !== "defer" && <KV items={[["Simulated cost", money(chosen.cost)], ["Net expected value", money(chosen.net)]]} />}
          {requireSeparate && choice !== "defer" && <p className="text-[12px] text-bad">This workspace requires someone else to request this update first.</p>}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={mode === "approve-request"}
        onOpenChange={(o) => !o && close()}
        title={pending ? `Approve: ${ACTION_LABELS[pending.action]}` : "Approve"}
        description="Guardrails, the candidate checksum and chronological validation are checked again before anything is promoted. You can roll back from Model lifecycle."
        confirmLabel="Approve and run"
        pending={act.pending}
        onConfirm={submit}
      >
        {pending && (
          <p className="text-[13px] text-ink-2">
            <Tag>#{pending.id}</Tag> requested by {pending.prepared_by}
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={mode === "reject"}
        onOpenChange={(o) => !o && close()}
        title="Reject this request?"
        description="The reason is recorded in the audit trail and shown to the requester."
        confirmLabel="Reject request"
        destructive
        pending={act.pending}
        disabled={text.trim().length < 3}
        onConfirm={submit}
      >
        <div className="space-y-1.5">
          <Label htmlFor="reason" className="text-[13px]">
            Reason
          </Label>
          <Textarea id="reason" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
        </div>
      </ConfirmDialog>
      {act.pending && (
        <p className="flex items-center gap-2 text-[12px] text-muted-foreground" aria-live="polite">
          <Spinner /> Working… validation can take a minute.
        </p>
      )}
    </div>
  );
}
