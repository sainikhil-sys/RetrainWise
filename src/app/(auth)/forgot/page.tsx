import Link from "next/link";
import { ActionForm, Submit } from "@/components/client";
import { forgotAction } from "../actions";

export default async function Forgot({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { email } = await searchParams;
  return (
    <>
      <h1>Reset your password</h1>
      <p>Enter your account email and we will send you a code to reset your password.</p>
      <ActionForm action={forgotAction}>
        <label>Email<input name="email" type="email" autoComplete="email" required defaultValue={email ?? ""} /></label>
        <Submit pendingText="Sending…">Send reset code</Submit>
      </ActionForm>
      <div className="links">
        <Link href="/signin">Back to sign in</Link>
      </div>
    </>
  );
}
