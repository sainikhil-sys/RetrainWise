import Link from "next/link";
import type { ReactNode } from "react";

/** Minimal frame for authentication pages: wordmark, centered column, quiet footer. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="flex h-14 items-center border-b border-border px-6">
        <Link href="/" className="font-serif text-[22px] tracking-[-0.01em]">
          RetrainWise
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-6 pt-[12vh]">
        <div className="w-full max-w-[380px]">{children}</div>
      </main>
      <footer className="flex flex-wrap justify-center gap-4 px-6 py-6 text-[12px] text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-foreground">
          Terms
        </Link>
        <Link href="/docs" className="hover:text-foreground">
          Documentation
        </Link>
      </footer>
    </div>
  );
}
