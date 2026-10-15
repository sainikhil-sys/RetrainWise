"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog, Spinner, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/permissions";

const Invite = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200), role: z.enum(ROLES) });
type InviteForm = z.infer<typeof Invite>;

export function InviteForm() {
  const act = useAction();
  const { register, control, handleSubmit, formState, reset } = useForm<InviteForm>({ resolver: zodResolver(Invite), defaultValues: { email: "", role: "viewer" } });
  return (
    <form
      className="flex flex-wrap items-start gap-2"
      onSubmit={handleSubmit(async (f) => {
        const r = await act.run<{ delivered: string }>("/api/team", f, {
          success: () => `Invited ${f.email}`,
          description: (r) => (r.delivered !== "dev-outbox" ? "An email with sign-in instructions was sent." : "The email could not be delivered; it is in the development mailbox at /dev/mailbox."),
          failure: "Could not invite",
        });
        if (r) reset({ email: "", role: f.role });
      })}
    >
      <div className="min-w-60 flex-1">
        <Label htmlFor="inv-email" className="sr-only">
          Email
        </Label>
        <Input id="inv-email" type="email" placeholder="name@company.com" {...register("email")} aria-invalid={!!formState.errors.email} />
        {formState.errors.email && <p className="mt-1 text-[12px] text-bad">{formState.errors.email.message}</p>}
      </div>
      <Controller
        control={control}
        name="role"
        render={({ field }) => (
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger className="w-36" aria-label="Role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <Button type="submit" disabled={act.pending}>
        {act.pending && <Spinner />}
        Invite
      </Button>
    </form>
  );
}

export function MemberRole({ userId, email, role, isSelf, canEdit }: { userId: string; email: string; role: Role; isSelf: boolean; canEdit: boolean }) {
  const act = useAction();
  const [next, setNext] = useState<Role | null>(null);
  const [remove, setRemove] = useState(false);
  if (!canEdit) return <span className="text-[13px]">{ROLE_LABELS[role]}</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <Select value={role} onValueChange={(v) => setNext(v as Role)} disabled={act.pending}>
        <SelectTrigger className="h-7 w-32 text-[12.5px]" aria-label={`Role for ${email}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!isSelf && (
        <Button variant="ghost" size="sm" onClick={() => setRemove(true)} disabled={act.pending}>
          Remove
        </Button>
      )}
      <ConfirmDialog
        open={next != null}
        onOpenChange={(o) => !o && setNext(null)}
        title="Change role?"
        description={`${email} becomes ${next ? ROLE_LABELS[next] : ""}. They keep access to everything that role allows.${isSelf ? " You are changing your own role." : ""}`}
        confirmLabel="Change role"
        pending={act.pending}
        onConfirm={async () => {
          const r = await act.run("/api/team", { userId, role: next }, { method: "PATCH", success: () => "Role changed", failure: "Could not change role" });
          if (r) setNext(null);
        }}
      />
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        title="Remove this member?"
        description={`${email} loses access to this workspace. Their past actions stay in the audit trail. You can invite them again later.`}
        confirmLabel="Remove member"
        destructive
        pending={act.pending}
        onConfirm={async () => {
          const r = await act.run("/api/team", { userId, remove: true }, { method: "PATCH", success: () => `${email} removed`, failure: "Could not remove" });
          if (r) setRemove(false);
        }}
      />
    </div>
  );
}

export function RevokeInvite({ id, email }: { id: string; email: string }) {
  const act = useAction();
  return (
    <Button variant="ghost" size="sm" disabled={act.pending} onClick={() => act.run(`/api/team?invitation=${id}`, {}, { method: "DELETE", success: () => `Invitation to ${email} revoked`, failure: "Could not revoke" })}>
      Revoke
    </Button>
  );
}
