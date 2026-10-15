"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle, CircleNotch, PaperPlaneTilt } from "@phosphor-icons/react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { api } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const TOPICS = ["Question", "Bug report", "Feature request", "Security", "Other"] as const;
const Schema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.string().trim().email("Enter a valid email address.").max(200),
  company: z.string().trim().max(100),
  topic: z.enum(TOPICS),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters).").max(4000),
  website: z.string().max(0),
});
type Form = z.infer<typeof Schema>;

export function ContactForm({ defaultEmail }: { defaultEmail?: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, control, handleSubmit, formState, reset } = useForm<Form>({
    resolver: zodResolver(Schema),
    mode: "onTouched",
    defaultValues: { name: "", email: defaultEmail ?? "", company: "", topic: "Question", message: "", website: "" },
  });
  const e = formState.errors;

  if (sent) {
    return (
      <div className="rounded-xl border border-border p-8 text-center" role="status">
        <CheckCircle size={36} weight="thin" className="mx-auto text-ok" />
        <h2 className="mt-3 font-serif text-[26px]">Message sent</h2>
        <p className="mt-2 text-[14px] text-ink-2">Thanks. We emailed you a copy and will reply soon.</p>
        <Button variant="secondary" className="mt-6" onClick={() => setSent(false)}>
          Send another message
        </Button>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-5 rounded-xl border border-border p-6 sm:p-8"
      onSubmit={handleSubmit(async (values) => {
        setError(null);
        try {
          await api("/api/contact", { body: values });
          reset();
          setSent(true);
        } catch (err) {
          setError((err as Error).message);
        }
      })}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="c-name">Name</Label>
          <Input id="c-name" autoComplete="name" className="h-10" aria-invalid={!!e.name} {...register("name")} />
          {e.name && <p className="text-[12.5px] text-bad">{e.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-email">Email</Label>
          <Input id="c-email" type="email" autoComplete="email" className="h-10" aria-invalid={!!e.email} {...register("email")} />
          {e.email && <p className="text-[12.5px] text-bad">{e.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-company">
            Company <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="c-company" autoComplete="organization" className="h-10" {...register("company")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-topic">Topic</Label>
          <Controller
            control={control}
            name="topic"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="c-topic" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPICS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-message">Message</Label>
        <Textarea id="c-message" rows={6} aria-invalid={!!e.message} {...register("message")} />
        {e.message && <p className="text-[12.5px] text-bad">{e.message.message}</p>}
      </div>
      {/* Honeypot: hidden from people, tempting for bots. */}
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="absolute left-[-9999px] h-0 w-0 opacity-0" {...register("website")} />
      {error && (
        <p role="alert" className="rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-[13px] text-bad">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? <CircleNotch className="animate-spin" /> : <PaperPlaneTilt />}
        Send message
      </Button>
    </form>
  );
}
