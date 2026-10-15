import { DownloadSimple, MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";

import { Reveal } from "@/components/motion";
import { Callout, DataTable, EmptyState, Explainer, PageHeader, Section, Status, Tag } from "@/components/rw";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePage } from "@/lib/authz";
import { ACTION_LABELS } from "@/lib/catalog";
import { describeEvent } from "@/lib/events";
import { when } from "@/lib/format";
import { toUiTone } from "@/lib/narrative";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getActiveRun, getEventActors, getEventKinds, getLatestDecision, getReports, getRequests, getSettings, getToolCalls, searchEvents } from "@/lib/queries";
import { AgentPanel } from "./_components/agent-panel";

export const metadata: Metadata = { title: "Agent & audit" };
export const dynamic = "force-dynamic";

type Search = { q?: string; kind?: string; actor?: string; source?: string };
type Row = { key: string; source: "engine" | "app"; created: string; kind: string; actor: string; text: string; tone: ReturnType<typeof toUiTone> };

const selectClass = "h-8 rounded-md border border-input bg-background px-2.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

const APP_TEXT: Record<string, string> = {
  account_created: "Created an account",
  signed_in: "Signed in",
  signed_out: "Signed out",
  profile_updated: "Updated their profile",
  workspace_created: "Created the workspace",
  workspace_updated: "Updated workspace settings",
  onboarding_completed: "Completed onboarding",
  member_invited: "Invited a member",
  invitation_accepted: "Accepted an invitation",
  invitation_revoked: "Revoked an invitation",
  member_role_changed: "Changed a member's role",
  member_removed: "Removed a member",
  engine_settings_changed: "Changed engine settings",
  engine_settings_reset: "Reset engine settings to defaults",
  dataset_downloaded: "Downloaded a dataset",
  audit_exported: "Exported the audit trail",
  experiment_exported: "Exported experiment results",
  model_report_exported: "Exported a model report",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePage("/audit");
  const ws = ctx.workspace.id;
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 200) || undefined;
  const source = sp.source === "engine" || sp.source === "app" ? sp.source : "all";

  const [settings, run, reports, requests, kinds, actors] = await Promise.all([getSettings(ws), getActiveRun(ws), getReports(ws, 5), getRequests(ws), getEventKinds(ws), getEventActors(ws)]);
  const decision = run ? await getLatestDecision(ws, run.id) : null;
  const calls = await getToolCalls(ws, reports.map((r) => r.id));
  const agentRequests = requests.filter((r) => r.report_id != null).slice(0, 8);

  const [engineEvents, appEvents] = await Promise.all([
    source === "app" ? Promise.resolve([]) : searchEvents(ws, { q, kinds: sp.kind ? [sp.kind] : undefined, actor: sp.actor || undefined, limit: 200 }),
    source === "engine"
      ? Promise.resolve([])
      : prisma.auditLog.findMany({
          where: { workspaceId: ws, ...(sp.kind ? { kind: sp.kind } : {}), ...(sp.actor ? { actorEmail: sp.actor } : {}) },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
  ]);
  const rows: Row[] = [
    ...engineEvents.map((e) => {
      const d = describeEvent(e);
      return { key: `e${e.id}`, source: "engine" as const, created: e.created, kind: e.kind, actor: e.actor, text: d.text, tone: toUiTone(d.tone) };
    }),
    ...appEvents
      .filter((a) => !q || `${a.kind} ${a.actorEmail} ${a.detail}`.toLowerCase().includes(q.toLowerCase()))
      .map((a) => ({ key: `a${a.id}`, source: "app" as const, created: a.createdAt.toISOString(), kind: a.kind, actor: a.actorEmail, text: APP_TEXT[a.kind] ?? a.kind.replace(/_/g, " "), tone: "neutral" as const })),
  ]
    .sort((a, b) => (a.created < b.created ? 1 : -1))
    .slice(0, 200);

  const exportQuery = new URLSearchParams({ ...(q ? { q } : {}), ...(sp.kind ? { kinds: sp.kind } : {}), ...(sp.actor ? { actor: sp.actor } : {}) }).toString();
  const filtered = !!(q || sp.kind || sp.actor || source !== "all");

  return (
    <Reveal>
      <PageHeader
        title="Agent & audit"
        description="An advisory agent explains decisions from stored evidence. Every action, by people or the agent, is written to an append-only audit trail."
      />

      <div className="grid gap-x-12 lg:grid-cols-[1.25fr_1fr]">
        <Section title="Explain a decision" flush>
          <AgentPanel
            decisionId={decision?.id ?? null}
            decisionStatus={decision?.status ?? null}
            settings={settings}
            canRun={can(ctx.role, "agent.run")}
            canConfigure={can(ctx.role, "settings.engine")}
          />
        </Section>
        <Section title="What the agent can do" flush>
          <ul className="space-y-2 text-[13px] leading-relaxed text-ink-2">
            <li>Use an open-source model of your choice (Llama, Qwen, Mistral, Granite) on this computer through Ollama, or hosted through an OpenAI-compatible endpoint, or no model at all.</li>
            <li>Read telemetry, registry history, probe results, pricing assumptions and action evaluations through bounded, read-only tools.</li>
            <li>Prepare an execution request. It goes to approvers like any operator request.</li>
            <li>
              It <b className="text-foreground">cannot</b> execute, approve, promote or roll back. Approval rules apply to it exactly as to an operator.
            </li>
            <li>Every tool call and its result is stored with the report.</li>
          </ul>
        </Section>
      </div>

      {agentRequests.length > 0 && (
        <Section title="Agent-prepared requests">
          <DataTable
            caption="Agent-prepared requests"
            rows={agentRequests}
            rowKey={(r) => r.id}
            columns={[
              { key: "id", header: "Request", cell: (r) => <span className="font-mono">#{r.id}</span> },
              { key: "a", header: "Action", cell: (r) => ACTION_LABELS[r.action] },
              { key: "s", header: "Status", cell: (r) => <Status tone={r.status === "awaiting_approval" ? "info" : r.status === "executed" ? "ok" : r.status === "rejected" ? "bad" : "neutral"}>{r.status.replace("_", " ")}</Status> },
              { key: "r", header: "Rationale", mobile: false, cell: (r) => <span className="text-[12px] text-ink-2">{r.rationale}</span> },
              { key: "o", header: "", cell: (r) => (r.status === "awaiting_approval" ? <Link href="/decisions" className="text-[12.5px] underline underline-offset-4">Review</Link> : null) },
            ]}
          />
        </Section>
      )}

      <Section title="Reports" description="Most recent first. Deterministic reports are built from the same tool evidence without a language model.">
        {reports.length ? (
          <div className="space-y-4">
            {reports.map((r, i) => {
              const tools = calls.filter((c) => c.report_id === r.id);
              return (
                <details key={r.id} open={i === 0} className="group rounded-md border border-border">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="flex items-center gap-2 text-[13.5px]">
                      <span className="font-mono">#{r.id}</span>
                      <Tag>{r.mode}{r.model ? ` · ${r.model}` : ""}</Tag>
                      <Status tone={r.status === "completed" ? "ok" : r.status === "fallback" ? "warn" : r.status === "failed" ? "bad" : "neutral"}>{r.status}</Status>
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {when(r.created)} · decision {r.decision_id ?? "—"} · {tools.length} tool call{tools.length === 1 ? "" : "s"} · {r.duration_seconds.toFixed(1)} s
                    </span>
                  </summary>
                  <div className="border-t border-border px-4 py-4">
                    {r.error && <Callout tone="warn" className="mb-3">{r.error}</Callout>}
                    <div className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{r.report}</div>
                    {tools.length > 0 && (
                      <ol className="mt-4 space-y-1.5 border-t border-border pt-3 font-mono text-[11.5px]">
                        {tools.map((c) => (
                          <li key={c.id}>
                            <span className={c.status === "ok" ? "" : "text-bad"}>{c.tool}</span>
                            <span className="text-muted-foreground">({JSON.stringify(c.arguments)})</span> → {c.status}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No reports yet.</p>
        )}
      </Section>

      <Section
        title="Audit trail"
        description="Engine events (batches, decisions, approvals, training, promotions, rollbacks) and application events (sign-ins, team changes, exports). Neither can be edited or deleted."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/audit/export?format=csv${exportQuery ? `&${exportQuery}` : ""}`}>
                <DownloadSimple /> CSV
              </a>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/audit/export?format=json${exportQuery ? `&${exportQuery}` : ""}`}>
                <DownloadSimple /> JSON
              </a>
            </Button>
          </div>
        }
      >
        <form method="get" className="mb-5 flex flex-wrap items-center gap-2" role="search">
          <div className="relative min-w-52 flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search events" aria-label="Search events" className="pl-8" />
          </div>
          <select name="source" defaultValue={source} aria-label="Source" className={selectClass}>
            <option value="all">All sources</option>
            <option value="engine">Engine</option>
            <option value="app">Application</option>
          </select>
          <select name="kind" defaultValue={sp.kind ?? ""} aria-label="Event kind" className={selectClass}>
            <option value="">All kinds</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.kind} ({k.n})
              </option>
            ))}
            {Object.keys(APP_TEXT).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select name="actor" defaultValue={sp.actor ?? ""} aria-label="Actor" className={selectClass}>
            <option value="">All actors</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
          {filtered && (
            <Link href="/audit" className="text-[12.5px] text-muted-foreground underline-offset-4 hover:underline">
              Clear
            </Link>
          )}
        </form>

        {rows.length ? (
          <DataTable
            caption="Audit events"
            rows={rows}
            rowKey={(r) => r.key}
            columns={[
              { key: "w", header: "When", cell: (r) => <span className="whitespace-nowrap text-[12px] text-muted-foreground">{when(r.created)}</span> },
              { key: "k", header: "Event", cell: (r) => <span className="font-mono text-[12px]">{r.kind}</span> },
              { key: "t", header: "What happened", cell: (r) => <Status tone={r.tone}>{r.text}</Status> },
              { key: "a", header: "Actor", mobile: false, cell: (r) => <span className="text-[12.5px]">{r.actor}</span> },
              { key: "s", header: "Source", mobile: false, cell: (r) => <Tag>{r.source}</Tag> },
            ]}
          />
        ) : (
          <EmptyState title={filtered ? "No events match these filters" : "No events yet"}>{filtered ? "Clear the filters to see everything." : "Events appear as soon as anything happens in this workspace."}</EmptyState>
        )}
        <p className="mt-3 text-[12px] text-muted-foreground">Showing up to 200 events. Exports include up to 5,000 per source.</p>
      </Section>

      <div className="mt-8">
        <Explainer title="Why the trail is trustworthy">
          Engine events live in SQLite with triggers that reject UPDATE and DELETE. Application events live in the app database with the same guard on the audit table. Exports are themselves recorded.
        </Explainer>
      </div>
    </Reveal>
  );
}
