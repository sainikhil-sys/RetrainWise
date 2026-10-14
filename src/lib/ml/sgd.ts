/**
 * Linear classifier trained by stochastic gradient descent on the log loss
 * with an L2 penalty: the same model family and "optimal" learning-rate
 * schedule as scikit-learn's SGDClassifier(loss="log_loss"). Multiclass
 * problems use one-vs-rest. `partialFit` is genuine incremental learning: one
 * pass over new rows continuing the learning-rate schedule.
 */
import { Rng } from "../rng";
import type { Encoded } from "./preprocess";

export interface SgdState {
  classes: string[];
  alpha: number;
  /** One weight vector per binary problem (1 for two classes, k for k > 2). */
  weights: number[][];
  intercepts: number[];
  /** Number of samples seen; drives the learning-rate schedule. */
  t: number;
  seed: number;
  updates: number;
}

const TOL = 1e-4;
const N_ITER_NO_CHANGE = 5;

function dloss(p: number, y: number): number {
  // derivative of log(1 + exp(-y p)) w.r.t. p, numerically stable
  const z = p * y;
  if (z > 18) return -y * Math.exp(-z);
  if (z < -18) return -y;
  return -y / (Math.exp(z) + 1);
}

function loss(p: number, y: number): number {
  const z = p * y;
  if (z > 18) return Math.exp(-z);
  if (z < -18) return -z;
  return Math.log1p(Math.exp(-z));
}

function optimalInit(alpha: number): number {
  const typw = Math.sqrt(1 / Math.sqrt(alpha));
  const eta0 = typw / Math.max(1, dloss(-typw, 1));
  return 1 / (eta0 * alpha);
}

function dot(x: Encoded, i: number, w: Float64Array): number {
  let s = 0;
  const base = i * x.numDim;
  for (let j = 0; j < x.numDim; j++) s += x.dense[base + j] * w[j];
  const cb = i * x.catCols;
  for (let j = 0; j < x.catCols; j++) {
    const idx = x.cats[cb + j];
    if (idx >= 0) s += w[idx];
  }
  return s;
}

function addScaled(x: Encoded, i: number, w: Float64Array, factor: number): void {
  const base = i * x.numDim;
  for (let j = 0; j < x.numDim; j++) w[j] += factor * x.dense[base + j];
  const cb = i * x.catCols;
  for (let j = 0; j < x.catCols; j++) {
    const idx = x.cats[cb + j];
    if (idx >= 0) w[idx] += factor;
  }
}

/** Plain SGD epochs over one binary problem; returns the updated weights, intercept and step count. */
function sgdBinary(x: Encoded, y: Int8Array, w0: Float64Array, b0: number, alpha: number, t0: number,
  epochs: number, rng: Rng, earlyStop: boolean): { w: Float64Array; b: number; t: number } {
  const w = Float64Array.from(w0);
  let wscale = 1;
  let b = b0;
  let t = t0;
  const init = optimalInit(alpha);
  const order = new Int32Array(x.n);
  for (let i = 0; i < x.n; i++) order[i] = i;
  let best = Number.POSITIVE_INFINITY;
  let noImprove = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    rng.shuffle(order);
    let sumLoss = 0;
    for (let k = 0; k < x.n; k++) {
      const i = order[k];
      t += 1;
      const eta = 1 / (alpha * (init + t - 1));
      const p = dot(x, i, w) * wscale + b;
      sumLoss += loss(p, y[i]);
      const update = -eta * dloss(p, y[i]);
      wscale *= Math.max(0, 1 - eta * alpha);
      if (update !== 0) {
        addScaled(x, i, w, update / wscale);
        b += update;
      }
      if (wscale < 1e-9) {
        for (let j = 0; j < w.length; j++) w[j] *= wscale;
        wscale = 1;
      }
    }
    if (earlyStop) {
      if (sumLoss > best - TOL * x.n) noImprove += 1;
      else noImprove = 0;
      if (sumLoss < best) best = sumLoss;
      if (noImprove >= N_ITER_NO_CHANGE) break;
    }
  }
  for (let j = 0; j < w.length; j++) w[j] *= wscale;
  return { w, b, t };
}

function binaryTargets(y: string[], positive: string): Int8Array {
  const out = new Int8Array(y.length);
  for (let i = 0; i < y.length; i++) out[i] = y[i] === positive ? 1 : -1;
  return out;
}

export function fitSgd(x: Encoded, y: string[], opts: { alpha: number; epochs: number; seed: number }): SgdState {
  const classes = [...new Set(y)].sort();
  if (classes.length < 2) throw new Error("Training window contains a single class; full retraining is not possible");
  const problems = classes.length === 2 ? [classes[1]] : classes;
  const weights: number[][] = [];
  const intercepts: number[] = [];
  let t = 0;
  problems.forEach((positive, k) => {
    const rng = new Rng(opts.seed * 31 + k);
    const fit = sgdBinary(x, binaryTargets(y, positive), new Float64Array(x.dim), 0, opts.alpha, 0, opts.epochs, rng, true);
    weights.push(Array.from(fit.w));
    intercepts.push(fit.b);
    t = Math.max(t, fit.t);
  });
  return { classes, alpha: opts.alpha, weights, intercepts, t, seed: opts.seed, updates: 0 };
}

/** One incremental pass over new rows. Classes must already be known. Returns a new state. */
export function partialFitSgd(state: SgdState, x: Encoded, y: string[]): SgdState {
  const unseen = [...new Set(y)].filter((c) => !state.classes.includes(c)).sort();
  if (unseen.length) throw new Error(`New class(es) ${JSON.stringify(unseen)} require full retraining`);
  const problems = state.classes.length === 2 ? [state.classes[1]] : state.classes;
  const weights: number[][] = [];
  const intercepts: number[] = [];
  let t = state.t;
  problems.forEach((positive, k) => {
    const rng = new Rng(state.seed * 31 + k + 7919 * (state.updates + 1));
    const fit = sgdBinary(x, binaryTargets(y, positive), Float64Array.from(state.weights[k]), state.intercepts[k],
      state.alpha, state.t, 1, rng, false);
    weights.push(Array.from(fit.w));
    intercepts.push(fit.b);
    t = Math.max(t, fit.t);
  });
  return { ...state, weights, intercepts, t, updates: state.updates + 1 };
}

export function predictSgd(state: SgdState, x: Encoded): string[] {
  const ws = state.weights.map((w) => Float64Array.from(w));
  const out = new Array<string>(x.n);
  for (let i = 0; i < x.n; i++) {
    if (ws.length === 1) {
      out[i] = dot(x, i, ws[0]) + state.intercepts[0] > 0 ? state.classes[1] : state.classes[0];
    } else {
      let best = 0;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < ws.length; k++) {
        const s = dot(x, i, ws[k]) + state.intercepts[k];
        if (s > bestScore) {
          bestScore = s;
          best = k;
        }
      }
      out[i] = state.classes[best];
    }
  }
  return out;
}
