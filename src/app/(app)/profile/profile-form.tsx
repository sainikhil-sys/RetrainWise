"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Spinner, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MODEL_COUNTS, ProfileSchema, TEAM_ROLES, USE_CASES } from "@/lib/profile";

const Schema = z.object({
  name: ProfileSchema.shape.name,
  jobTitle: ProfileSchema.shape.jobTitle,
  company: ProfileSchema.shape.company,
  teamRole: ProfileSchema.shape.teamRole,
  useCase: ProfileSchema.shape.useCase,
  modelsInProduction: ProfileSchema.shape.modelsInProduction,
  notifyApprovals: z.boolean(),
  notifyDecisions: z.boolean(),
  notifyJobs: z.boolean(),
  emailApprovals: z.boolean(),
  emailReports: z.boolean(),
});
type Form = z.infer<typeof Schema>;

const TOGGLES: { key: "notifyApprovals" | "notifyDecisions" | "notifyJobs" | "emailApprovals" | "emailReports"; label: string; help: string }[] = [
  { key: "notifyApprovals", label: "Approval requests", help: "When an update or promotion needs your approval (approvers and admins)." },
  { key: "notifyDecisions", label: "Decisions and outcomes", help: "When a decision is made, an update is promoted or a rollback happens." },
  { key: "notifyJobs", label: "Jobs", help: "When a training job or benchmark finishes or fails." },
  { key: "emailApprovals", label: "Email me approval requests", help: "Also send approval requests by email." },
  { key: "emailReports", label: "Email me a work report after each action", help: "A short, formatted report after runs, batches, evaluations, approvals, training and benchmarks finish, settings changes and team changes." },
];

export function ProfileForm({ initial, email }: { initial: Form; email: string }) {
  const act = useAction();
  const { register, control, handleSubmit, formState, reset } = useForm<Form>({ resolver: zodResolver(Schema), defaultValues: initial });
  return (
    <form
      className="max-w-xl space-y-8"
      onSubmit={handleSubmit(async (f) => {
        const r = await act.run("/api/profile", f, { method: "PATCH", success: () => "Profile saved", failure: "Could not save" });
        if (r) reset(f);
      })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="p-name" className="text-[13px]">
            Name
          </Label>
          <Input id="p-name" placeholder="Optional" {...register("name")} />
          {formState.errors.name && <p className="text-[12px] text-bad">{formState.errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-email" className="text-[13px]">
            Email
          </Label>
          <Input id="p-email" value={email} disabled readOnly />
          <p className="text-[12px] text-muted-foreground">Your sign-in address. It cannot be changed here.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-title" className="text-[13px]">
            Job title
          </Label>
          <Input id="p-title" {...register("jobTitle")} />
          {formState.errors.jobTitle && <p className="text-[12px] text-bad">{formState.errors.jobTitle.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-company" className="text-[13px]">
            Company or organisation
          </Label>
          <Input id="p-company" {...register("company")} />
          {formState.errors.company && <p className="text-[12px] text-bad">{formState.errors.company.message}</p>}
        </div>
        {(
          [
            ["teamRole", "Role", TEAM_ROLES.map((r) => [r.id, r.label])],
            ["useCase", "What you monitor", USE_CASES.map((u) => [u, u])],
            ["modelsInProduction", "Models in production", MODEL_COUNTS.map((m) => [m, m === "none" ? "None yet" : m])],
          ] as const
        ).map(([key, label, options]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`p-${key}`} className="text-[13px]">
              {label}
            </Label>
            <Controller
              control={control}
              name={key}
              render={({ field }) => (
                <Select value={(field.value as string | undefined) ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id={`p-${key}`} className="w-full">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map(([v, l]) => (
                      <SelectItem key={v} value={v}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {formState.errors[key] && <p className="text-[12px] text-bad">{formState.errors[key]?.message}</p>}
          </div>
        ))}
      </div>
      <fieldset>
        <legend className="mb-1 font-serif text-[22px]">Notifications</legend>
        <ul className="divide-y divide-border border-y border-border">
          {TOGGLES.map((t) => (
            <li key={t.key} className="flex items-start justify-between gap-6 py-3">
              <div>
                <Label htmlFor={`p-${t.key}`} className="text-[13.5px]">
                  {t.label}
                </Label>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t.help}</p>
              </div>
              <Controller control={control} name={t.key} render={({ field }) => <Switch id={`p-${t.key}`} checked={field.value} onCheckedChange={field.onChange} />} />
            </li>
          ))}
        </ul>
      </fieldset>
      <Button type="submit" disabled={!formState.isDirty || act.pending}>
        {act.pending && <Spinner />}
        Save profile
      </Button>
    </form>
  );
}

export function ResetTips() {
  const act = useAction();
  return (
    <Button variant="secondary" disabled={act.pending} onClick={() => act.run("/api/profile", { resetTips: true }, { method: "PATCH", success: () => "Tips will show again", failure: "Could not reset tips" })}>
      Show onboarding tips again
    </Button>
  );
}
