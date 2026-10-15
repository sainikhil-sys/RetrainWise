"use client";

import { ArrowRight, Play, Scales, Sparkle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";

import { Spinner, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { ACTION_LABELS } from "@/lib/catalog";

type BatchResult = {
  noop: boolean;
  message?: string;
  processed: { batch_index: number; end_row: number; status: string; evaluation_suggested: boolean }[];
  autonomy: { acted: boolean; status?: string }[];
  error: string | null;
};

/** Process the next batch(es). Requests carry the expected stream position, so repeats are no-ops. */
export function ProcessBatchButton({ runId, position, count = 1, variant = "default", label }: { runId: string; position: number; count?: number; variant?: "default" | "secondary" | "outline"; label?: string }) {
  const { run, busy } = useAction();
  return (
    <Button
      variant={variant}
      disabled={busy}
      onClick={() =>
        run<BatchResult>(`/api/runs/${runId}/batches`, { expectedPosition: position, count }, {
          success: (r) => (r.noop ? "Already processed" : `Processed ${r.processed.length} batch${r.processed.length === 1 ? "" : "es"}`),
          description: (r) => {
            if (r.noop) return r.message;
            const last = r.processed.at(-1);
            const acted = r.autonomy.filter((a) => a.acted).length;
            return [last && `Now at row ${last.end_row.toLocaleString()} · ${last.status}`, last?.evaluation_suggested && "Evidence suggests evaluating update options.", acted && `Bounded autonomy acted ${acted}×.`, r.error && `Stopped early: ${r.error}`]
              .filter(Boolean)
              .join(" ");
          },
          failure: "Batch not processed",
        })
      }
    >
      {busy ? <Spinner /> : <Play weight="fill" />}
      {label ?? (count === 1 ? "Process next batch" : `Process ${count} batches`)}
    </Button>
  );
}

export function EvaluateButton({ runId, variant = "default", label = "Evaluate update options" }: { runId: string; variant?: "default" | "secondary" | "outline"; label?: string }) {
  const { run, busy } = useAction();
  const router = useRouter();
  return (
    <Button
      variant={variant}
      disabled={busy}
      onClick={async () => {
        const r = await run<{ id: string; recommended: keyof typeof ACTION_LABELS; charged: boolean; note: string | null }>(`/api/runs/${runId}/evaluate`, {}, {
          success: (r) => (r.recommended === "defer" ? "No action recommended" : `${ACTION_LABELS[r.recommended]} recommended`),
          description: (r) => (r.charged ? `Decision ${r.id}. Review it before approving an update.` : `Decision ${r.id}: ${r.note}`),
          failure: "Evaluation failed",
        });
        if (r) router.push("/decisions");
      }}
    >
      {busy ? <Spinner /> : <Scales />}
      {busy ? "Scoring candidates on withheld data…" : label}
    </Button>
  );
}

export function StartDemoButton({ seed = 42, regime }: { seed?: number; regime?: string }) {
  const { run, busy } = useAction();
  return (
    <Button
      disabled={busy}
      onClick={() =>
        run<{ id: string; rows: number; active_version: number }>("/api/runs", { dataset: "synthetic", size: "standard", seed, regime }, {
          success: (r) => `Run ${r.id} started`,
          description: (r) => `${r.rows.toLocaleString()} synthetic rows. Model v${String(r.active_version).padStart(3, "0")} trained on the initial window.`,
          failure: "Stream not started",
        })
      }
    >
      {busy ? <Spinner /> : <Sparkle />}
      {busy ? "Generating stream and training…" : "Start demo stream"}
    </Button>
  );
}

export function LinkButton({ href, children, variant = "default" }: { href: string; children: React.ReactNode; variant?: "default" | "secondary" | "outline" | "ghost" }) {
  const router = useRouter();
  return (
    <Button variant={variant} onClick={() => router.push(href)}>
      {children}
      <ArrowRight />
    </Button>
  );
}
