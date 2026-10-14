import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, replaceSettings, safeChild, settingsFrom, type Settings } from "@/lib/config";
import { loadDataset, parseArff, synthetic, SYNTHETIC_SEGMENTS } from "@/lib/datasets";
import { actionCosts, costTrace, rankActions, realizationFactor, sensitivity } from "@/lib/economics";
import { aggregate, benchmark, simulate } from "@/lib/experiments";
import { labelMask } from "@/lib/lifecycle";
import { emptyFrame, range, type Frame } from "@/lib/ml/frame";
import { initialModel, loadArtifact, partialUpdate, planWindows, predict, saveArtifact, shadowEvaluate, trainFull,
  validationGate, type Evidence } from "@/lib/ml/models";
import { encode, fitTransformer, inferSchema } from "@/lib/ml/preprocess";
import { ADWIN, classificationMetrics, DDM, driftStatus, newMonitor, psi, psiReference, psiSummary, updateWithLabels,
  wilson } from "@/lib/monitoring";
import { Rng } from "@/lib/rng";
import { FAST, useTempStore } from "./helpers";

const S = (changes: Partial<Settings> = {}) => replaceSettings(DEFAULT_SETTINGS, changes);

function ev(reduction = 0.05, se = 0.01, n = 500, compatible = true, rows = 1000): Evidence {
  return { compatible, n, reduction, reduction_se: se, reduction_ci: [reduction - 1.96 * se, reduction + 1.96 * se],
    train_rows: rows, incumbent_error: 0.3, candidate_error: 0.3 - reduction, incumbent_f1: 0.7,
    candidate_f1: 0.7 + reduction };
}
const ctx = (extra = {}) => ({ spent: 0, batches_since_update: 10, horizon: 5000, price_multiplier: 1,
  realization: { factor: 1 }, ...extra });

describe("config", () => {
  it("defaults are valid and round-trip", () => {
    expect(settingsFrom({ ...DEFAULT_SETTINGS })).toEqual(DEFAULT_SETTINGS);
  });
  it("rejects invalid values and unknown keys", () => {
    for (const bad of [{ batch_size: 5 }, { label_fraction: 0 }, { regime: "free" }, { min_confidence: 1 },
      { budget: -1 }, { ollama_model: "x y" }, { cost_trace_custom: [] }, { nonsense: 1 }, { seed: 1.5 }]) {
      expect(() => settingsFrom({ ...DEFAULT_SETTINGS, ...bad })).toThrow();
    }
  });
  it("safeChild rejects traversal", () => {
    for (const bad of ["../x", "a/b", ".hidden", ""]) expect(() => safeChild("/tmp/rw", bad)).toThrow();
    expect(safeChild("/tmp/rw", "model_v001.json")).toBe(path.resolve("/tmp/rw/model_v001.json"));
  });
});

describe("economics", () => {
  it("computes benefit, cost and net value", () => {
    const s = S();
    const d = rankActions({ full: ev(0.05), partial: ev(0.02) }, ctx(), s);
    const full = d.ranked.find((r) => r.action === "full")!;
    expect(full.benefit).toBeCloseTo(0.05 * 5000 * s.error_value);
    expect(full.total_cost).toBeCloseTo(actionCosts("full", s, 1000).total);
    expect(full.net_value).toBeCloseTo(full.benefit - full.total_cost);
  });
  it("defer is the zero reference and wins when nothing pays", () => {
    const d = rankActions({ full: ev(0.001), partial: ev(0.0005) }, ctx(), S());
    expect(d.recommended).toBe("defer");
    expect(d.ranked.find((r) => r.action === "defer")!.net_value).toBe(0);
  });
  it("prefers the higher net value among feasible actions", () => {
    const d = rankActions({ full: ev(0.2), partial: ev(0.05) }, ctx(), S());
    expect(d.recommended).toBe("full");
    expect(d.ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  it("scales benefit by the realisation factor", () => {
    const a = rankActions({ full: ev(0.1) }, ctx({ realization: { factor: 1 } }), S()).ranked.find((r) => r.action === "full")!;
    const b = rankActions({ full: ev(0.1) }, ctx({ realization: { factor: 0.5 } }), S()).ranked.find((r) => r.action === "full")!;
    expect(b.benefit).toBeCloseTo(a.benefit / 2);
  });
  it("rejects non-finite and out-of-range inputs", () => {
    expect(() => rankActions({ full: ev(Number.NaN) }, ctx(), S())).toThrow();
    expect(() => rankActions({ full: ev(2) }, ctx(), S())).toThrow();
    expect(() => rankActions({ full: ev() }, ctx({ spent: -1 }), S())).toThrow();
  });
  it("enforces budget and spending limits", () => {
    const d = rankActions({ full: ev(0.3) }, ctx({ spent: 2990 }), S());
    const full = d.ranked.find((r) => r.action === "full")!;
    expect(full.feasible).toBe(false);
    expect(full.guardrails.find((g) => g.name === "cumulative budget")!.passed).toBe(false);
    const limited = rankActions({ full: ev(0.3) }, ctx(), S({ action_limit: 10 })).ranked.find((r) => r.action === "full")!;
    expect(limited.guardrails.find((g) => g.name === "action spending limit")!.passed).toBe(false);
  });
  it("applies evidence, cooldown, confidence and compatibility guardrails", () => {
    const d = rankActions({ full: ev(0.3, 0.01, 10), partial: ev(0.3, 0.01, 500, false) },
      ctx({ batches_since_update: 0 }), S());
    const full = d.ranked.find((r) => r.action === "full")!;
    const names = full.guardrails.filter((g) => !g.passed).map((g) => g.name);
    expect(names).toContain("minimum evidence");
    expect(names).toContain("cooldown");
    expect(d.ranked.find((r) => r.action === "partial")!.feasible).toBe(false);
    const noisy = rankActions({ full: ev(0.01, 0.2) }, ctx(), S()).ranked.find((r) => r.action === "full")!;
    expect(noisy.guardrails.find((g) => g.name === "confidence P(net > 0)")!.passed).toBe(false);
  });
  it("defaults to defer with insufficient evidence", () => {
    expect(rankActions({}, ctx(), S()).recommended).toBe("defer");
  });
  it("orders regimes by cost and keeps traces deterministic", () => {
    const totals = ["cheap", "balanced", "expensive"].map((r) => actionCosts("full", S({ regime: r as Settings["regime"] }), 3000).total);
    expect(totals[0]).toBeLessThan(totals[1]);
    expect(totals[1]).toBeLessThan(totals[2]);
    for (const kind of ["flat", "diurnal", "spot"] as const) {
      const a = costTrace(S({ cost_trace_kind: kind }), 50);
      expect(a).toEqual(costTrace(S({ cost_trace_kind: kind }), 50));
      expect(Math.min(...a)).toBeGreaterThanOrEqual(0.2);
      expect(Math.max(...a)).toBeLessThanOrEqual(5);
    }
  });
  it("shrinks the realisation factor towards the prior", () => {
    const s = S();
    expect(realizationFactor([], s).factor).toBeCloseTo(s.realization_prior);
    const r = realizationFactor(Array(20).fill({ predicted_reduction: 0.1, realized_reduction: 0.1 }), s);
    expect(r.factor).toBeGreaterThan(0.95);
  });
  it("sensitivity changes the recommendation with the error value", () => {
    const rows = sensitivity({ full: ev(0.03), partial: ev(0.01) }, ctx(), S());
    expect(new Set(rows.map((r) => r.recommended)).size).toBeGreaterThan(1);
  });
});

function numericFrame(values: number[]): Frame {
  const f = emptyFrame(["x"], { x: "numeric" }, values.length);
  values.forEach((v, i) => (f.numeric.x[i] = v));
  return f;
}

describe("monitoring", () => {
  it("PSI is ~0 for identical data and large for shifted data", () => {
    const rng = new Rng(1);
    const a = numericFrame(Array.from({ length: 2000 }, () => rng.normal()));
    const b = numericFrame(Array.from({ length: 2000 }, () => rng.normal() + 2));
    const ref = psiReference(a, range(0, 1000));
    expect(psi(ref, a, range(1000, 2000)).x.psi!).toBeLessThan(0.05);
    const shifted = psiSummary(psi(ref, b, range(0, 1000)), 0.2);
    expect(shifted.max_psi!).toBeGreaterThan(1);
    expect(shifted.shifted).toEqual(["x"]);
  });
  it("PSI is safe with constants, missing values and small samples", () => {
    const f = numericFrame([...Array(100).fill(1), ...Array(100).fill(Number.NaN)]);
    const ref = psiReference(f, range(0, 100));
    const v = psi(ref, f, range(100, 200)).x.psi!;
    expect(Number.isFinite(v)).toBe(true);
    expect(psiSummary(psi(ref, f, range(0, 10)), 0.2).reliable).toBe(false);
  });
  it("ADWIN detects a step and stays quiet when stationary", () => {
    const rng = new Rng(3);
    const quiet = new ADWIN(0.002);
    expect(quiet.updateMany(Array.from({ length: 3000 }, () => (rng.random() < 0.2 ? 1 : 0)))).toHaveLength(0);
    const step = new ADWIN(0.002);
    const found = step.updateMany([...Array.from({ length: 1000 }, () => (rng.random() < 0.1 ? 1 : 0)),
      ...Array.from({ length: 1000 }, () => (rng.random() < 0.6 ? 1 : 0))]);
    expect(found.some((d) => d.increase)).toBe(true);
    expect(ADWIN.fromState(step.state()).state()).toEqual(step.state());
  });
  it("DDM flags an error increase", () => {
    const rng = new Rng(4);
    const ddm = new DDM(30);
    const statuses = [...Array.from({ length: 500 }, () => (rng.random() < 0.1 ? 1 : 0)),
      ...Array.from({ length: 500 }, () => (rng.random() < 0.7 ? 1 : 0))].map((e) => ddm.update(e));
    expect(statuses.slice(0, 500)).not.toContain("drift");
    expect(statuses).toContain("drift");
  });
  it("computes metrics and Wilson intervals", () => {
    const m = classificationMetrics(["a", "a", "b", "b"], ["a", "b", "b", "b"]);
    expect(m.error).toBeCloseTo(0.25);
    expect(m.precision).toBeCloseTo((1 + 2 / 3) / 2);
    expect(m.recall).toBeCloseTo((0.5 + 1) / 2);
    const [lo, hi] = wilson(10, 100)!;
    expect(lo).toBeLessThan(0.1);
    expect(hi).toBeGreaterThan(0.1);
    expect(wilson(0, 0)).toBeNull();
  });
  it("covariate shift alone is not predictive degradation", () => {
    const s = S();
    const monitor = newMonitor(s, 0.2, 200, {});
    const signals = updateWithLabels(monitor, Array.from({ length: 400 }, (_, i) => (i % 5 === 0 ? 1 : 0)), s);
    const status = driftStatus(signals, { max_psi: 1, max_feature: "x", shifted: ["x"], reliable: true }, monitor, s);
    expect(status.status).toBe("covariate shift only");
    expect(status.predictive_signal).toBe(false);
  });
});

describe("models", () => {
  const frame = synthetic(4000, 7);
  const s = S(FAST);

  it("fits preprocessing on the training window only", () => {
    const f = numericFrame([...Array(100).fill(0), ...Array(100).fill(100)]);
    f.target = Array.from({ length: 200 }, (_, i) => (i % 2 ? "a" : "b"));
    const t = fitTransformer(f, range(0, 100), inferSchema(f));
    expect(t.numeric[0].mean).toBe(0);
    expect(t.numeric[0].median).toBe(0);
  });
  it("encodes unseen categories without failing", () => {
    const t = fitTransformer(frame, range(0, 500), inferSchema(frame));
    const late = frame.categorical.region.findIndex((v) => v === "west");
    expect(late).toBeGreaterThan(500);
    expect(encode(t, frame, [late]).cats[0]).toBe(-1);
  });
  it("trains binary and multiclass models", () => {
    const m = trainFull(frame, range(0, 800), s);
    const acc = classificationMetrics(range(0, 800).map((r) => frame.target[r]), predict(m, frame, range(0, 800))).accuracy!;
    expect(acc).toBeGreaterThan(0.75);
    const multi = synthetic(1500, 2);
    multi.target = multi.target.map((t, i) => (multi.numeric.x2[i] > 0.5 ? "c" : t));
    const mm = trainFull(multi, range(0, 1500), s);
    expect(mm.classes).toEqual(["c", "negative", "positive"]);
    expect(new Set(predict(mm, multi, range(0, 1500))).size).toBe(3);
  });
  it("incremental updates are genuine and guarded", () => {
    const m = trainFull(frame, range(0, 800), s);
    const u = partialUpdate(m, frame, range(800, 1100));
    expect(u.trained_until).toBe(1100);
    expect(u.n_train).toBe(1100);
    expect(u.estimator.weights).not.toEqual(m.estimator.weights);
    expect(m.trained_until).toBe(800);
    expect(() => partialUpdate(m, frame, range(700, 900))).toThrow(/overlap/);
    const other = { ...frame, target: frame.target.map((t, i) => (i >= 800 ? "new" : t)) };
    expect(() => partialUpdate(m, other, range(800, 900))).toThrow(/full retraining/);
  });
  it("shadow evaluation is chronological and leak-free", () => {
    const [inc] = initialModel(frame, s);
    const eligible = range(0, 2500);
    const plan = planWindows(eligible, inc, s);
    if (!plan.ok) throw new Error(plan.reason);
    const h0 = plan.holdout[0];
    expect(Math.max(...plan.full_rows)).toBeLessThan(h0);
    expect(Math.max(...plan.partial_rows)).toBeLessThan(h0);
    expect(Math.min(...plan.partial_rows)).toBeGreaterThanOrEqual(inc.trained_until);
    const shadow = shadowEvaluate(frame, eligible, inc, s);
    expect(shadow.evidence.full.compatible).toBe(true);
    expect(shadow.candidates.full!.trained_until).toBeLessThanOrEqual(h0);
  });
  it("the validation gate rejects worse candidates", () => {
    expect(validationGate(ev(-0.01), s).passed).toBe(false);
    expect(validationGate(ev(0.05, 0.01, 10), s).passed).toBe(false);
    expect(validationGate(ev(0.05), s).passed).toBe(true);
  });
  it("enforces artifact checksums", () => {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "rw-art-"));
    const file = path.join(dir, "m.json");
    const sha = saveArtifact(trainFull(frame, range(0, 500), s), file, { a: 1 });
    expect(loadArtifact(file, sha)[1]).toEqual({ a: 1 });
    fs.appendFileSync(file, " ");
    expect(() => loadArtifact(file, sha)).toThrow(/Checksum/);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("datasets", () => {
  it("parses ARFF with nominal values, quotes and missing values", () => {
    const t = parseArff("% c\n@relation r\n@attribute 'a b' numeric\n@attribute day {1,2}\n@attribute class {UP,DOWN}\n" +
      "@data\n1.5,1,UP\n?,'2',DOWN\n");
    expect(t.columns).toEqual(["a b", "day", "class"]);
    expect([...t.categorical]).toEqual(["day", "class"]);
    expect(t.rows).toEqual([["1.5", "1", "UP"], [null, "2", "DOWN"]]);
  });
  it("the synthetic stream is reproducible and contains its drift features", () => {
    const a = synthetic(2000, 5);
    expect(synthetic(2000, 5)).toEqual(a);
    expect(a.categorical.region.slice(0, 2000 * SYNTHETIC_SEGMENTS.gradual_start)).not.toContain("west");
    expect(a.categorical.region).toContain("west");
    expect(Array.from(a.numeric.x5).some(Number.isNaN)).toBe(true);
  });
  it("a missing real dataset never falls back to synthetic", () => {
    expect(() => loadDataset("airlines", "small")).toThrow(/not cached/);
  });
  it("label masks are deterministic", () => {
    expect(labelMask(1000, 3, 0.5)).toEqual(labelMask(1000, 3, 0.5));
    const share = labelMask(5000, 3, 0.3).reduce((a, b) => a + b, 0) / 5000;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
  });
});

describe("benchmark", () => {
  const frame: Frame = synthetic(5000, 11);
  const s = S({ ...FAST, seed: 11 });
  const tmp = useTempStore();

  it("is reproducible", async () => {
    const [a] = await simulate(frame, s, "retrainwise");
    const [b] = await simulate(frame, s, "retrainwise");
    expect({ ...a, runtime_seconds: 0, decision_seconds: 0 }).toEqual({ ...b, runtime_seconds: 0, decision_seconds: 0 });
  });
  it("online policies never see future labels", async () => {
    const delayed = replaceSettings(s, { label_delay_batches: 2 });
    const [summary, trace] = await simulate(frame, delayed, "drift_triggered");
    expect(trace).toHaveLength(Math.ceil((5000 - 500) / 250));
    expect(summary.scored_rows).toBe(4500);
  });
  it("writes summary, aggregate and details exports", async () => {
    const out = path.join(tmp.dir(), "results");
    const result = await benchmark({ datasets: ["synthetic"], size: "small", seeds: [1], regimes: ["balanced"],
      settings: s, prefix: "t", outDir: out });
    expect(result.summary).toHaveLength(6);
    expect(fs.readdirSync(out).sort()).toEqual(["t_aggregate.csv", "t_details.json", "t_summary.csv"]);
    const agg = aggregate(result.summary);
    expect(agg.filter((r) => r.policy !== "hindsight_oracle").some((r) => r.tco_vs_best_online_pct === 0)).toBe(true);
  });
});
