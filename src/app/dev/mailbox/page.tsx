import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { AuthFrame } from "../../signin/auth-frame";

export const metadata: Metadata = { title: "Development outbox" };
export const dynamic = "force-dynamic";

/**
 * Local development outbox for magic links and invitations. Only available in
 * development, only on localhost, and only when no mail provider is configured.
 */
export default async function DevMailbox() {
  const host = (await headers()).get("host")?.split(":")[0] ?? "";
  if (process.env.NODE_ENV === "production" || process.env.AUTH_RESEND_KEY || !["localhost", "127.0.0.1", "[::1]"].includes(host)) notFound();
  const mails = await prisma.devEmail.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return (
    <AuthFrame>
      <h1 className="font-serif text-[36px] leading-[1.05]">Development outbox</h1>
      <p className="mt-2 text-[13.5px] text-ink-2">Emails that would have been sent. Configure AUTH_RESEND_KEY to send real email instead.</p>
      <ul className="mt-6 divide-y divide-border border-y border-border">
        {mails.length === 0 && <li className="py-6 text-[13.5px] text-muted-foreground">No emails yet. Request a sign-in link first.</li>}
        {mails.map((m) => (
          <li key={m.id} className="py-4 text-[13.5px]">
            <div className="font-medium">{m.subject}</div>
            <div className="text-[12px] text-muted-foreground">
              to {m.to} · {m.createdAt.toLocaleString()}
            </div>
            {m.url && (
              <a href={m.url} className="mt-2 inline-block break-all text-[13px] underline underline-offset-4">
                Open link
              </a>
            )}
          </li>
        ))}
      </ul>
    </AuthFrame>
  );
}
