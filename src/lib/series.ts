import type { ProbeRow, Telemetry } from "./types";

/** Telemetry -> chart series (plain objects, safe to pass to client components). */
export function errorSeries(tel: Telemetry[]) {
  return tel.map((t) => ({
    row: t.end_row,
    batch: t.batch_index,
    batchError: t.batch_error ?? null,
    rolling: t.rolling_error ?? null,
    reference: t.reference_error ?? null,
    ci: t.rolling_error_ci ?? null,
    version: t.version,
  }));
}

export function versionChanges(tel: Telemetry[]) {
  const out: { row: number; version: number }[] = [];
  for (let i = 1; i < tel.length; i++) {
    if (tel[i].version !== tel[i - 1].version) out.push({ row: tel[i].start_row, version: tel[i].version });
  }
  return out;
}

export function metricSeries(tel: Telemetry[]) {
  return tel.map((t) => ({
    row: t.end_row,
    accuracy: t.batch_accuracy ?? null,
    precision: t.batch_precision ?? null,
    recall: t.batch_recall ?? null,
    f1: t.batch_f1 ?? null,
  }));
}

export function stalenessSeries(tel: Telemetry[]) {
  const top = Math.max(1, ...tel.map((t) => t.learning_debt_cost ?? 0));
  return tel.map((t) => ({
    row: t.end_row,
    debt: Number((t.learning_debt_cost ?? 0).toFixed(2)),
    adwin: t.adwin_error_increase ? top * 1.06 : null,
    ddmDrift: t.ddm_status === "drift" ? top * 1.13 : null,
    ddmWarn: t.ddm_status === "warning" ? top * 1.13 : null,
    age: t.model_age_batches,
  }));
}

export function psiMatrix(tel: Telemetry[]) {
  const features = Array.from(new Set(tel.flatMap((t) => Object.keys(t.psi ?? {}))));
  // Most-drifted features first (by their maximum PSI) so the interesting rows are on top.
  const peak = (f: string) => Math.max(0, ...tel.map((t) => t.psi?.[f] ?? 0));
  features.sort((a, b) => peak(b) - peak(a));
  return {
    features,
    batches: tel.map((t) => ({ row: t.end_row, batch: t.batch_index })),
    values: features.map((f) => tel.map((t) => (t.psi?.[f] ?? null) as number | null)),
  };
}

/** Probe rows -> deployed vs probe error and DiD series (estimates only carry a DiD). */
export function probeSeries(probes: ProbeRow[]) {
  return probes.map((p) => ({
    batch: p.batch_index,
    deployed: p.deployed_error,
    probe: p.probe_error,
    did: p.did,
    band: p.did != null && p.did_se != null ? ([p.did - 1.96 * p.did_se, p.did + 1.96 * p.did_se] as [number, number]) : null,
    hardness: p.task_hardness,
    phase: p.phase,
  }));
}

/** Renewal rule over time; zero/undefined values are dropped because the chart uses a log scale. */
export function renewalSeries(tel: Telemetry[]) {
  const pos = (v: number | undefined) => (v != null && v > 0 ? Number(v.toPrecision(6)) : null);
  return tel.map((t) => ({
    batch: t.batch_index,
    marginal: t.renewal?.available ? pos(t.renewal.marginal) : null,
    average: t.renewal?.available ? pos(t.renewal.average) : null,
  }));
}
