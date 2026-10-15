"use server";

import { AuthError } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { signIn } from "@/auth";
import { clientIp } from "@/lib/authz";
import { OTP_COOKIE, OTP_MAX_ATTEMPTS, OTP_MINUTES, checkOtp, resetOtpAttempts } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";

const Email = z.string().trim().toLowerCase().email().max(200);

export type SignInState = { error?: string } | null;
export type VerifyState = { error?: string; redirectTo?: string; sent?: boolean } | null;

function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/overview";
}

async function pending(): Promise<{ email: string; next: string } | null> {
  const raw = (await cookies()).get(OTP_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { email?: unknown; next?: unknown };
    const email = Email.safeParse(v.email);
    return email.success ? { email: email.data, next: safeNext(typeof v.next === "string" ? v.next : undefined) } : null;
  } catch {
    return null;
  }
}

/** Ask Auth.js to create a code and email it (no redirect: we show our own code form). */
async function sendCode(email: string, next: string): Promise<string | null> {
  try {
    await signIn("resend", { email, redirectTo: next, redirect: false });
    resetOtpAttempts(email);
    return null;
  } catch (err) {
    if (err instanceof AuthError) return "We could not send the sign-in code. Check the mail configuration and try again.";
    throw err;
  }
}

/** Step 1: email a 6-digit code. Rate limited per email (3/10 min) and per IP (10/10 min). */
export async function requestCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = Email.safeParse(form.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const email = parsed.data;
  const next = safeNext((form.get("next") as string | null) ?? undefined);
  const ip = (await clientIp()) ?? "local";
  if (!rateLimit(`otp-send:${email}`, 3, 10 * 60_000).ok || !rateLimit(`otp-send-ip:${ip}`, 10, 10 * 60_000).ok) {
    return { error: "Too many codes requested. Wait a few minutes and try again." };
  }
  const error = await sendCode(email, next);
  if (error) return { error };
  (await cookies()).set(OTP_COOKIE, JSON.stringify({ email, next }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: OTP_MINUTES * 60 + 120,
  });
  redirect("/signin/verify");
}

/** Step 2: check the code; on success hand over to the Auth.js callback, which signs in. */
export async function verifyCode(_prev: VerifyState, form: FormData): Promise<VerifyState> {
  const p = await pending();
  if (!p) return { error: "Your sign-in request expired. Enter your email again." };
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return { error: "Enter the 6-digit code from the email." };
  const ip = (await clientIp()) ?? "local";
  if (!rateLimit(`otp-verify-ip:${ip}`, 30, 10 * 60_000).ok) return { error: "Too many attempts. Wait a few minutes and try again." };

  const r = await checkOtp(p.email, code);
  if (!r.ok) {
    if (r.reason === "locked") return { error: `Too many incorrect codes (${OTP_MAX_ATTEMPTS}). Request a new code.` };
    if (r.reason === "expired") return { error: "This code has expired. Request a new code." };
    return { error: `That code is not correct. ${r.remaining} attempt${r.remaining === 1 ? "" : "s"} left.` };
  }
  resetOtpAttempts(p.email);
  // The pending-email cookie is left to expire: deleting it here re-renders
  // /signin/verify, which then redirects away before the browser can follow
  // the callback. It holds no secret, and the code is single use.
  const qs = new URLSearchParams({ callbackUrl: p.next, token: code, email: p.email });
  return { redirectTo: `/api/auth/callback/resend?${qs}` };
}

/** Send a fresh code to the pending email (previous codes stay valid until they expire). */
export async function resendCode(_prev: VerifyState): Promise<VerifyState> {
  const p = await pending();
  if (!p) return { error: "Your sign-in request expired. Enter your email again." };
  if (!rateLimit(`otp-send:${p.email}`, 3, 10 * 60_000).ok) return { error: "Too many codes requested. Wait a few minutes and try again." };
  const error = await sendCode(p.email, p.next);
  return error ? { error } : { sent: true };
}
