"use client";

import { ArrowClockwise, WarningOctagon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const python = /python|engine|interpreter|ENOENT|spawn/i.test(error.message);
  return (
    <div className="mx-auto max-w-xl py-16">
      <WarningOctagon size={28} weight="thin" className="text-bad" />
      <h1 className="mt-4 font-serif text-[34px] leading-tight">{python ? "The ML engine is not available" : "This page could not load"}</h1>
      <p className="mt-3 break-words text-[14px] leading-relaxed text-ink-2">{error.message || "Unexpected error."}</p>
      {python && (
        <div className="mt-5 space-y-2 text-[13.5px] text-ink-2">
          <p>RetrainWise runs its models in a local Python engine (Python 3.10–3.12). From the project folder run:</p>
          <pre className="rounded-md border border-border bg-subtle px-3 py-2 font-mono text-[12.5px]">npm run setup:python</pre>
          <p>
            Or set <code className="font-mono">RETRAINWISE_PYTHON</code> to an interpreter with <code className="font-mono">engine/requirements.txt</code> installed, then restart{" "}
            <code className="font-mono">npm run dev</code>.
          </p>
        </div>
      )}
      <Button className="mt-8" onClick={reset}>
        <ArrowClockwise size={14} /> Try again
      </Button>
    </div>
  );
}
