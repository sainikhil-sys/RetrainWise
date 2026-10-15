import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { LandingMotion } from "./landing-motion";

/** Long-form page for docs, research and legal content: header, optional contents rail, prose body. */
export function DocPage({
  eyebrow,
  title,
  intro,
  toc,
  updated,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  intro?: ReactNode;
  toc?: { id: string; label: string }[];
  updated?: string;
  children: ReactNode;
}) {
  return (
    <LandingMotion>
      <header className="relative overflow-hidden border-b border-border">
        <div aria-hidden className="bg-dots mask-fade-y pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:py-20">
          <div className="text-[12.5px] font-medium text-muted-foreground" data-land>
            {eyebrow}
          </div>
          <h1 className="mt-3 max-w-3xl font-serif text-[44px] leading-[1.02] tracking-[-0.02em] sm:text-[60px]" data-land>
            {title}
          </h1>
          {intro && (
            <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-ink-2" data-land>
              {intro}
            </p>
          )}
          {updated && (
            <p className="mt-4 text-[12.5px] text-muted-foreground" data-land>
              Last updated {updated}
            </p>
          )}
        </div>
      </header>
      <div className={cn("mx-auto max-w-[1200px] px-4 py-14 sm:px-6", toc && "lg:grid lg:grid-cols-[220px_1fr] lg:gap-14")}>
        {toc && (
          <nav aria-label="On this page" className="mb-10 lg:mb-0">
            <div className="lg:sticky lg:top-24">
              <div className="mb-3 text-[12px] font-medium text-muted-foreground">On this page</div>
              <ol className="space-y-1.5 border-l border-border text-[13.5px]">
                {toc.map((t) => (
                  <li key={t.id}>
                    <a href={`#${t.id}`} className="-ml-px block border-l border-transparent pl-3 text-ink-2 transition-colors hover:border-foreground hover:text-foreground">
                      {t.label}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          </nav>
        )}
        <article className="doc-prose min-w-0 max-w-3xl">{children}</article>
      </div>
    </LandingMotion>
  );
}

/** A titled section inside a DocPage. */
export function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-border pt-10 first:border-t-0 first:pt-0 [&+&]:mt-12">
      <h2 className="font-serif text-[28px] leading-tight tracking-[-0.01em]">{title}</h2>
      <div className="mt-4 space-y-4 text-[15px] leading-[1.75] text-ink-2">{children}</div>
    </section>
  );
}
