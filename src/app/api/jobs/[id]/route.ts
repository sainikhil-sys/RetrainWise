import { z } from "zod";

import { ident, route } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { getJob, getJobLogs } from "@/lib/queries";
import { reportFinishedJobs } from "@/lib/report-jobs";

export const dynamic = "force-dynamic";

/** One job with its worker log lines (incremental with ?after=<log id>). */
export const GET = route<{ id: string }>(async (req, { id }, ctx) => {
  const jobId = ident.parse(id);
  const after = z.coerce.number().int().min(0).default(0).parse(req.nextUrl.searchParams.get("after") ?? undefined);
  const job = await getJob(ctx.workspace.id, jobId);
  if (!job) throw new AuthError(404, "Unknown job");
  void reportFinishedJobs(ctx.workspace.id, [job]).catch(() => undefined);
  return { job, logs: await getJobLogs(ctx.workspace.id, jobId, after) };
});
