import { Check, Minus } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";

import { Section } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { PERMISSIONS, ROLES, ROLE_HELP, ROLE_LABELS, can, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { WorkspaceForm } from "./_components/workspace-form";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const PERMISSION_TEXT: Partial<Record<Permission, string>> = {
  view: "View monitoring, decisions, models and reports",
  "stream.operate": "Start streams, process batches, evaluate options",
  "stream.configure": "Change batch size, label delay, seed",
  "action.request": "Request an update or a promotion",
  "model.train": "Train and validate candidate models",
  "experiments.run": "Run benchmarks",
  "agent.run": "Generate agent explanations",
  "action.approve": "Approve or reject updates",
  "model.promote": "Promote or reject candidates",
  "model.rollback": "Roll back to an earlier version",
  "jobs.delete": "Delete failed jobs",
  "settings.engine": "Change costs, budgets, guardrails, autonomy",
  "team.manage": "Manage members and roles",
  "workspace.manage": "Change workspace settings",
};

export default async function WorkspaceSettingsPage() {
  const ctx = await requirePage("/settings");
  return (
    <>
      <Section title="Workspace" flush>
        <WorkspaceForm
          initial={{ name: ctx.workspace.name, defaultRegime: ctx.workspace.defaultRegime as "cheap" | "balanced" | "expensive", requireSeparateApprover: ctx.workspace.requireSeparateApprover }}
          canEdit={can(ctx.role, "workspace.manage")}
        />
      </Section>

      <Section title="Roles" description="Permissions are enforced by the server for every request, including requests prepared by the agent. The agent can never approve.">
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <div key={r} className={cn("rounded-md border p-3", r === ctx.role ? "border-foreground" : "border-border")}>
              <div className="text-[13.5px] font-medium">
                {ROLE_LABELS[r]}
                {r === ctx.role && <span className="ml-2 text-[11.5px] font-normal text-muted-foreground">you</span>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{ROLE_HELP[r]}</p>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <caption className="sr-only">Permissions by role</caption>
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Capability</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-2 py-2 text-center font-medium">
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
                <tr key={p} className="border-b border-border/60">
                  <td className="py-1.5 pr-3">{PERMISSION_TEXT[p] ?? p}</td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-1.5 text-center">
                      {can(r, p) ? <Check className="mx-auto size-3.5" aria-label="allowed" /> : <Minus className="mx-auto size-3.5 text-border" aria-label="not allowed" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
