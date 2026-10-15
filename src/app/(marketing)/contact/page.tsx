import { BookOpen, Bug, GithubLogo, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { LandingMotion } from "../_components/landing-motion";
import { ContactForm } from "./contact-form";

export const metadata: Metadata = { title: "Contact", description: "Questions, bug reports, feature requests and security reports for RetrainWise." };
export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const session = await auth();
  return (
    <LandingMotion>
      <section className="relative overflow-hidden">
        <div aria-hidden className="bg-dots mask-fade-y pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-[1200px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:py-24">
          <div data-land>
            <div className="text-[12.5px] font-medium text-muted-foreground">Contact</div>
            <h1 className="mt-3 font-serif text-[44px] leading-[1.02] tracking-[-0.02em] sm:text-[56px]">Talk to us</h1>
            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-2">Questions about the method, a bug, an idea, or a security concern. We read every message and reply by email.</p>
            <ul className="mt-10 space-y-5 text-[14px]">
              {[
                { icon: BookOpen, title: "Documentation", text: "How each screen works, roles, emails and self-hosting.", href: "/docs", external: false },
                { icon: GithubLogo, title: "GitHub", text: "Source code, issues and discussions.", href: "https://github.com/sainikhil-sys/RetrainWise", external: true },
                { icon: Bug, title: "Bug reports", text: "Include the page, what you expected and what happened.", href: "https://github.com/sainikhil-sys/RetrainWise/issues", external: true },
                { icon: ShieldCheck, title: "Security", text: "Choose the Security topic in the form. Please do not open public issues for vulnerabilities.", href: null, external: false },
              ].map((c) => (
                <li key={c.title} className="flex gap-3.5">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                    <c.icon size={17} />
                  </span>
                  <span>
                    {c.href ? (
                      c.external ? (
                        <a href={c.href} target="_blank" rel="noreferrer noopener" className="font-medium underline-offset-4 hover:underline">
                          {c.title}
                        </a>
                      ) : (
                        <Link href={c.href} className="font-medium underline-offset-4 hover:underline">
                          {c.title}
                        </Link>
                      )
                    ) : (
                      <span className="font-medium">{c.title}</span>
                    )}
                    <span className="mt-0.5 block text-ink-2">{c.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div data-land>
            <ContactForm defaultEmail={session?.user?.email ?? undefined} />
          </div>
        </div>
      </section>
    </LandingMotion>
  );
}
