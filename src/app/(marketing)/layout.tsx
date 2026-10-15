import Link from "next/link";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { SITE_ONLY } from "@/lib/site";
import { SiteHeader } from "./_components/site-header";

const FOOTER = [
  {
    title: "Product",
    links: [
      { href: "/#product", label: "Overview" },
      { href: "/#how-it-works", label: "How it works" },
      { href: SITE_ONLY ? "/docs#self-host" : "/signin?next=/onboarding", label: SITE_ONLY ? "Install" : "Get started" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/research", label: "Research" },
      { href: "https://github.com/sainikhil-sys/RetrainWise", label: "GitHub", external: true },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
];

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const session = SITE_ONLY ? null : await auth();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-foreground focus:px-3 focus:py-1.5 focus:text-background">
        Skip to content
      </a>
      <SiteHeader signedIn={!!session?.user} />
      <main id="main">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="font-serif text-[24px] leading-none">RetrainWise</div>
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-muted-foreground">Cost-aware decisions about when to retrain a model. Runs on your own machine.</p>
          </div>
          {FOOTER.map((c) => (
            <div key={c.title}>
              <div className="text-[12px] font-medium text-muted-foreground">{c.title}</div>
              <ul className="mt-3 space-y-2 text-[13.5px]">
                {c.links.map((l) => (
                  <li key={l.href}>
                    {"external" in l ? (
                      <a href={l.href} target="_blank" rel="noreferrer noopener" className="hover:underline hover:underline-offset-4">
                        {l.label}
                      </a>
                    ) : (
                      <Link href={l.href} className="hover:underline hover:underline-offset-4">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 border-t border-border px-4 py-5 text-[12px] text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} RetrainWise</span>
          <span>Costs shown in the product are simulated unless you supply your own.</span>
        </div>
      </footer>
    </div>
  );
}
