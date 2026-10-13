"use client";

import { RefreshCw, ServerCrash } from "lucide-react";

import { Button } from "@/components/client";
import { Card } from "@/components/ui";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const python = /python|engine|interpreter|ENOENT|spawn/i.test(error.message);
  return (
    <Card className="mx-auto mt-10 max-w-2xl p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose-400/10 ring-1 ring-rose-400/30">
          <ServerCrash aria-hidden className="h-5 w-5 text-rose-300" />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-100">{python ? "The Python engine is not available" : "This page could not be loaded"}</h1>
          <p className="mt-2 break-words text-sm leading-relaxed text-slate-400">{error.message || "Unexpected error."}</p>
          {python && (
            <div className="mt-4 space-y-2 text-sm text-slate-300">
              <p>RetrainWise needs Python 3.10–3.12 with the engine requirements. From the project folder run:</p>
              <pre className="overflow-x-auto rounded-lg bg-navy-950 px-3 py-2 font-mono text-xs text-teal-200">npm run setup:python</pre>
              <p className="text-slate-400">
                Or point <code className="font-mono text-teal-200">RETRAINWISE_PYTHON</code> at an interpreter that has <code className="font-mono">engine/requirements.txt</code> installed, then restart <code className="font-mono">npm run dev</code>.
              </p>
            </div>
          )}
          <Button className="mt-6" variant="primary" icon={RefreshCw} onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}
