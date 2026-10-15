import { z } from "zod";

import { route } from "@/lib/api";
import { pct, reportFor, ver } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Re-score a candidate on withheld chronological data. Changes nothing in production. */
export const POST = route<{ version: string }>(
  async (_req, { version }, ctx) => {
    const v = z.coerce.number().int().positive().parse(version);
    const r = await ctx.engine.call<{ version: number; evaluation?: { metrics?: { accuracy?: number; f1?: number; n?: number } }; gate?: { passed: boolean; checks: { check: string; passed: boolean }[] } }>(
      "revalidate_candidate",
      { version: v, actor: ctx.user.email },
      { timeoutMs: 600_000, dedupeKey: `validate:${v}` },
    );
    const m = r.evaluation?.metrics;
    reportFor(ctx, {
      kind: "candidate_validated",
      title: `Validation ${r.gate?.passed ? "passed" : "did not pass"} for ${ver(v)}`,
      summary: "The candidate and the production model were scored on withheld chronological rows. Production is unchanged.",
      status: r.gate?.passed ? { label: "Passed", tone: "ok" } : { label: "Not passed", tone: "bad" },
      facts: [
        ["Accuracy", pct(m?.accuracy)],
        ["Macro F1", pct(m?.f1)],
        ["Rows evaluated", m?.n != null ? m.n.toLocaleString() : "—"],
        ["Failed checks", r.gate?.checks.filter((c) => !c.passed).map((c) => c.check).join("; ") || "none"],
      ],
      href: `/models/${v}`,
    });
    return r;
  },
  { permission: "model.train" },
);
