"use client";

import { CircleNotch } from "@phosphor-icons/react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resendCode, verifyCode, type VerifyState } from "../actions";

const LENGTH = 6;

export function OtpForm({ maskedEmail }: { maskedEmail: string }) {
  const [digits, setDigits] = useState<string[]>(Array(LENGTH).fill(""));
  const [state, action] = useActionState<VerifyState, FormData>(verifyCode, null);
  const [resendState, resend] = useActionState<VerifyState>(resendCode, null);
  const [pending, start] = useTransition();
  const [resending, startResend] = useTransition();
  const [cooldown, setCooldown] = useState(30);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const submitted = useRef("");

  // Successful check: hand over to the Auth.js callback with a full navigation.
  useEffect(() => {
    if (state?.redirectTo) window.location.assign(state.redirectTo);
  }, [state]);

  // Clear the boxes after a wrong code so the next attempt starts clean.
  useEffect(() => {
    if (state?.error) {
      setDigits(Array(LENGTH).fill(""));
      submitted.current = "";
      inputs.current[0]?.focus();
    }
  }, [state]);

  useEffect(() => {
    if (resendState?.sent) setCooldown(30);
  }, [resendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const code = digits.join("");
  const busy = pending || !!state?.redirectTo;

  function submit(value: string) {
    if (value.length !== LENGTH || submitted.current === value) return;
    submitted.current = value;
    const fd = new FormData();
    fd.set("code", value);
    start(() => action(fd));
  }

  function setAt(i: number, raw: string) {
    const clean = raw.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => d.map((x, j) => (j === i ? "" : x)));
      return;
    }
    // Paste or autofill of several digits fills from this box onward.
    const next = [...digits];
    for (let k = 0; k < clean.length && i + k < LENGTH; k++) next[i + k] = clean[k];
    setDigits(next);
    const focus = Math.min(i + clean.length, LENGTH - 1);
    inputs.current[focus]?.focus();
    if (next.every(Boolean)) submit(next.join(""));
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(code);
        }}
      >
        <fieldset disabled={busy}>
          <legend className="sr-only">6-digit sign-in code sent to {maskedEmail}</legend>
          <div className="flex justify-between gap-2" onPaste={(e) => {
            const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
            if (text.length > 1) {
              e.preventDefault();
              setAt(0, text);
            }
          }}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  inputs.current[i] = el;
                }}
                value={d}
                onChange={(e) => setAt(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
                  if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
                  if (e.key === "ArrowRight" && i < LENGTH - 1) inputs.current[i + 1]?.focus();
                }}
                onFocus={(e) => e.target.select()}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                autoFocus={i === 0}
                maxLength={i === 0 ? LENGTH : 1}
                aria-label={`Digit ${i + 1}`}
                aria-invalid={!!state?.error}
                className={cn(
                  "h-14 w-full min-w-0 rounded-md border bg-background text-center font-mono text-[24px] font-semibold outline-none transition-colors focus:border-foreground focus:ring-2 focus:ring-foreground/10",
                  state?.error ? "border-bad/60" : "border-border",
                )}
              />
            ))}
          </div>
        </fieldset>
        {state?.error && (
          <p role="alert" className="mt-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {state.error}
          </p>
        )}
        {resendState?.error && (
          <p role="alert" className="mt-3 rounded-md border border-bad/25 bg-bad-soft px-3 py-2 text-[13px] text-bad">
            {resendState.error}
          </p>
        )}
        {resendState?.sent && !resendState.error && <p className="mt-3 text-[13px] text-ok">A new code is on its way.</p>}
        <Button type="submit" size="lg" className="mt-5 w-full" disabled={busy || code.length !== LENGTH}>
          {busy && <CircleNotch className="animate-spin" size={15} />}
          {state?.redirectTo ? "Signing you in…" : busy ? "Checking…" : "Verify and sign in"}
        </Button>
      </form>
      <div className="mt-5 flex items-center justify-between text-[13px]">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
          disabled={cooldown > 0 || resending}
          onClick={() => startResend(() => resend())}
        >
          {resending ? "Sending…" : cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </button>
        <a href="/signin" className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Use a different email
        </a>
      </div>
    </div>
  );
}
