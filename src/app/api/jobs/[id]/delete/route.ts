import { ident, route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Delete a failed, cancelled or interrupted job and its logs (admins). The deletion itself is audited. */
export const POST = route<{ id: string }>(
  async (_req, { id }, ctx) => ctx.engine.call("delete_job", { job_id: ident.parse(id), actor: ctx.user.email }),
  { permission: "jobs.delete" },
);
