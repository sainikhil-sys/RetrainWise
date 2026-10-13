import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { mailConfigured } from "@/lib/mail";
import { AuthFrame } from "../auth-frame";

export const metadata: Metadata = { title: "Check your email" };
export const dynamic = "force-dynamic";

export default function CheckEmailPage() {
  const dev = !mailConfigured() && process.env.NODE_ENV !== "production";
  return (
    <AuthFrame>
      <EnvelopeSimple size={32} weight="thin" />
      <h1 className="mt-4 font-serif text-[36px] leading-[1.05]">Check your email</h1>
      <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
        We sent a sign-in link. It expires in 15 minutes and works once. Opening it verifies your email and signs you in on this device.
      </p>
      {dev && (
        <p className="mt-6 rounded-md border border-border bg-subtle px-3 py-2 text-[13px]">
          Development mode: open the link from the{" "}
          <Link href="/dev/mailbox" className="underline underline-offset-4">
            local outbox
          </Link>
          .
        </p>
      )}
      <Link href="/signin" className="mt-8 inline-block text-[13px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
        Use a different email
      </Link>
    </AuthFrame>
  );
}
