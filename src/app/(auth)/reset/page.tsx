import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { Alert } from "@/components/ui";
import { DEV_CODE_COOKIE } from "@/lib/auth/session";
import { resendAction, resetAction } from "../actions";

export default async function Reset({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { email, sent } = await searchParams;
  if (!email) redirect("/forgot");
  const dev = (await cookies()).get(DEV_CODE_COOKIE)?.value;
  return (
    <>
      <h1>Choose a new password</h1>
      {sent ? (
        <Alert tone="good">
          If an account exists for {email}, a reset code is on its way. Check your spam/junk folder if you do not see it.
        </Alert>
      ) : null}
      {dev ? <Alert tone="warn">Development mode (SMTP not configured, AUTH_DEV_CODES=1): your code is <strong>{dev}</strong></Alert> : null}
      <ActionForm action={resetAction}>
        <input type="hidden" name="email" value={email} />
        <label>
          Reset code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
        </label>
        <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} /></label>
        <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required /></label>
        <Submit pendingText="Updating…">Reset password</Submit>
      </ActionForm>
      <ActionForm action={resendAction} className="links">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="purpose" value="reset" />
        <Submit className="link" pendingText="Sending…">Resend code</Submit>
        <Link href="/signin">Back to sign in</Link>
      </ActionForm>
    </>
  );
}
