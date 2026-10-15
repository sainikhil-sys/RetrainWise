import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { mailConfigured } from "@/lib/mail";
import { AuthFrame } from "./auth-frame";
import { SignInForm } from "./signin-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const session = await auth();
  if (session?.user) redirect(next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/overview");
  return (
    <AuthFrame>
      <h1 className="font-serif text-[40px] leading-[1.05] tracking-[-0.01em]">Sign in</h1>
      <p className="mb-8 mt-2 text-[14px] text-ink-2">Use any email address. No password needed.</p>
      <SignInForm next={next} />
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-8 border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
          {mailConfigured()
            ? "Development mode: if the email does not arrive (for example the mail provider rejects the sender), the code is kept in the local outbox at "
            : "Development mode: no mail provider is configured, so sign-in codes go to the local outbox at "}
          <a href="/dev/mailbox" className="text-foreground underline underline-offset-4">
            /dev/mailbox
          </a>{" "}
          and the reason is printed in the terminal.
        </p>
      )}
    </AuthFrame>
  );
}
