import { z } from "zod";

import { body, ident, route } from "@/lib/api";
import { pct, reportFor, ver } from "@/lib/report";

export const dynamic = "force-dynamic";

const Batches = z.object({ expectedPosition: z.number().int().min(0), count: z.number().int().min(1).max(50).default(1) });

/** Process the next batch(es). Keyed by stream position: a duplicate click is a no-op. */
export const POST = route<{ id: string }>(
  async (req, { id }, ctx) => {
    const runId = ident.parse(id);
    const { expectedPosition, count } = await body(req, Batches);
    type B = { batch_index: number; start_row: number; end_row: number; version: number; status: string; batch_error: number | null; rolling_error: number | null; evaluation_suggested: boolean; trigger_reasons: string[] };
    const r = await ctx.engine.call<{ noop: boolean; processed: B[]; position: number; error: string | null }>(
      "process_batches",
      { run_id: runId, expected_position: expectedPosition, count, actor: ctx.user.email },
      { timeoutMs: 900_000, dedupeKey: `batches:${runId}` },
    );
    const done = r.processed ?? [];
    if (!r.noop && done.length) {
      const last = done[done.length - 1];
      const flagged = done.some((b) => b.evaluation_suggested);
      reportFor(ctx, {
        kind: "batches_processed",
        title: `${done.length} batch${done.length === 1 ? "" : "es"} processed`,
        summary: flagged
          ? `Monitoring suggests evaluating update options: ${last.trigger_reasons.join("; ") || "evidence threshold reached"}.`
          : `Rows ${done[0].start_row.toLocaleString()}–${last.end_row.toLocaleString()} were predicted, labels revealed and monitors updated. No evaluation is suggested yet.`,
        status: flagged ? { label: "Attention", tone: "warn" } : r.error ? { label: "Partial", tone: "bad" } : { label: "Completed", tone: "ok" },
        facts: [
          ["Batches", `${done[0].batch_index}–${last.batch_index}`],
          ["Rows", `${done[0].start_row.toLocaleString()}–${last.end_row.toLocaleString()}`],
          ["Model", ver(last.version)],
          ["Last batch error", pct(last.batch_error)],
          ["Rolling error", pct(last.rolling_error)],
          ["Monitor status", last.status],
          ...(r.error ? ([["Stopped early", r.error]] as [string, string][]) : []),
        ],
        href: flagged ? "/decisions" : "/monitoring",
        ctaLabel: flagged ? "Evaluate update options" : "Open Monitoring",
      });
    }
    return r;
  },
  { permission: "stream.operate", limit: { max: 120, windowMs: 60_000 } },
);
