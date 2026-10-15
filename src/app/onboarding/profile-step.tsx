"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CircleNotch } from "@phosphor-icons/react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { api } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MODEL_COUNTS, ProfileSchema, TEAM_ROLES, USE_CASES, type Profile } from "@/lib/profile";
import { cn } from "@/lib/utils";

function Err({ msg }: { msg?: string }) {
  return msg ? (
    <p role="alert" className="text-[12.5px] text-bad">
      {msg}
    </p>
  ) : null;
}

/** First-time profile: who you are and what you will monitor. */
export function ProfileStep({ email, initial, onDone }: { email: string; initial: Partial<Profile>; onDone: () => void }) {
  const form = useForm<Profile>({
    resolver: zodResolver(ProfileSchema),
    mode: "onTouched",
    defaultValues: {
      name: initial.name ?? "",
      jobTitle: initial.jobTitle ?? "",
      company: initial.company ?? "",
      teamRole: initial.teamRole,
      useCase: initial.useCase,
      modelsInProduction: initial.modelsInProduction,
      emailApprovals: initial.emailApprovals ?? true,
    },
  });
  const { register, control, handleSubmit, formState } = form;
  const e = formState.errors;

  return (
    <section>
      <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.01em]">Tell us about you</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        Your email <span className="font-medium text-foreground">{email}</span> is verified. A few details help teammates recognise you in approvals and the audit trail, and let RetrainWise suggest sensible defaults.
      </p>

      <form
        noValidate
        className="mt-8 space-y-7"
        onSubmit={handleSubmit(async (values) => {
          try {
            await api("/api/onboarding/profile", { body: values });
            onDone();
          } catch (err) {
            toast.error("Profile not saved", { description: (err as Error).message });
          }
        })}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="p-name" className="text-[13px]">
              Full name
            </Label>
            <Input id="p-name" autoFocus autoComplete="name" className="h-10" aria-invalid={!!e.name} {...register("name")} />
            <Err msg={e.name?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-title" className="text-[13px]">
              Job title
            </Label>
            <Input id="p-title" autoComplete="organization-title" placeholder="e.g. Senior ML engineer" className="h-10" aria-invalid={!!e.jobTitle} {...register("jobTitle")} />
            <Err msg={e.jobTitle?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-company" className="text-[13px]">
              Company or organisation
            </Label>
            <Input id="p-company" autoComplete="organization" className="h-10" aria-invalid={!!e.company} {...register("company")} />
            <Err msg={e.company?.message} />
          </div>
        </div>

        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">Which best describes your role?</legend>
          <Controller
            control={control}
            name="teamRole"
            render={({ field }) => (
              <div role="radiogroup" aria-label="Your role" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {TEAM_ROLES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={field.value === r.id}
                    onClick={() => field.onChange(r.id)}
                    className={cn(
                      "h-10 rounded-md border px-3 text-left text-[13px] transition-colors",
                      field.value === r.id ? "border-foreground bg-foreground text-background" : "border-border hover:border-foreground/40",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          />
          <div className="mt-1.5">
            <Err msg={e.teamRole?.message} />
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-use" className="text-[13px]">
              What will you monitor?
            </Label>
            <Controller
              control={control}
              name="useCase"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="p-use" className="h-10 w-full" aria-invalid={!!e.useCase}>
                    <SelectValue placeholder="Choose a use case" />
                  </SelectTrigger>
                  <SelectContent>
                    {USE_CASES.map((u) => (
                      <SelectItem key={u} value={u}>
                        {u}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <Err msg={e.useCase?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-models" className="text-[13px]">
              Models in production today
            </Label>
            <Controller
              control={control}
              name="modelsInProduction"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="p-models" className="h-10 w-full" aria-invalid={!!e.modelsInProduction}>
                    <SelectValue placeholder="Choose a range" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODEL_COUNTS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m === "none" ? "None yet" : m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <Err msg={e.modelsInProduction?.message} />
          </div>
        </div>

        <div className="flex items-start justify-between gap-6 border-y border-border py-4">
          <div>
            <Label htmlFor="p-email-approvals" className="text-[13.5px]">
              Email me when an approval needs me
            </Label>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">In-app notifications are always on. You can change this later in your profile.</p>
          </div>
          <Controller control={control} name="emailApprovals" render={({ field }) => <Switch id="p-email-approvals" checked={field.value} onCheckedChange={field.onChange} />} />
        </div>

        <Button type="submit" size="lg" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? <CircleNotch className="animate-spin" /> : null}
          Continue <ArrowRight />
        </Button>
      </form>
    </section>
  );
}
