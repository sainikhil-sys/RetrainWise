"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, UnverifiedEmail, type CodeDelivery } from "@/lib/auth/auth";
import { MailError, MailNotConfigured } from "@/lib/auth/mail";
import { auth, DEV_CODE_COOKIE, endSession, startSession } from "@/lib/auth/session";
import type { ActionState } from "@/components/client";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const clean = (email: string) => email.trim().toLowerCase();
const q = (email: string) => encodeURIComponent(clean(email));

function mailFailure(exc: MailError): ActionState {
  const admin = exc instanceof MailNotConfigured
    ? " Administrator: copy .env.example to .env, fill in the SMTP settings, restart the app, and run " +
      "`npm run mail:test -- you@example.com` to confirm delivery."
    : "";
  return { ok: false, message: `We could not send the email. ${exc.message}${admin}` };
}

/** Remember a development-mode code (only ever set when SMTP is not configured and AUTH_DEV_CODES=1). */
async function rememberDevCode(delivery: CodeDelivery | null): Promise<void> {
  const jar = await cookies();
  if (delivery?.devCode) jar.set(DEV_CODE_COOKIE, delivery.devCode, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  else jar.delete(DEV_CODE_COOKIE);
}

function failure(exc: unknown): ActionState {
  if (exc instanceof MailError) return mailFailure(exc);
  if (exc instanceof AuthError) return { ok: false, message: exc.message };
  throw exc;
}

export async function signInAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email");
  let user;
  try {
    user = auth().login(email, field(form, "password"));
  } catch (exc) {
    if (!(exc instanceof UnverifiedEmail)) return failure(exc);
    let sent = "";
    try {
      await rememberDevCode(await auth().sendCode(email, "verify"));
      sent = "&sent=1";
    } catch (inner) {
      if (!(inner instanceof AuthError)) return failure(inner); // AuthError = cooldown: an earlier code is still valid
    }
    redirect(`/verify?email=${q(email)}${sent}`);
  }
  await startSession(user);
  redirect("/");
}

export async function signUpAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email");
  try {
    await rememberDevCode(await auth().register(field(form, "name"), email, field(form, "password"), field(form, "confirm")));
  } catch (exc) {
    if (exc instanceof MailError) {
      const state = mailFailure(exc)!;
      return { ok: false, message: `${state.message} Your account was saved; fix the email settings, then use ` +
        "\"Resend code\" on the verification page." };
    }
    return failure(exc);
  }
  redirect(`/verify?email=${q(email)}&sent=1`);
}

export async function verifyAction(_: ActionState, form: FormData): Promise<ActionState> {
  let user;
  try {
    user = auth().verifyEmail(field(form, "email"), field(form, "code"));
  } catch (exc) {
    return failure(exc);
  }
  (await cookies()).delete(DEV_CODE_COOKIE);
  await startSession(user);
  redirect("/");
}

export async function resendAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email");
  const purpose = field(form, "purpose") === "reset" ? "reset" : "verify";
  try {
    const delivery = await auth().sendCode(email, purpose);
    await rememberDevCode(delivery);
    return { ok: true, message: delivery.devCode ? "Email is not configured; the new code is shown above (development mode)."
      : `A new code was sent to ${clean(email)}. Check your spam/junk folder if you do not see it.` };
  } catch (exc) {
    return failure(exc);
  }
}

export async function forgotAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = field(form, "email");
  try {
    await rememberDevCode(await auth().requestReset(email));
  } catch (exc) {
    return failure(exc);
  }
  redirect(`/reset?email=${q(email)}&sent=1`);
}

export async function resetAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    auth().resetPassword(field(form, "email"), field(form, "code"), field(form, "password"), field(form, "confirm"));
  } catch (exc) {
    return failure(exc);
  }
  (await cookies()).delete(DEV_CODE_COOKIE);
  redirect(`/signin?email=${q(field(form, "email"))}&reset=1`);
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/signin");
}
