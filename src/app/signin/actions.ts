"use server";

import { AuthError } from "next-auth";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";

import { signIn } from "@/auth";
import { clientIp } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";

const Schema = z.object({ email: z.string().trim().toLowerCase().email().max(200), next: z.string().max(200).optional() });

export type SignInState = { error?: string } | null;

/** Request a magic link. Rate limited per email (3/10 min) and per IP (10/10 min). */
export async function requestMagicLink(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = Schema.safeParse({ email: form.get("email"), next: form.get("next") || undefined });
  if (!parsed.success) return { error: "Enter a valid email address." };
  const { email } = parsed.data;
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/overview";
  const ip = (await clientIp()) ?? "local";
  if (!rateLimit(`magic:${email}`, 3, 10 * 60_000).ok || !rateLimit(`magic-ip:${ip}`, 10, 10 * 60_000).ok) {
    return { error: "Too many sign-in links requested. Wait a few minutes and try again." };
  }
  try {
    await signIn("resend", { email, redirectTo: next });
  } catch (err) {
    if (isRedirectError(err)) throw err;
    if (err instanceof AuthError) return { error: "We could not send the sign-in email. Check the mail configuration and try again." };
    throw err;
  }
  return null;
}
