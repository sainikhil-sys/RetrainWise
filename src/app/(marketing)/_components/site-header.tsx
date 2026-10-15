"use client";

import { List } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { REPO_URL, SELF_HOST_URL, SITE_ONLY } from "@/lib/site";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/#product", label: "Product" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/research", label: "Research" },
  { href: "/docs", label: "Documentation" },
];

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className={cn("sticky top-0 z-40 border-b bg-background/90 backdrop-blur transition-colors", scrolled ? "border-border" : "border-transparent")}>
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between gap-6 px-4 sm:px-6">
        <Link href="/" className="font-serif text-[23px] leading-none tracking-[-0.01em]">
          RetrainWise
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-[13.5px] md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-ink-2 transition-colors hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          {SITE_ONLY ? (
            <>
              <Button variant="ghost" asChild>
                <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                  GitHub
                </a>
              </Button>
              <Button asChild>
                <Link href={SELF_HOST_URL}>Run it locally</Link>
              </Button>
            </>
          ) : signedIn ? (
            <Button asChild>
              <Link href="/overview">Open app</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link href="/signin">Sign in</Link>
              </Button>
              <Button asChild>
                <Link href="/signin?next=/onboarding">Get started</Link>
              </Button>
            </>
          )}
        </div>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
          <List size={20} />
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full max-w-xs p-0">
          <SheetTitle className="border-b border-border px-5 py-4 font-serif text-[22px] font-normal">RetrainWise</SheetTitle>
          <nav aria-label="Mobile" className="flex flex-col px-5 py-3">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="border-b border-border py-3 text-[15px]">
                {n.label}
              </Link>
            ))}
            {SITE_ONLY ? (
              <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className="border-b border-border py-3 text-[15px]">
                GitHub
              </a>
            ) : (
              <Link href={signedIn ? "/overview" : "/signin"} onClick={() => setOpen(false)} className="border-b border-border py-3 text-[15px]">
                {signedIn ? "Open app" : "Sign in"}
              </Link>
            )}
          </nav>
          {!signedIn && (
            <div className="px-5 pt-2">
              <Button asChild className="w-full">
                <Link href={SITE_ONLY ? SELF_HOST_URL : "/signin?next=/onboarding"} onClick={() => setOpen(false)}>
                  {SITE_ONLY ? "Run it locally" : "Get started"}
                </Link>
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </header>
  );
}
