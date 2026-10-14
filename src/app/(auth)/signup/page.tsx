import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Submit } from "@/components/client";
import { currentUser } from "@/lib/auth/session";
import { signUpAction } from "../actions";

export default async function SignUp() {
  if (await currentUser()) redirect("/");
  return (
    <>
      <h1>Create your account</h1>
      <ActionForm action={signUpAction}>
        <label>Name<input name="name" autoComplete="name" required maxLength={80} /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={8}
          aria-describedby="password-hint" /></label>
        <span id="password-hint" className="muted" style={{ marginTop: -8 }}>
          At least 8 characters, mixing letters with numbers or symbols.</span>
        <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required /></label>
        <Submit pendingText="Creating account…">Create account</Submit>
      </ActionForm>
      <div className="links">
        <Link href="/signin">I already have an account</Link>
      </div>
    </>
  );
}
