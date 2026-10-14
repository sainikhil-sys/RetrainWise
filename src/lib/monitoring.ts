/**
 * Monitoring layer (L1): PSI covariate drift, ADWIN/DDM on prediction errors,
 * rolling performance, staleness ("learning debt") and evaluation triggers.
 *
 * Important distinction: PSI measures change in P(X) only. A PSI alarm is
 * reported as *covariate shift*; predictive degradation requires label-based
 * evidence (error detectors or a rolling error above the reference level).
 */
import type { Settings } from "./config";
import type { Frame } from "./ml/frame";

export const MAX_CATEGORY_BINS = 30;
export const PSI_MIN_SAMPLE = 100;

// ------------------------------------------------------------------------ PSI
export type PsiBin =
  | { kind: "numeric"; edges: number[]; counts: number[]; n: number }
  | { kind: "categorical"; values: string[]; counts: number[]; n: number };
export type PsiReference = Record<string, PsiBin>;
type BinSpec = { kind: "numeric"; edges: number[] } | { kind: "categorical"; values: string[] };

function quantile(sorted: number[], q: number): number {
  // linear interpolation, as numpy.quantile's default method
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Index of the first edge >= v (numpy.searchsorted side="left"). */
function searchLeft(edges: number[], v: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function binCounts(frame: Frame, feature: string, rows: number[], item: BinSpec): number[] {
  if (item.kind === "numeric") {
    // Right-closed bins: (-inf, e1], (e1, e2], ..., (ek, inf), plus a missing bin.
    const counts = new Array(item.edges.length + 2).fill(0);
    const col = frame.numeric[feature];
    for (const r of rows) {
      const v = col ? col[r] : Number.NaN;
      if (!Number.isFinite(v)) counts[item.edges.length + 1] += 1;
      else counts[searchLeft(item.edges, v)] += 1;
    }
    return counts;
  }
  const index = new Map(item.values.map((v, i) => [v, i]));
  const counts = new Array(item.values.length + 2).fill(0);
  const col = frame.categorical[feature];
  for (const r of rows) {
    const v = col ? col[r] : null;
    if (v === null || v === undefined) counts[item.values.length + 1] += 1;
    else counts[index.get(v) ?? item.values.length] += 1;
  }
  return counts;
}

/** Fixed reference bins computed once from a model's training window. */
export function psiReference(frame: Frame, rows: number[], bins = 10): PsiReference {
  const spec: PsiReference = {};
  for (const f of frame.features) {
    let item: BinSpec;
    if (frame.kinds[f] === "numeric") {
      const col = frame.numeric[f];
      const values = rows.map((r) => col[r]).filter(Number.isFinite).sort((a, b) => a - b);
      let edges: number[] = [0];
      if (values.length) {
        const qs: number[] = [];
        for (let i = 1; i < bins; i++) qs.push(quantile(values, i / bins));
        edges = [...new Set(qs)].sort((a, b) => a - b);
        if (!edges.length) edges = [values[0]];
      }
      item = { kind: "numeric", edges };
    } else {
      const counts = new Map<string, number>();
      for (const r of rows) {
        const v = frame.categorical[f][r];
        if (v !== null && v !== undefined) counts.set(v, (counts.get(v) || 0) + 1);
      }
      const values = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, MAX_CATEGORY_BINS).map((e) => e[0]);
      item = { kind: "categorical", values };
    }
    spec[f] = { ...item, counts: binCounts(frame, f, rows, item), n: rows.length } as PsiBin;
  }
  return spec;
}

export interface PsiValue {
  psi: number | null;
  n: number;
  noise_floor: number | null;
  reason?: string;
}

/**
 * PSI per feature against fixed reference bins. Proportions use +0.5 count
 * smoothing so empty bins never produce infinite values. `noise_floor`
 * approximates the expected PSI under no change ((k-1)(1/n+1/m)); a shift is
 * only flagged when PSI exceeds both the threshold and three times that floor.
 */
export function psi(reference: PsiReference, frame: Frame, rows: number[]): Record<string, PsiValue> {
  const out: Record<string, PsiValue> = {};
  for (const [f, item] of Object.entries(reference)) {
    if (!frame.features.includes(f)) {
      out[f] = { psi: null, n: 0, noise_floor: null, reason: "column missing" };
      continue;
    }
    const expected = item.counts.map((c) => c + 0.5);
    const actual = binCounts(frame, f, rows, item).map((c) => c + 0.5);
    const es = expected.reduce((a, b) => a + b, 0);
    const as = actual.reduce((a, b) => a + b, 0);
    let value = 0;
    let k = 0;
    for (let i = 0; i < expected.length; i++) {
      const e = expected[i] / es;
      const a = actual[i] / as;
      value += (a - e) * Math.log(a / e);
      if (item.counts[i] > 0 || actual[i] > 0.5) k += 1;
    }
    const n = rows.length;
    const m = Math.max(item.n || 0, 1);
    out[f] = { psi: value, n, noise_floor: Math.max(k - 1, 1) * (1 / Math.max(n, 1) + 1 / m) };
  }
  return out;
}

export interface PsiSummary {
  max_psi: number | null;
  max_feature: string | null;
  shifted: string[];
  reliable: boolean;
}

export function psiSummary(values: Record<string, PsiValue>, threshold: number): PsiSummary {
  const valid = Object.entries(values).filter(([, v]) => v.psi !== null) as [string, PsiValue & { psi: number }][];
  if (!valid.length) return { max_psi: null, max_feature: null, shifted: [], reliable: false };
  let feature = valid[0][0];
  let max = valid[0][1].psi;
  for (const [k, v] of valid) {
    if (v.psi > max) {
      max = v.psi;
      feature = k;
    }
  }
  const shifted = valid.filter(([, v]) => v.psi >= threshold && v.psi >= 3 * (v.noise_floor ?? 0)).map(([k]) => k).sort();
  return { max_psi: max, max_feature: feature, shifted, reliable: valid[0][1].n >= PSI_MIN_SAMPLE };
}

// ---------------------------------------------------------------------- ADWIN
export interface AdwinState {
  delta: number;
  max_window: number;
  min_length: number;
  clock: number;
  window: number[];
  ticks: number;
  detections: number;
}

export interface AdwinDetection {
  old_mean: number;
  new_mean: number;
  increase: boolean;
  window_before: number;
  window_after?: number;
  position?: number;
}

/**
 * ADWIN change detector (Bifet & Gavalda, 2007) on a bounded exact window,
 * using the ADWIN2 cut condition with the variance-based bound and testing
 * every split point. The window is capped at `max_window` items.
 */
export class ADWIN {
  delta: number;
  maxWindow: number;
  minLength: number;
  clock: number;
  window: number[] = [];
  ticks = 0;
  detections = 0;

  constructor(delta = 0.002, maxWindow = 5_000, minLength = 5, clock = 32) {
    if (!(delta > 0 && delta < 1)) throw new Error("delta must be in (0, 1)");
    this.delta = delta;
    this.maxWindow = maxWindow;
    this.minLength = minLength;
    this.clock = clock;
  }

  update(value: number): AdwinDetection | null {
    this.window.push(value);
    if (this.window.length > this.maxWindow) this.window.shift();
    this.ticks += 1;
    return this.ticks % this.clock === 0 ? this.check() : null;
  }

  updateMany(values: number[]): AdwinDetection[] {
    const found: AdwinDetection[] = [];
    values.forEach((v, i) => {
      const result = this.update(v);
      if (result) {
        result.position = i;
        found.push(result);
      }
    });
    return found;
  }

  private check(): AdwinDetection | null {
    let detection: AdwinDetection | null = null;
    for (let step = 0; step < 50; step++) {
      const w = this.window;
      const n = w.length;
      if (n < 2 * this.minLength + 1) break;
      const cs = new Float64Array(n);
      let acc = 0;
      for (let i = 0; i < n; i++) {
        acc += w[i];
        cs[i] = acc;
      }
      const mean = acc / n;
      let ss = 0;
      for (let i = 0; i < n; i++) ss += (w[i] - mean) ** 2;
      const variance = ss / n;
      const dd = Math.log((2 * Math.log(n)) / this.delta);
      let fire = -1;
      let mu0 = 0;
      let mu1 = 0;
      for (let n0 = this.minLength; n0 <= n - this.minLength; n0++) {
        const n1 = n - n0;
        const a = cs[n0 - 1] / n0;
        const b = (acc - cs[n0 - 1]) / n1;
        const m = 1 / (n0 - this.minLength + 1) + 1 / (n1 - this.minLength + 1);
        const eps = Math.sqrt(2 * m * variance * dd) + (2 / 3) * dd * m;
        if (Math.abs(a - b) > eps) {
          fire = n0;
          mu0 = a;
          mu1 = b;
          break;
        }
      }
      if (fire < 0) break;
      if (detection === null) detection = { old_mean: mu0, new_mean: mu1, increase: mu1 > mu0, window_before: n };
      this.window.splice(0, fire);
    }
    if (detection) {
      this.detections += 1;
      detection.window_after = this.window.length;
    }
    return detection;
  }

  state(): AdwinState {
    return { delta: this.delta, max_window: this.maxWindow, min_length: this.minLength, clock: this.clock,
      window: [...this.window], ticks: this.ticks, detections: this.detections };
  }

  static fromState(s: AdwinState): ADWIN {
    const obj = new ADWIN(s.delta, s.max_window, s.min_length, s.clock);
    obj.window = [...s.window];
    obj.ticks = s.ticks;
    obj.detections = s.detections;
    return obj;
  }
}

// ------------------------------------------------------------------------ DDM
export interface DdmState {
  min_instances: number;
  warning_level: number;
  drift_level: number;
  n: number;
  p: number;
  s: number;
  p_min: number | null;
  s_min: number | null;
}

/** Drift Detection Method (Gama et al., 2004) on a binary error stream. */
export class DDM {
  minInstances: number;
  warningLevel: number;
  driftLevel: number;
  n = 0;
  p = 1;
  s = 0;
  pMin = Number.POSITIVE_INFINITY;
  sMin = Number.POSITIVE_INFINITY;

  constructor(minInstances = 30, warning = 2.0, drift = 3.0) {
    this.minInstances = minInstances;
    this.warningLevel = warning;
    this.driftLevel = drift;
  }

  reset(): void {
    this.n = 0;
    this.p = 1;
    this.s = 0;
    this.pMin = Number.POSITIVE_INFINITY;
    this.sMin = Number.POSITIVE_INFINITY;
  }

  update(error: number): "stable" | "warning" | "drift" {
    if (error !== 0 && error !== 1) throw new Error("DDM expects 0/1 errors");
    this.n += 1;
    this.p += (error - this.p) / this.n;
    this.s = Math.sqrt((this.p * (1 - this.p)) / this.n);
    if (this.n < this.minInstances) return "stable";
    if (this.p + this.s <= this.pMin + this.sMin) {
      this.pMin = this.p;
      this.sMin = this.s;
    }
    const level = this.p + this.s;
    if (level > this.pMin + this.driftLevel * this.sMin) {
      this.reset();
      return "drift";
    }
    if (level > this.pMin + this.warningLevel * this.sMin) return "warning";
    return "stable";
  }

  state(): DdmState {
    const fin = (v: number) => (Number.isFinite(v) ? v : null);
    return { min_instances: this.minInstances, warning_level: this.warningLevel, drift_level: this.driftLevel,
      n: this.n, p: this.p, s: this.s, p_min: fin(this.pMin), s_min: fin(this.sMin) };
  }

  static fromState(s: DdmState): DDM {
    const obj = new DDM(s.min_instances, s.warning_level, s.drift_level);
    obj.n = Math.trunc(s.n);
    obj.p = s.p;
    obj.s = s.s;
    obj.pMin = s.p_min ?? Number.POSITIVE_INFINITY;
    obj.sMin = s.s_min ?? Number.POSITIVE_INFINITY;
    return obj;
  }
}

// -------------------------------------------------------------------- metrics
export function wilson(errors: number, n: number, z = 1.96): [number, number] | null {
  if (n <= 0) return null;
  const p = errors / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const radius = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - radius), Math.min(1, centre + radius)];
}

export interface Metrics {
  n: number;
  accuracy: number | null;
  error: number | null;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  error_ci: [number, number] | null;
}

/** Accuracy, error and macro precision/recall/F1 (zero_division = 0), like scikit-learn. */
export function classificationMetrics(yTrue: string[], yPred: string[], labels?: string[]): Metrics {
  const n = yTrue.length;
  if (n === 0) return { n: 0, accuracy: null, error: null, precision: null, recall: null, f1: null, error_ci: null };
  let errors = 0;
  for (let i = 0; i < n; i++) if (yTrue[i] !== yPred[i]) errors += 1;
  const present = labels ?? [...new Set([...yTrue, ...yPred])].sort();
  let pSum = 0;
  let rSum = 0;
  let fSum = 0;
  for (const label of present) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < n; i++) {
      const t = yTrue[i] === label;
      const p = yPred[i] === label;
      if (t && p) tp += 1;
      else if (p) fp += 1;
      else if (t) fn += 1;
    }
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    pSum += precision;
    rSum += recall;
    fSum += precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  }
  const k = present.length || 1;
  return { n, accuracy: 1 - errors / n, error: errors / n, precision: pSum / k, recall: rSum / k, f1: fSum / k,
    error_ci: wilson(errors, n) };
}

// --------------------------------------------------------------- monitor state
export interface MonitorState {
  reference_error: number;
  reference_n: number;
  rolling: number[];
  adwin: AdwinState;
  ddm: DdmState;
  learning_debt: number;
  labels_since_update: number;
  labels_since_evaluation: number;
  predictions_since_update: number;
  adwin_alarms: number;
  ddm_drifts: number;
  psi_reference: PsiReference;
  recent_rows: number[];
  change_row: number | null;
}

/** Fresh monitor for a newly deployed model version. */
export function newMonitor(settings: Settings, referenceError: number, referenceN: number,
  psiRef: PsiReference): MonitorState {
  return {
    reference_error: referenceError, reference_n: referenceN, rolling: [],
    adwin: new ADWIN(settings.adwin_delta).state(), ddm: new DDM(settings.ddm_min_instances).state(),
    learning_debt: 0, labels_since_update: 0, labels_since_evaluation: 0, predictions_since_update: 0,
    adwin_alarms: 0, ddm_drifts: 0, psi_reference: psiRef, recent_rows: [], change_row: null,
  };
}

export interface LabelSignals {
  adwin_detections: AdwinDetection[];
  adwin_error_increase: boolean;
  ddm_status: "stable" | "warning" | "drift";
  rolling_error: number | null;
  rolling_n: number;
  rolling_error_ci: [number, number] | null;
  degradation: number | null;
  learning_debt: number;
  change_row: number | null;
}

/**
 * Feed revealed 0/1 errors (chronological order) into all detectors. `rows`
 * (stream row ids aligned with `errors`) lets an ADWIN error-rate increase be
 * mapped to an estimated change row: the first row still inside ADWIN's window
 * after the cut.
 */
export function updateWithLabels(monitor: MonitorState, errors: number[], settings: Settings,
  rows?: number[]): LabelSignals {
  const adwin = ADWIN.fromState(monitor.adwin);
  const ddm = DDM.fromState(monitor.ddm);
  const detections = adwin.updateMany(errors);
  let ddmStatus: "stable" | "warning" | "drift" = "stable";
  for (const e of errors) {
    const status = ddm.update(e);
    if (status === "drift" || (status === "warning" && ddmStatus === "stable")) ddmStatus = status;
  }
  const rolling = [...monitor.rolling, ...errors].slice(-settings.rolling_window);
  const excess = errors.reduce((a, b) => a + b, 0) - monitor.reference_error * errors.length;
  monitor.learning_debt = Math.max(0, monitor.learning_debt + excess); // CUSUM-style, floored at 0
  monitor.labels_since_update += errors.length;
  monitor.labels_since_evaluation += errors.length;
  const increase = detections.filter((d) => d.increase);
  if (rows) {
    const recent = [...(monitor.recent_rows || []), ...rows].slice(-adwin.maxWindow);
    monitor.recent_rows = recent;
    if (increase.length) {
      const d = increase[increase.length - 1];
      const index = recent.length - rows.length + (d.position ?? 0) + 1 - (d.window_after ?? 0);
      if (index >= 0 && index < recent.length) monitor.change_row = recent[index];
    }
  }
  monitor.adwin_alarms += increase.length;
  monitor.ddm_drifts += ddmStatus === "drift" ? 1 : 0;
  monitor.rolling = rolling;
  monitor.adwin = adwin.state();
  monitor.ddm = ddm.state();
  const n = rolling.length;
  const sum = rolling.reduce((a, b) => a + b, 0);
  return {
    adwin_detections: detections, adwin_error_increase: increase.length > 0, ddm_status: ddmStatus,
    rolling_error: n ? sum / n : null, rolling_n: n, rolling_error_ci: n ? wilson(sum, n) : null,
    degradation: n ? sum / n - monitor.reference_error : null, learning_debt: monitor.learning_debt,
    change_row: monitor.change_row,
  };
}

export interface DriftStatus {
  status: string;
  covariate_signal: boolean;
  predictive_signal: boolean;
  sustained_degradation: boolean;
}

export function driftStatus(signals: Pick<LabelSignals, "rolling_error_ci" | "rolling_n" | "adwin_error_increase" |
  "ddm_status">, psiInfo: PsiSummary, monitor: MonitorState, settings: Settings): DriftStatus {
  const ci = signals.rolling_error_ci;
  const enough = (signals.rolling_n || 0) >= Math.max(30, Math.floor(settings.min_evidence / 2));
  const sustained = Boolean(enough && ci && ci[0] > monitor.reference_error + settings.degradation_margin);
  const predictive = Boolean(signals.adwin_error_increase || signals.ddm_status === "drift" || sustained);
  const covariate = Boolean(psiInfo.reliable && psiInfo.shifted.length);
  let status: string;
  if (!enough && !predictive) status = covariate ? "covariate shift (labels pending)" : "insufficient labels";
  else if (predictive && covariate) status = "covariate shift + predictive degradation";
  else if (predictive) status = "predictive degradation";
  else if (covariate) status = "covariate shift only";
  else status = "stable";
  return { status, covariate_signal: covariate, predictive_signal: predictive, sustained_degradation: sustained };
}

/** Step 1 of the decision workflow: is it worth paying for shadow evaluation? */
export function evaluationTrigger(monitor: MonitorState, telemetry: Partial<LabelSignals & DriftStatus>,
  settings: Settings, batchesSinceUpdate: number, batchesSinceEvaluation: number,
  cheapestActionCost: number): [boolean, string[]] {
  const reasons: string[] = [];
  if (monitor.labels_since_update < settings.min_evidence) return [false, ["fewer new labels than minimum evidence"]];
  if (batchesSinceUpdate < settings.cooldown_batches) return [false, ["cooldown"]];
  if (telemetry.adwin_error_increase) reasons.push("ADWIN detected an error-rate increase");
  if (telemetry.ddm_status === "drift") reasons.push("DDM drift level reached");
  if (telemetry.sustained_degradation) reasons.push("rolling error CI above reference + margin");
  const debtCost = monitor.learning_debt * settings.error_value;
  if (cheapestActionCost > 0 && debtCost >= 0.5 * cheapestActionCost) {
    reasons.push(`learning debt $${debtCost.toFixed(0)} >= half the cheapest action cost`);
  }
  if (telemetry.covariate_signal && monitor.labels_since_evaluation >= settings.min_evidence) {
    reasons.push("covariate shift with enough new labels to test impact");
  }
  if (batchesSinceEvaluation >= settings.max_batches_between_evaluations) {
    reasons.push("periodic staleness check interval reached");
  }
  return [reasons.length > 0, reasons];
}
