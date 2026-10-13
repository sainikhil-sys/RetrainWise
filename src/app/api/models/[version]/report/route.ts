import { z } from "zod";

import { route } from "@/lib/api";
import { AuthError } from "@/lib/authz";
import { audit } from "@/lib/audit";
import { getModel, getModelEvents } from "@/lib/queries";

export const dynamic = "force-dynamic";

function cell(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

/** Model report export. Numbers keep their full stored precision (no rounding). */
export const GET = route<{ version: string }>(async (req, { version }, ctx) => {
  const v = z.coerce.number().int().positive().parse(version);
  const format = z.enum(["json", "csv"]).default("json").parse(req.nextUrl.searchParams.get("format") ?? undefined);
  const model = await getModel(ctx.workspace.id, v);
  if (!model) throw new AuthError(404, "Unknown model version");
  const events = await getModelEvents(ctx.workspace.id, v);
  await audit({ kind: "model_report_exported", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { version: v, format } });
  const name = `retrainwise_model_v${String(v).padStart(3, "0")}`;
  if (format === "json") {
    return new Response(JSON.stringify({ model, events }, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}.json"` },
    });
  }
  const m = model.metadata;
  const metrics = m.evaluation?.metrics;
  const rows: [string, unknown][] = [
    ["version", model.version],
    ["status", model.status],
    ["action", model.action],
    ["parent_version", model.parent_version],
    ["created", model.created],
    ["created_by", m.created_by ?? m.approved_by ?? ""],
    ["artifact", model.artifact],
    ["sha256", model.sha256],
    ["train_start", model.train_start],
    ["train_end", model.train_end],
    ["n_train", model.n_train],
    ["seed", model.seed],
    ["dataset", m.dataset ?? m.config?.dataset ?? ""],
    ["dataset_sha256", m.evaluation?.dataset_sha256 ?? ""],
    ["config", m.config ?? m.model?.hyperparameters ?? {}],
    ["validation_interval", m.evaluation?.validation_interval ?? ""],
    ["n_validation", m.evaluation?.n_validation ?? ""],
    ["feature_count", m.evaluation?.feature_count ?? ""],
    ["training_seconds", m.evaluation?.training_seconds ?? ""],
    ["validation_seconds", m.evaluation?.validation_seconds ?? ""],
    ...(metrics
      ? ([
          ["accuracy", metrics.accuracy],
          ["error_rate", metrics.error_rate],
          ["precision_macro", metrics.precision],
          ["recall_macro", metrics.recall],
          ["f1_macro", metrics.f1],
          ["confusion_matrix_labels", metrics.labels],
          ["confusion_matrix", metrics.confusion_matrix],
          ...metrics.per_class.flatMap((c): [string, unknown][] => [
            [`class_${c.label}_precision`, c.precision],
            [`class_${c.label}_recall`, c.recall],
            [`class_${c.label}_f1`, c.f1],
            [`class_${c.label}_support`, c.support],
          ]),
        ] as [string, unknown][])
      : ([["reference_error", m.reference_error ?? ""]] as [string, unknown][])),
    ["parent_accuracy_change", m.evaluation?.parent?.accuracy_change ?? ""],
    ["gate_passed", m.gate?.passed ?? m.validation?.passed ?? ""],
  ];
  const csv = ["field,value", ...rows.map(([k, val]) => `${cell(k)},${cell(typeof val === "number" ? String(val) : val)}`)].join("\n");
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"` } });
});
