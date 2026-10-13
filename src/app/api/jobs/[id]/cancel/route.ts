import { ident, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Request cancellation. Training jobs stop before a candidate is registered; benchmarks between runs. */
export const POST = route<{ id: string }>(
  async (_req, { id }, ctx) => {
    const jobId = ident.parse(id);
    return ctx.engine.call("cancel_job", { job_id: jobId, actor: ctx.user.email }, { timeoutMs: 60_000, dedupeKey: `cancel:${jobId}` });
  },
  { permission: "model.train" },
);
