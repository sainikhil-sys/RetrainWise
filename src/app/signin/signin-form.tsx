"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, CircleNotch } from "@phosphor-icons/react";
import { useActionState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestMagicLink, type SignInState } from "./actions";

const Schema = z.object({ email: z.string().trim().min(1, "Enter your work email.").email("Enter a valid email address.") });

export function SignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState<SignInState, FormData>(requestMagicLink, null);
  const [pending, start] = useTransition();
  const form = useForm<z.infer<typeof Schema>>({ resolver: zodResolver(Schema), defaultValues: { email: "" }, mode: "onTouched" });
  const err = form.formState.errors.email?.message;

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((values) => {
        const fd = new FormData();
        fd.set("email", values.email);
        if (next) fd.set("next", next);
        start(() => action(fd));
      })}
    >
      <div className="space-y-1.5">
        <Label htmlFor="email" className="text-[13px]">
          Work email
        </Label>
        <Input id="email" type="email" autoComplete="email" autoFocus placeholder="you@company.com" aria-invalid={!!err} className="h-10 text-[14px]" {...form.register("email")} />
        {err && (
          <p role="alert" className="text-[12.5px] text-bad">
            {err}
          </p>
        )}
      </div>
      {state?.error && (
        <p role="alert" className="rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <CircleNotch className="animate-spin" size={15} /> : null}
        {pending ? "Sending link…" : "Continue with email"}
        {!pending && <ArrowRight size={14} />}
      </Button>
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        We email you a one-time sign-in link. New here? The same link creates your account; your email is verified when you open it.
      </p>
    </form>
  );
}
