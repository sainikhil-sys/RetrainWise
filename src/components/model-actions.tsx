"use client";

import { ArrowCounterClockwise, CheckCircle, Prohibit, Repeat, Trash, X } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { ConfirmDialog, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const vv = (n: number) => `v${String(n).padStart(3, "0")}`;
type Variant = "default" | "secondary" | "outline" | "ghost" | "destructive";

/** Button + confirmation dialog, optionally with a required reason. */
function ConfirmAction({
  label,
  icon,
  variant = "secondary",
  size,
  title,
  description,
  confirmLabel,
  destructive,
  reason,
  reasonLabel = "Reason",
  disabled,
  children,
  submit,
}: {
  label: ReactNode;
  icon?: ReactNode;
  variant?: Variant;
  size?: "sm" | "default";
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  reason?: "required" | "optional";
  reasonLabel?: string;
  disabled?: boolean;
  children?: ReactNode;
  submit: (reason: string, run: ReturnType<typeof useAction>["run"]) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const act = useAction();
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled || act.pending} onClick={() => setOpen(true)}>
        {icon}
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setText("");
        }}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        destructive={destructive}
        pending={act.pending}
        disabled={reason === "required" && text.trim().length < 3}
        onConfirm={async () => {
          const r = await submit(text.trim(), act.run);
          if (r) {
            setOpen(false);
            setText("");
          }
        }}
      >
        {children}
        {reason && (
          <div className="space-y-1.5">
            <Label htmlFor="action-reason" className="text-[13px]">
              {reasonLabel}
              {reason === "optional" && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea id="action-reason" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}

export function RollbackButton({ version, activeVersion, size }: { version: number; activeVersion: number | null; size?: "sm" | "default" }) {
  return (
    <ConfirmAction
      label={size === "sm" ? "Roll back" : `Roll back to ${vv(version)}`}
      icon={<ArrowCounterClockwise />}
      size={size}
      title={`Roll back to ${vv(version)}?`}
      description={`${activeVersion ? vv(activeVersion) : "The current model"} leaves production and ${vv(version)} is restored after its artifact checksum is verified. Monitors restart against the restored model. You can roll forward again the same way.`}
      confirmLabel="Roll back"
      reason="required"
      submit={(reason, run) =>
        run(`/api/models/${version}/rollback`, { approved: true, reason }, { success: () => `${vv(version)} restored to production`, failure: "Rollback failed" })
      }
    />
  );
}

export function PromoteButton({ version, activeVersion, disabled }: { version: number; activeVersion: number | null; disabled?: boolean }) {
  return (
    <ConfirmAction
      label="Approve and promote"
      icon={<CheckCircle />}
      variant="default"
      disabled={disabled}
      title={`Promote ${vv(version)} to production?`}
      description={`The candidate's checksum and chronological validation gate are checked again. If they pass, ${vv(version)} replaces ${activeVersion ? vv(activeVersion) : "the current model"}, which stays archived for rollback.`}
      confirmLabel="Promote"
      submit={(_r, run) =>
        run<{ status: string }>(`/api/models/${version}/promote`, { approved: true }, { success: () => `${vv(version)} promoted after chronological validation`, failure: "Promotion failed" })
      }
    />
  );
}

export function RequestPromotionButton({ version }: { version: number }) {
  return (
    <ConfirmAction
      label="Request promotion"
      variant="secondary"
      title={`Request promotion of ${vv(version)}`}
      description="Approvers are notified. Production does not change until one of them approves."
      confirmLabel="Send request"
      reason="optional"
      reasonLabel="Note for the approver"
      submit={(reason, run) =>
        run(`/api/models/${version}/review`, { action: "request", reason: reason || "Validated candidate ready for review." }, { success: () => "Promotion requested", failure: "Could not request promotion" })
      }
    />
  );
}

export function RejectCandidateButton({ version }: { version: number }) {
  return (
    <ConfirmAction
      label="Reject"
      icon={<Prohibit />}
      variant="destructive"
      title={`Reject ${vv(version)}?`}
      description="The candidate is marked rejected and can no longer be promoted. Its metrics and logs stay in the history."
      confirmLabel="Reject candidate"
      destructive
      reason="required"
      submit={(reason, run) => run(`/api/models/${version}/review`, { action: "reject", reason }, { success: () => `${vv(version)} rejected`, failure: "Could not reject" })}
    />
  );
}

export function RevalidateButton({ version }: { version: number }) {
  const act = useAction();
  return (
    <Button
      variant="secondary"
      disabled={act.pending}
      onClick={() =>
        act.run<{ gate?: { passed: boolean } }>(`/api/models/${version}/validate`, {}, {
          success: (r) => (r.gate?.passed ? "Validation passed" : "Validation completed: gate not passed"),
          description: () => "Scored on withheld chronological data. Production is unchanged.",
          failure: "Validation failed",
        })
      }
    >
      <Repeat />
      {act.pending ? "Validating…" : "Validate again"}
    </Button>
  );
}

export function CancelJobButton({ jobId, size = "sm" }: { jobId: string; size?: "sm" | "default" }) {
  return (
    <ConfirmAction
      label="Cancel"
      icon={<X />}
      size={size}
      variant="ghost"
      title="Cancel this training job?"
      description="The worker stops at the next checkpoint. Nothing is registered or promoted. The logs so far are kept."
      confirmLabel="Cancel job"
      destructive
      submit={(_r, run) => run(`/api/jobs/${jobId}/cancel`, {}, { success: () => "Cancellation requested", failure: "Could not cancel" })}
    />
  );
}

export function DeleteJobButton({ jobId }: { jobId: string }) {
  return (
    <ConfirmAction
      label="Delete"
      icon={<Trash />}
      size="sm"
      variant="ghost"
      title="Delete this job?"
      description="The failed or cancelled job and its logs are removed. The deletion itself is recorded in the audit trail."
      confirmLabel="Delete job"
      destructive
      submit={(_r, run) => run(`/api/jobs/${jobId}/delete`, {}, { success: () => "Job deleted", failure: "Could not delete" })}
    />
  );
}
