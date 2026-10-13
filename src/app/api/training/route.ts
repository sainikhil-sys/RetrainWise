import { z } from "zod";

import { body, route, sizeEnum } from "@/lib/api";
import { DATASETS } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, _p, ctx) => ctx.engine.call("training_options", {}, { timeoutMs: 60_000 }));

const Model = z.object({
  type: z.enum(["sgd_logistic", "sgd_hinge", "sgd_modified_huber", "random_forest"]),
  alpha: z.number().gt(0).max(1).optional(),
  epochs: z.number().int().min(1).max(500).optional(),
  n_estimators: z.number().int().min(1).max(1000).optional(),
  max_depth: z.number().int().min(1).max(100).nullable().optional(),
});
const Prep = z.object({
  numeric_impute: z.enum(["median", "mean", "most_frequent"]),
  scale: z.boolean(),
  max_categories: z.number().int().min(2).max(1000),
});
const Train = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("stream"),
    dataset: z.enum(DATASETS),
    size: sizeEnum,
    target_column: z.string().min(1).max(100),
    initial_window: z.number().int().min(200).max(1_000_000),
    validation_fraction: z.number().min(0.05).max(0.6),
    seed: z.number().int().min(0).max(2_147_483_647),
    model: Model,
    preprocessing: Prep,
    note: z.string().max(300).optional(),
  }),
  z.object({
    scope: z.literal("run"),
    train_window: z.number().int().min(100).max(1_000_000),
    validation_fraction: z.number().min(0.05).max(0.6),
    seed: z.number().int().min(0).max(2_147_483_647),
    model: Model,
    preprocessing: Prep,
    note: z.string().max(300).optional(),
  }),
]);

/**
 * Create a real training job (queued in SQLite, executed by the Python worker).
 * Identical configurations return the already queued/running job.
 */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, z.object({ config: Train, confirmed: z.literal(true, { message: "Confirm the training scope" }) }));
    return ctx.engine.call("submit_training", { config: b.config, actor: ctx.user.email }, { timeoutMs: 120_000, dedupeKey: "submit_training" });
  },
  { permission: "model.train", limit: { max: 10, windowMs: 60_000 } },
);
