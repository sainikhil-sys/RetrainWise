import { Bot, Download, FileText, ScrollText, Stamp, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AgentPanel } from "@/components/agent-panel";
import { Markdown } from "@/components/markdown";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th, inputClass } from "@/components/ui";
import { ACTION_LABELS } from "@/lib/catalog";
import { describeEvent } from "@/lib/events";
import { when } from "@/lib/format";
import { getActiveRun, getApprovals, getCounts, getEventActors, getEventKinds, getEvents, getLatestDecision, getReports, getSettings, getToolCalls } from "@/lib/queries";

export const metadata: Metadata = { title: "Agent & audit" };
export const dynamic = "force-dynamic";

const REPORT_TONE: Record<string, "good" | "warn" | "bad" | "info"> = { completed: "good", completed_with_warning: "warn", fallback: "warn", running: "info" };

function short(value: unknown, n = 160): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function clip(value: unknown, n = 6000): string {
  const s = JSON.stringify(value, null, 2) ?? "";
  return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters; see the JSON export)` : s;
}

export default async function AgentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const kind = typeof sp.kind === "string" && /^[a-z_]{1,60}$/.test(sp.kind) ? sp.kind : "";
  const actor = typeof sp.actor === "string" ? sp.actor.slice(0, 80) : "";
  const [settings, run, reports, approvals, kinds, actors, counts] = await Promise.all([getSettings(), getActiveRun(), getReports(6), getApprovals(30), getEventKinds(), getEventActors(), getCounts()]);
  const [decision, calls, events] = await Promise.all([
    run ? getLatestDecision(run.id) : Promise.resolve(null),
    getToolCalls(reports.map((r) => r.id)),
    getEvents({ limit: 300, kinds: kind ? [kind] : undefined, actor: actor || undefined }),
  ]);
  const exportQuery = new URLSearchParams({ ...(kind ? { kinds: kind } : {}), ...(actor ? { actor } : {}) }).toString();

  return (
    <>
      <PageHeader
        eyebrow="Agent & audit"
        title="Explanations, evidence and the complete audit trail"
        description="The agent explains decisions using bounded, read-only tools over telemetry, the registry, pricing assumptions and evaluations. It cannot execute actions. Every report, tool call, approval and outcome is recorded in SQLite."
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Agent reports" icon={FileText} value={counts.reports} />
        <StatCard label="Tool calls" icon={Wrench} value={counts.toolCalls} info="Each call is stored with its validated arguments, status and result." />
        <StatCard label="Approvals" icon={Stamp} value={counts.approvals} info="At most one approval per decision (enforced by a UNIQUE constraint)." />
        <StatCard label="Audit events" icon={ScrollText} value={counts.events} info="Append-only events table; also mirrored as JSON lines in engine/retrainwise.log." />
      </div>

      <Card className="mb-6">
        <CardHeader title="Explain a decision" icon={Bot} />
        <CardBody>
          <AgentPanel decisionId={decision?.id ?? null} decisionStatus={decision?.status ?? null} defaultMode={settings.agent_mode} defaultModel={settings.ollama_model} />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Reports" icon={FileText} description="Most recent first. LLM reports include the deterministic verified figures and a consistency check against the engine's recommendation." />
        <CardBody className="space-y-4">
          {reports.length === 0 && <EmptyState icon={FileText} title="No reports yet">Generate an explanation above.</EmptyState>}
          {reports.map((r, i) => {
            const rc = calls.filter((c) => c.report_id === r.id);
            return (
              <details key={r.id} open={i === 0} className="group rounded-xl border border-slate-800 bg-slate-900/30">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm marker:hidden">
                  <span className="text-teal-300 transition-transform group-open:rotate-90" aria-hidden>
                    ›
                  </span>
                  <span className="font-medium text-slate-100">Report #{r.id}</span>
                  <Badge tone={r.mode === "ollama" ? "info" : "neutral"}>{r.mode === "ollama" ? `Ollama ${r.model ?? ""}` : "deterministic"}</Badge>
                  <Badge tone={REPORT_TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-slate-500">
                    decision <span className="font-mono">{r.decision_id}</span> · {when(r.created)} · {r.iterations} iteration(s) · {r.duration_seconds.toFixed(1)} s · {rc.length} tool call(s)
                  </span>
                </summary>
                <div className="space-y-4 border-t border-slate-800 px-4 py-4">
                  {r.error && <p className="rounded-lg bg-amber-400/5 px-3 py-2 text-xs text-amber-200">Note: {r.error}</p>}
                  <Markdown text={r.report} />
                  {rc.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Tool evidence</div>
                      <Table caption={`Tool calls for report ${r.id}`}>
                        <thead>
                          <tr>
                            <Th>Tool</Th>
                            <Th>Arguments</Th>
                            <Th>Status</Th>
                            <Th>Result</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {rc.map((c) => (
                            <tr key={c.id}>
                              <Td mono>{c.tool}</Td>
                              <Td mono className="max-w-56 whitespace-normal break-all">{short(c.arguments, 120)}</Td>
                              <Td>
                                <Badge tone={c.status === "ok" ? "good" : "bad"}>{c.status}</Badge>
                              </Td>
                              <Td className="max-w-xl whitespace-normal">
                                <details>
                                  <summary className="cursor-pointer break-all font-mono text-xs text-slate-400">{short(c.result, 140)}</summary>
                                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-navy-950 p-2 font-mono text-[11px] text-slate-300">{clip(c.result)}</pre>
                                </details>
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </div>
              </details>
            );
          })}
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Approvals and execution outcomes" icon={Stamp} />
        <CardBody>
          {approvals.length ? (
            <Table caption="Approvals">
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Decision</Th>
                  <Th>Action</Th>
                  <Th>Approver</Th>
                  <Th>Mode</Th>
                  <Th>Outcome</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.id}</Td>
                    <Td mono>{a.decision_id}</Td>
                    <Td>{ACTION_LABELS[a.action]}</Td>
                    <Td>{a.actor}</Td>
                    <Td>
                      <Badge tone={a.mode === "autonomous" ? "warn" : "neutral"}>{a.mode}</Badge>
                    </Td>
                    <Td>
                      <Badge tone={a.outcome === "promoted" || a.outcome === "deferred" ? "good" : a.outcome ? "bad" : "info"}>{a.outcome ?? "executing"}</Badge>
                    </Td>
                    <Td>{when(a.created)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-slate-400">No approvals yet.</p>
          )}
        </CardBody>
      </Card>

      <Card id="audit">
        <CardHeader
          title="Audit log"
          icon={ScrollText}
          description="Append-only record of everything the system and its users did."
          action={
            <div className="flex gap-2">
              <a href={`/api/audit/export?format=json&${exportQuery}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-800">
                <Download className="h-3.5 w-3.5" aria-hidden /> JSON
              </a>
              <a href={`/api/audit/export?format=csv&${exportQuery}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-slate-200 ring-1 ring-inset ring-slate-700 hover:bg-slate-800">
                <Download className="h-3.5 w-3.5" aria-hidden /> CSV
              </a>
            </div>
          }
        />
        <CardBody className="space-y-4">
          <form method="get" action="/agent#audit" className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-slate-400">
              Event kind
              <select name="kind" defaultValue={kind} className={`${inputClass} mt-1 w-60`}>
                <option value="">All kinds</option>
                {kinds.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.kind} ({k.n})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Actor
              <select name="actor" defaultValue={actor} className={`${inputClass} mt-1 w-52`}>
                <option value="">All actors</option>
                {actors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="h-10 rounded-lg bg-slate-800 px-4 text-sm font-medium text-slate-100 ring-1 ring-inset ring-slate-700 hover:bg-slate-700">
              Filter
            </button>
            {(kind || actor) && (
              <Link href="/agent#audit" className="h-10 px-2 text-sm leading-10 text-teal-300 hover:underline">
                Clear
              </Link>
            )}
            <span className="ml-auto text-xs text-slate-500">Showing {events.length} most recent matching event(s)</span>
          </form>
          <Table caption="Audit log">
            <thead>
              <tr>
                <Th>#</Th>
                <Th>When</Th>
                <Th>Kind</Th>
                <Th>Actor</Th>
                <Th>Run</Th>
                <Th>Summary</Th>
                <Th>Payload</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <Td className="text-slate-500">{e.id}</Td>
                  <Td className="whitespace-nowrap">{when(e.created)}</Td>
                  <Td mono>{e.kind}</Td>
                  <Td>{e.actor}</Td>
                  <Td mono>{e.run_id ?? "—"}</Td>
                  <Td className="min-w-72 whitespace-normal">{describeEvent(e).text}</Td>
                  <Td className="max-w-md whitespace-normal">
                    <details>
                      <summary className="cursor-pointer font-mono text-xs text-slate-500">{short(e.payload, 60)}</summary>
                      <pre className="mt-2 max-h-56 overflow-auto rounded bg-navy-950 p-2 font-mono text-[11px] text-slate-300">{clip(e.payload)}</pre>
                    </details>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
