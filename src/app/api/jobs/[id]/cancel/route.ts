import { ident, route } from "@/lib/api";
import { engineCall } from "@/lib/engine";

export const dynamic = "force-dynamic";

/** Request cancellation; the worker stops between policy runs and records 'cancelled'. */
export const POST = route<{ id: string }>(async (_req, { id }) => {
  const jobId = ident.parse(id);
  return engineCall("cancel_job", { job_id: jobId }, { timeoutMs: 60_000, dedupeKey: `cancel:${jobId}` });
});
