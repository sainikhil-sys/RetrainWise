import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { AuthFrame } from "../auth-frame";

export const metadata: Metadata = { title: "Sign-in problem" };

const MESSAGES: Record<string, string> = {
  Verification: "This sign-in link has expired or was already used. Request a new one.",
  Configuration: "Sign-in is not configured correctly on the server. Check AUTH_SECRET and the mail settings.",
  AccessDenied: "Access was denied.",
};

export default async function SignInErrorPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthFrame>
      <h1 className="font-serif text-[36px] leading-[1.05]">Sign-in problem</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">{MESSAGES[error ?? ""] ?? "Something went wrong while signing in. Try again."}</p>
      <Button asChild className="mt-8">
        <Link href="/signin">Request a new link</Link>
      </Button>
    </AuthFrame>
  );
}
