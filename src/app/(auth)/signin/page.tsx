import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { Alert } from "@/components/ui";
import { currentUser } from "@/lib/auth/session";
import { signInAction } from "../actions";

export default async function SignIn({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  if (await currentUser()) redirect("/");
  const params = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {params.reset ? <Alert tone="good">Password updated. Sign in with your new password.</Alert> : null}
      <ActionForm action={signInAction}>
        <label>Email<input name="email" type="email" autoComplete="email" required defaultValue={params.email ?? ""} /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <Submit pendingText="Signing in…">Sign in</Submit>
      </ActionForm>
      <div className="links">
        <Link href="/signup">Create an account</Link>
        <Link href="/forgot">Forgot password?</Link>
      </div>
    </>
  );
}
