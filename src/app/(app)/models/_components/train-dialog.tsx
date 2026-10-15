"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Brain } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Callout, KV } from "@/components/rw";
import { Spinner, api, useAction } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DATASET_INFO, SIZES, type DatasetName, type SizeName } from "@/lib/catalog";

export type TrainingOptions = {
  model_types: Record<string, { label: string; incremental: boolean }>;
  preprocessing: { numeric_impute: string; scale: boolean; max_categories: number };
  impute: string[];
  defaults: { seed: number; initial_window: number; train_window: number; validation_fraction: number; alpha: number; epochs: number };
  active_run: { id: string; dataset: string; size: string; active_version: number | null; position: number } | null;
};

const MODEL_TYPES = ["sgd_logistic", "sgd_hinge", "sgd_modified_huber", "random_forest"] as const;
const int = (min: number, max: number, what: string) => z.number({ message: `Enter ${what}` }).int(`${what} must be a whole number`).min(min, `At least ${min}`).max(max, `At most ${max.toLocaleString()}`);

const Schema = z
  .object({
    scope: z.enum(["stream", "run"]),
    dataset: z.string(),
    size: z.enum(["small", "standard", "full"]),
    target_column: z.string().min(1, "Choose the target column"),
    initial_window: int(200, 1_000_000, "the initial window"),
    train_window: int(100, 1_000_000, "the training window"),
    validation_fraction: z.number({ message: "Enter a fraction" }).min(0.05, "At least 0.05").max(0.6, "At most 0.6"),
    seed: int(0, 2_147_483_647, "a seed"),
    type: z.enum(MODEL_TYPES),
    alpha: z.number({ message: "Enter alpha" }).gt(0, "Must be above 0").max(1, "At most 1"),
    epochs: int(1, 500, "epochs"),
    n_estimators: int(1, 1000, "the number of trees"),
    max_depth: z.number().int().min(1).max(100).nullable(),
    numeric_impute: z.enum(["median", "mean", "most_frequent"]),
    scale: z.boolean(),
    max_categories: int(2, 1000, "max categories"),
    note: z.string().max(300),
  })
  .strict();
type Form = z.infer<typeof Schema>;

function Field({ id, label, error, help, children }: { id: string; label: string; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px]">
        {label}
      </Label>
      {children}
      {error ? <p className="text-[12px] text-bad">{error}</p> : help ? <p className="text-[12px] text-muted-foreground">{help}</p> : null}
    </div>
  );
}

export function TrainDialog({ options, datasets, activeVersion }: { options: TrainingOptions; datasets: { name: DatasetName; cached: boolean }[]; activeVersion: number | null }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"configure" | "review">("configure");
  const [confirmed, setConfirmed] = useState(false);
  const [columns, setColumns] = useState<string[]>(["target"]);
  const act = useAction();
  const d = options.defaults;
  const run = options.active_run;

  const form = useForm<Form>({
    resolver: zodResolver(Schema),
    mode: "onChange",
    defaultValues: {
      scope: run ? "run" : "stream",
      dataset: run?.dataset ?? datasets.find((x) => x.cached)?.name ?? "synthetic",
      size: (run?.size as SizeName) ?? "standard",
      target_column: "target",
      initial_window: d.initial_window,
      train_window: d.train_window,
      validation_fraction: d.validation_fraction,
      seed: d.seed,
      type: "sgd_logistic",
      alpha: d.alpha,
      epochs: d.epochs,
      n_estimators: 100,
      max_depth: null,
      numeric_impute: options.preprocessing.numeric_impute as Form["numeric_impute"],
      scale: options.preprocessing.scale,
      max_categories: options.preprocessing.max_categories,
      note: "",
    },
  });
  const { register, control, watch, formState, handleSubmit, reset } = form;
  const errors = formState.errors;
  const values = watch();
  const isForest = values.type === "random_forest";
  const cached = datasets.find((x) => x.name === values.dataset)?.cached ?? false;

  useEffect(() => {
    if (!open || values.scope !== "stream" || !cached) return;
    const ctrl = new AbortController();
    api<{ schema: { column: string; role: string }[] }>(`/api/datasets/${values.dataset}/preview?size=small&seed=${d.seed}`, { signal: ctrl.signal })
      .then((p) => setColumns(p.schema.filter((c) => c.role === "target" || c.role === "categorical").map((c) => c.column).sort((a, b) => (a === "target" ? -1 : b === "target" ? 1 : a.localeCompare(b)))))
      .catch(() => setColumns(["target"]));
    return () => ctrl.abort();
  }, [open, values.scope, values.dataset, cached, d.seed]);

  function close(o: boolean) {
    if (act.pending) return;
    setOpen(o);
    if (!o) {
      setStep("configure");
      setConfirmed(false);
    }
  }

  function payload(f: Form) {
    const model = isForest ? { type: f.type, n_estimators: f.n_estimators, max_depth: f.max_depth } : { type: f.type, alpha: f.alpha, epochs: f.epochs };
    const preprocessing = { numeric_impute: f.numeric_impute, scale: f.scale, max_categories: f.max_categories };
    const common = { validation_fraction: f.validation_fraction, seed: f.seed, model, preprocessing, ...(f.note.trim() ? { note: f.note.trim() } : {}) };
    return f.scope === "run"
      ? { scope: "run" as const, train_window: f.train_window, ...common }
      : { scope: "stream" as const, dataset: f.dataset, size: f.size, target_column: f.target_column, initial_window: f.initial_window, ...common };
  }

  async function submit(f: Form) {
    const r = await act.run<{ job_id: string; created: boolean }>(
      "/api/training",
      { config: payload(f), confirmed: true },
      {
        success: (r) => (r.created ? "Training job queued" : "Already queued or running"),
        description: (r) => (r.created ? `Job ${r.job_id}. Progress and logs stream on this page.` : `Job ${r.job_id} has the same configuration; showing it instead of starting a duplicate.`),
        failure: "Could not start training",
      },
    );
    if (r) {
      close(false);
      reset(f);
    }
  }

  const trainRows = values.scope === "run" ? values.train_window : values.initial_window;
  const valRows = Math.round((trainRows || 0) * (values.validation_fraction || 0));

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Brain />
        Train model
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-[28px] font-normal">{step === "configure" ? "Train a model" : "Confirm training scope"}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {step === "configure"
                ? "Real training on this computer. The result is a candidate: it is validated on withheld chronological rows and only reaches production after approval."
                : "Check the scope. Training starts in the background once you confirm."}
            </DialogDescription>
          </DialogHeader>

          {step === "configure" ? (
            <form id="train-form" className="space-y-6" onSubmit={handleSubmit(() => setStep("review"))}>
              <fieldset className="space-y-3">
                <legend className="mb-2 text-[12px] font-medium text-muted-foreground">Data</legend>
                <Controller
                  control={control}
                  name="scope"
                  render={({ field }) => (
                    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Training data">
                      {(
                        [
                          ["run", "Active stream", run ? `Rows seen so far in run ${run.id}` : "No active stream", !run],
                          ["stream", "Dataset window", "The first rows of a dataset, in source order", false],
                        ] as const
                      ).map(([val, title, text, disabled]) => (
                        <button
                          key={val}
                          type="button"
                          role="radio"
                          aria-checked={field.value === val}
                          disabled={disabled}
                          onClick={() => field.onChange(val)}
                          className={`rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${field.value === val ? "border-foreground bg-subtle" : "border-border hover:bg-subtle/60"}`}
                        >
                          <span className="block text-[13.5px] font-medium">{title}</span>
                          <span className="block text-[12px] text-muted-foreground">{text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                />
                {values.scope === "stream" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="t-dataset" label="Dataset" error={!cached ? "Not downloaded. Download it in Data & streams first." : undefined}>
                      <Controller
                        control={control}
                        name="dataset"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="t-dataset" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {datasets.map((x) => (
                                <SelectItem key={x.name} value={x.name}>
                                  {DATASET_INFO[x.name].title}
                                  {!x.cached && " (not downloaded)"}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field id="t-size" label="Sample size">
                      <Controller
                        control={control}
                        name="size"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="t-size" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(Object.keys(SIZES) as SizeName[]).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s === "full" ? "Full · all rows" : `${s[0].toUpperCase() + s.slice(1)} · first ${SIZES[s]!.toLocaleString()} rows`}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field id="t-target" label="Target column" error={errors.target_column?.message}>
                      <Controller
                        control={control}
                        name="target_column"
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id="t-target" className="w-full font-mono text-[12.5px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {columns.map((c) => (
                                <SelectItem key={c} value={c} className="font-mono text-[12.5px]">
                                  {c}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field id="t-initial" label="Initial window (rows)" error={errors.initial_window?.message} help="Rows used for training and validation, from the start.">
                      <Input id="t-initial" type="number" {...register("initial_window", { valueAsNumber: true })} />
                    </Field>
                  </div>
                ) : (
                  <Field id="t-window" label="Training window (rows)" error={errors.train_window?.message} help={run ? `Most recent labelled rows before row ${run.position.toLocaleString()}.` : undefined}>
                    <Input id="t-window" type="number" {...register("train_window", { valueAsNumber: true })} />
                  </Field>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="t-val" label="Validation split" error={errors.validation_fraction?.message} help="Newest share of the window, withheld for chronological validation.">
                    <Input id="t-val" type="number" step="0.01" {...register("validation_fraction", { valueAsNumber: true })} />
                  </Field>
                  <Field id="t-seed" label="Random seed" error={errors.seed?.message}>
                    <Input id="t-seed" type="number" {...register("seed", { valueAsNumber: true })} />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-[12px] font-medium text-muted-foreground">Model</legend>
                <Field id="t-type" label="Model type">
                  <Controller
                    control={control}
                    name="type"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="t-type" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MODEL_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {options.model_types[t]?.label ?? t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                {isForest ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="t-trees" label="Trees" error={errors.n_estimators?.message}>
                      <Input id="t-trees" type="number" {...register("n_estimators", { valueAsNumber: true })} />
                    </Field>
                    <Field id="t-depth" label="Max depth" help="Empty for unlimited." error={errors.max_depth?.message}>
                      <Input id="t-depth" type="number" {...register("max_depth", { setValueAs: (x) => (x === "" || x == null ? null : Number(x)) })} />
                    </Field>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="t-alpha" label="Regularisation (alpha)" error={errors.alpha?.message}>
                      <Input id="t-alpha" type="number" step="any" {...register("alpha", { valueAsNumber: true })} />
                    </Field>
                    <Field id="t-epochs" label="Epochs" error={errors.epochs?.message}>
                      <Input id="t-epochs" type="number" {...register("epochs", { valueAsNumber: true })} />
                    </Field>
                  </div>
                )}
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-[12px] font-medium text-muted-foreground">Preprocessing</legend>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field id="t-impute" label="Numeric imputation">
                    <Controller
                      control={control}
                      name="numeric_impute"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id="t-impute" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {options.impute.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s.replace("_", " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </Field>
                  <Field id="t-maxcat" label="Max categories" error={errors.max_categories?.message}>
                    <Input id="t-maxcat" type="number" {...register("max_categories", { valueAsNumber: true })} />
                  </Field>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-scale" className="text-[13px]">
                      Standardise numerics
                    </Label>
                    <Controller control={control} name="scale" render={({ field }) => <Switch id="t-scale" checked={field.value} onCheckedChange={field.onChange} className="mt-1.5" />} />
                  </div>
                </div>
              </fieldset>

              <Field id="t-note" label="Note (optional)" error={errors.note?.message}>
                <Textarea id="t-note" rows={2} maxLength={300} {...register("note")} />
              </Field>
            </form>
          ) : (
            <div className="space-y-4">
              <KV
                items={[
                  ["Data", values.scope === "run" ? `Active stream ${run?.id}: last ${values.train_window.toLocaleString()} labelled rows` : `${DATASET_INFO[values.dataset as DatasetName].title} · ${values.size} · first ${values.initial_window.toLocaleString()} rows`],
                  ["Training rows (approx.)", (trainRows - valRows).toLocaleString()],
                  ["Withheld for validation", `${valRows.toLocaleString()} newest rows (${Math.round(values.validation_fraction * 100)}%)`],
                  ["Model", `${options.model_types[values.type]?.label} · ${isForest ? `${values.n_estimators} trees, depth ${values.max_depth ?? "unlimited"}` : `alpha ${values.alpha}, ${values.epochs} epochs`}`],
                  ["Preprocessing", `${values.numeric_impute.replace("_", " ")} imputation · ${values.scale ? "standardised" : "unscaled"} · max ${values.max_categories} categories`],
                  ["Seed", String(values.seed)],
                  ["Compared with", activeVersion ? `production model v${String(activeVersion).padStart(3, "0")}` : "no production model"],
                ]}
              />
              <Callout title="What happens next">
                <b>Train</b> fits the model on the training rows. <b>Validate</b> scores it on the withheld chronological rows it never saw. The result is registered as a <b>candidate</b>. <b>Promote</b> changes production only after an approver accepts it.
              </Callout>
              <label className="flex items-start gap-2.5 text-[13px]">
                <Checkbox checked={confirmed} onCheckedChange={(c) => setConfirmed(c === true)} className="mt-0.5" />I understand this runs real training on this computer and creates a candidate model. Production is not changed.
              </label>
            </div>
          )}

          <DialogFooter>
            {step === "configure" ? (
              <>
                <Button variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="train-form" disabled={values.scope === "stream" && !cached}>
                  Review scope
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" disabled={act.pending} onClick={() => setStep("configure")}>
                  Back
                </Button>
                <Button disabled={!confirmed || act.pending} onClick={handleSubmit(submit)}>
                  {act.pending && <Spinner />}
                  Start training
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
