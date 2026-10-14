import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { Alert } from "@/components/ui";
import { DEV_CODE_COOKIE } from "@/lib/auth/session";
import { resendAction, verifyAction } from "../actions";

export default async function Verify({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { email, sent } = await searchParams;
  if (!email) redirect("/signin");
  const dev = (await cookies()).get(DEV_CODE_COOKIE)?.value;
  return (
    <>
      <h1>Verify your email</h1>
      {sent ? (
        <Alert tone="good">
          We sent a 6-digit code to {email}. It can take a minute to arrive; check your spam/junk folder if you do not
          see it.
        </Alert>
      ) : null}
      {dev ? <Alert tone="warn">Development mode (SMTP not configured, AUTH_DEV_CODES=1): your code is <strong>{dev}</strong></Alert> : null}
      <p>Enter the 6-digit code sent to <strong>{email}</strong>.</p>
      <ActionForm action={verifyAction}>
        <input type="hidden" name="email" value={email} />
        <label>
          Verification code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\s*\d{3}\s*\d{3}\s*" maxLength={7}
            required />
        </label>
        <Submit pendingText="Verifying…">Verify email</Submit>
      </ActionForm>
      <ActionForm action={resendAction} className="links">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="purpose" value="verify" />
        <Submit className="link" pendingText="Sending…">Resend code</Submit>
        <Link href="/signin">Back to sign in</Link>
      </ActionForm>
    </>
  );
}
