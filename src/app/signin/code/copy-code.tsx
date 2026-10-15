"use client";

import { Check, Copy } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyCode() {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const value = decodeURIComponent(window.location.hash.slice(1)).replace(/\D/g, "").slice(0, 6);
    setCode(value.length === 6 ? value : "");
    // Keep the code out of browser history once it has been read.
    history.replaceState(null, "", window.location.pathname);
  }, []);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Older browsers: select the code so the user can copy it themselves.
      const el = document.getElementById("signin-code");
      if (el) window.getSelection()?.selectAllChildren(el);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  if (code === null) return null;
  if (!code) {
    return (
      <>
        <h1 className="font-serif text-[36px] leading-[1.05]">No code here</h1>
        <p className="mb-8 mt-3 text-[14px] leading-relaxed text-ink-2">Open this page from the Copy code button in your sign-in email, or request a new code.</p>
        <Button asChild size="lg" className="w-full">
          <Link href="/signin">Go to sign in</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <h1 className="font-serif text-[36px] leading-[1.05]">Your sign-in code</h1>
      <p className="mb-8 mt-3 text-[14px] leading-relaxed text-ink-2">Copy it and paste it on the sign-in page, or continue and it is filled in for you.</p>
      <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 py-3 pl-5 pr-3">
        <span id="signin-code" className="select-all font-mono text-[30px] font-semibold tracking-[0.28em]">
          {code}
        </span>
        <Button type="button" variant="secondary" onClick={copy} aria-live="polite">
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <Button asChild size="lg" className="mt-5 w-full">
        <Link href={`/signin/verify#code=${code}`}>Continue to sign in</Link>
      </Button>
      <p className="mt-6 text-[12px] leading-relaxed text-muted-foreground">
        The code works once and only in the browser where you requested it. Never share it with anyone.
      </p>
    </>
  );
}
