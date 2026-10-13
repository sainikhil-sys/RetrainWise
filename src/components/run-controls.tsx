"use client";

import { Play, Rocket, Scale, SkipForward } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ACTION_LABELS } from "@/lib/catalog";
import { Button, inputClass, useAction } from "./client";
import { cn } from "./ui";

type BatchResult = {
  noop: boolean;
  message?: string;
  processed: { batch_index: number; end_row: number; status: string; batch_error: number | null; evaluation_suggested: boolean }[];
  autonomy: { batch_index: number; acted: boolean; reason?: string; status?: string; outcome?: string }[];
  error: string | null;
};

/** Process the next N batches. Keyed by stream position so duplicate clicks are no-ops. */
export function ProcessBatches({ runId, position, nRows, batchSize, compact }: { runId: string; position: number; nRows: number; batchSize: number; compact?: boolean }) {
  const [count, setCount] = useState(1);
  const { run, pending } = useAction();
  const remaining = Math.max(0, nRows - position);
  const maxBatches = Math.max(1, Math.min(50, Math.ceil(remaining / batchSize)));
  if (remaining <= 0) {
    return <p className="text-sm text-emerald-300">End of stream reached. Start a new run in Data & simulation to continue.</p>;
  }
  const go = (n: number) =>
    run<BatchResult>(
      `/api/runs/${runId}/batches`,
      { expectedPosition: position, count: n },
      {
        success: (r) => (r.noop ? "Nothing to do" : `Processed ${r.processed.length} batch${r.processed.length === 1 ? "" : "es"}`),
        successBody: (r) => {
          if (r.noop) return r.message;
          const last = r.processed[r.processed.length - 1];
          const acted = r.autonomy.filter((a) => a.acted);
          const parts = [
            last && `Now at row ${last.end_row.toLocaleString()} · status: ${last.status}`,
            last?.evaluation_suggested && "Monitoring suggests evaluating update options.",
            acted.length > 0 && `Bounded autonomy acted ${acted.length}× (${acted.map((a) => a.status).join(", ")}).`,
            r.error && `Stopped early: ${r.error}`,
          ];
          return parts.filter(Boolean).join(" ");
        },
        failure: "Batch processing failed",
      },
    );
  return (
    <div className={cn("flex flex-wrap items-end gap-3", compact && "gap-2")}>
      {!compact && (
        <div>
          <label htmlFor={`count-${runId}`} className="mb-1.5 block text-xs font-medium text-slate-400">
            Batches to process
          </label>
          <input
            id={`count-${runId}`}
            type="number"
            min={1}
            max={maxBatches}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(maxBatches, Number(e.target.value) || 1)))}
            className={cn(inputClass, "w-28")}
          />
        </div>
      )}
      <Button variant="primary" icon={Play} loading={pending} onClick={() => go(compact ? 1 : count)}>
        {pending ? "Processing…" : compact ? "Process next batch" : `Process ${count} batch${count === 1 ? "" : "es"}`}
      </Button>
      {!compact && maxBatches > 1 && (
        <Button variant="ghost" icon={SkipForward} disabled={pending} onClick={() => go(Math.min(10, maxBatches))}>
          Next {Math.min(10, maxBatches)}
        </Button>
      )}
    </div>
  );
}

export function EvaluateButton({ runId, disabled, label = "Evaluate update options" }: { runId: string; disabled?: boolean; label?: string }) {
  const { run, pending } = useAction();
  const router = useRouter();
  return (
    <Button
      variant="primary"
      icon={Scale}
      loading={pending}
      disabled={disabled}
      onClick={async () => {
        const r = await run<{ id: string; recommended: keyof typeof ACTION_LABELS; charged: boolean; note: string | null }>(
          `/api/runs/${runId}/evaluate`,
          {},
          {
            success: (r) => `Recommendation: ${ACTION_LABELS[r.recommended]}`,
            successBody: (r) => (r.charged ? `Decision ${r.id} stored. Shadow-evaluation overhead was charged once.` : `Decision ${r.id}: no candidates trained (${r.note}).`),
            failure: "Evaluation failed",
          },
        );
        if (r) router.push("/decisions");
      }}
    >
      {pending ? "Training and scoring candidates…" : label}
    </Button>
  );
}

export function StartDemoButton({ seed }: { seed: number }) {
  const { run, pending } = useAction();
  return (
    <Button
      variant="primary"
      icon={Rocket}
      loading={pending}
      onClick={() =>
        run<{ id: string; rows: number; active_version: number }>(
          "/api/runs",
          { dataset: "synthetic", size: "standard", seed },
          {
            success: (r) => `Run ${r.id} started`,
            successBody: (r) => `${r.rows.toLocaleString()} synthetic rows; initial model v${String(r.active_version).padStart(3, "0")} trained. Process a few batches next.`,
            failure: "Could not start the demo",
          },
        )
      }
    >
      {pending ? "Generating stream and training the first model…" : "Start offline demo (synthetic stream)"}
    </Button>
  );
}
