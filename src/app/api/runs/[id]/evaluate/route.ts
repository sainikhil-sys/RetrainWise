import { ident, route } from "@/lib/api";
import { ACTION_LABELS } from "@/lib/catalog";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Probe evidence + shadow evaluation of candidates; ranks keep / partial / full. */
export const POST = route<{ id: string }>(
  async (_req, { id }, ctx) => {
    const runId = ident.parse(id);
    const r = await ctx.engine.call<{ id: string; recommended: keyof typeof ACTION_LABELS; charged: boolean; note: string | null }>(
      "evaluate",
      { run_id: runId, actor: ctx.user.email },
      { timeoutMs: 600_000, dedupeKey: `evaluate:${runId}` },
    );
    if (r.recommended !== "defer") {
      await notify({
        workspaceId: ctx.workspace.id,
        kind: "decision",
        title: `${ACTION_LABELS[r.recommended]} recommended`,
        body: `Decision ${r.id} needs review before any update.`,
        href: "/decisions",
        dedupeKey: `decision:${r.id}`,
      });
    }
    return r;
  },
  { permission: "stream.operate" },
);
