import { EnvelopeSimple } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { OTP_COOKIE, OTP_MINUTES, maskEmail } from "@/lib/otp";
import { AuthFrame } from "../auth-frame";
import { OtpForm } from "./otp-form";

export const metadata: Metadata = { title: "Enter your code" };
export const dynamic = "force-dynamic";

export default async function VerifyPage() {
  if ((await auth())?.user) redirect("/overview");
  const raw = (await cookies()).get(OTP_COOKIE)?.value;
  let email: string | null = null;
  try {
    email = raw ? (JSON.parse(raw) as { email?: string }).email ?? null : null;
  } catch {
    email = null;
  }
  if (!email) redirect("/signin");
  const masked = maskEmail(email);

  return (
    <AuthFrame>
      <EnvelopeSimple size={30} weight="thin" />
      <h1 className="mt-4 font-serif text-[36px] leading-[1.05]">Check your email</h1>
      <p className="mb-8 mt-3 text-[14px] leading-relaxed text-ink-2">
        We sent a 6-digit code to <span className="font-medium text-foreground">{masked}</span>. It expires in {OTP_MINUTES} minutes. Didn&apos;t get it? Check spam, or resend.
      </p>
      <OtpForm maskedEmail={masked} />
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-8 border-t border-border pt-4 text-[12px] leading-relaxed text-muted-foreground">
          Development mode: if the email provider rejects the message, the code is kept in the{" "}
          <Link href="/dev/mailbox" className="text-foreground underline underline-offset-4">
            local outbox
          </Link>{" "}
          and printed in the terminal.
        </p>
      )}
    </AuthFrame>
  );
}
