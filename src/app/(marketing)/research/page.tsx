import type { Metadata } from "next";
import Link from "next/link";

import { readAggregate, winners, type AggRow } from "@/lib/benchmarks";
import { POLICY_LABELS, type Policy } from "@/lib/catalog";
import { cn } from "@/lib/utils";
import { DocPage, DocSection } from "../_components/doc-page";

export const metadata: Metadata = {
  title: "Research",
  description: "How RetrainWise estimates avoidable staleness and prices model updates, and how it performed against five other policies, including where it loses.",
};

const usd = (x: number) => (Number.isFinite(x) ? `$${Math.round(x).toLocaleString("en-US")}` : "—");
const label = (p: string) => POLICY_LABELS[p as Policy] ?? p;

function ResultsTable({ rows, caption }: { rows: AggRow[]; caption: string }) {
  const w = winners(rows);
  const rwWins = w.filter((c) => c.best === "retrainwise").length;
  return (
    <div>
      <p>
        RetrainWise had the lowest mean total cost among online policies in <strong>{rwWins} of {w.length}</strong> dataset × price-regime cells.
      </p>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[620px] text-[13.5px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-subtle text-left text-[12px] text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Dataset</th>
              <th className="px-3 py-2.5 font-medium">Price regime</th>
              <th className="px-3 py-2.5 font-medium">Lowest total cost</th>
              <th className="px-3 py-2.5 text-right font-medium">Best total</th>
              <th className="px-4 py-2.5 text-right font-medium">RetrainWise</th>
            </tr>
          </thead>
          <tbody>
            {w.map((c) => (
              <tr key={`${c.dataset}-${c.regime}`} className="border-b border-border/70 last:border-0">
                <td className="px-4 py-2.5 capitalize text-foreground">{c.dataset}</td>
                <td className="px-3 py-2.5 capitalize">{c.regime}</td>
                <td className={cn("px-3 py-2.5", c.best === "retrainwise" ? "font-semibold text-foreground" : "")}>{label(c.best)}</td>
                <td className="tabular px-3 py-2.5 text-right">{usd(c.bestTotal)}</td>
                <td className="tabular px-4 py-2.5 text-right">
                  {usd(c.retrainwiseTotal)}{" "}
                  <span className={cn("text-[12px]", c.best === "retrainwise" ? "text-ok" : "text-muted-foreground")}>
                    {c.best === "retrainwise" ? "best" : Number.isFinite(c.retrainwiseGap) ? `+${c.retrainwiseGap.toFixed(1)}%` : ""}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ResearchPage() {
  const v1 = readAggregate("results");
  const v2 = readAggregate("results_v2");
  return (
    <DocPage
      eyebrow="Research"
      title="When is retraining worth it?"
      intro="RetrainWise treats a model update as an economic decision. This page explains the method in plain terms and reports the benchmark results, including the cases where it loses."
      toc={[
        { id: "problem", label: "The problem" },
        { id: "method", label: "Method" },
        { id: "formula", label: "The decision rule" },
        { id: "results", label: "Results" },
        { id: "losses", label: "Where it loses" },
        { id: "limitations", label: "Limitations" },
        { id: "reproduce", label: "Reproduce" },
      ]}
    >
      <DocSection id="problem" title="The problem">
        <p>
          Teams usually retrain on a calendar or when a drift alarm fires. Neither asks whether retraining will pay for itself. Inputs drift without hurting accuracy; accuracy sometimes drops because the task got harder for <em>every</em> model, which retraining cannot fix; and every update costs compute, engineering review, validation and deployment risk.
        </p>
      </DocSection>

      <DocSection id="method" title="Method">
        <ul>
          <li>
            <strong>Prequential monitoring.</strong> Each batch is predicted before its labels are revealed. Rolling error with intervals, per-feature PSI, ADWIN and DDM track what changed.
          </li>
          <li>
            <strong>Probe model.</strong> A cheap model is trained on recent labelled rows, cross-fitted so it never scores rows it learned from, and scored on the same rows as the deployed model.
          </li>
          <li>
            <strong>Difference-in-differences.</strong> The deployed-minus-probe error gap now, minus the same gap at deployment, estimates <em>avoidable staleness</em>. A rise shared by both models is classified as a task that got harder.
          </li>
          <li>
            <strong>Renewal rule.</strong> Each deployed model is a renewal cycle: act when the marginal avoidable-error cost of continuing reaches the running average cost of the cycle, renewal included.
          </li>
          <li>
            <strong>Value-of-information probes.</strong> Probes run only when what they could reveal is worth their price, within a monitoring budget.
          </li>
          <li>
            <strong>Recovery ratios.</strong> Measured outcomes of past updates teach how much of the avoidable error a partial update recovers compared with a full retrain.
          </li>
          <li>
            <strong>Chronological validation and approval.</strong> Candidates are trained on earlier rows, scored on withheld later rows, and promoted only after a person approves.
          </li>
        </ul>
      </DocSection>

      <DocSection id="formula" title="The decision rule">
        <pre>
          <code>{`Expected benefit = avoidable error reduction × prediction horizon × value of one error
Total cost       = compute + engineering + validation + deployment risk + probe evaluation
Net value        = expected benefit − total cost`}</code>
        </pre>
        <p>
          Keep, partial update and full retrain are ranked by net value with a 95% interval. An action must also pass guardrails: budget, per-action limit, minimum evidence, cooldown, minimum benefit, confidence that net value is positive, and the renewal rule. All prices are assumptions from a documented price snapshot and are labelled as simulated in the product.
        </p>
      </DocSection>

      <DocSection id="results" title="Results">
        <p>
          216 replays: four streams (Electricity, Airlines, Covertype and a synthetic stream with known drift), six policies (never retrain, calendar, drift-triggered, a CARA-CT-inspired cost-aware baseline, RetrainWise and a hindsight oracle), three price regimes and three seeds. Every policy saw identical streams, label masks and cost traces. Total cost is operational cost plus the cost of errors.
        </p>
        {v1 ? (
          <>
            <h3 className="pt-2 font-serif text-[21px] text-foreground">First benchmark</h3>
            <ResultsTable rows={v1} caption="First benchmark: lowest total cost per cell" />
          </>
        ) : null}
        {v2 ? (
          <>
            <h3 className="pt-4 font-serif text-[21px] text-foreground">With probe-based staleness</h3>
            <ResultsTable rows={v2} caption="Probe-based version: lowest total cost per cell" />
          </>
        ) : null}
        {!v1 && !v2 && <p>The reference result files are not available in this deployment. Run your own comparison from Experiments in the app.</p>}
        <p className="text-[13px] text-muted-foreground">Means over three seeds. Simulated costs. Several gaps are within one standard deviation; no significance tests were run.</p>
      </DocSection>

      <DocSection id="losses" title="Where it loses">
        <ul>
          <li>
            <strong>Fast-ageing models with cheap retraining.</strong> On Electricity under cheap and balanced prices, plain calendar retraining had the lowest total cost. When refits are cheap and staleness is constant, an aggressive schedule is hard to beat.
          </li>
          <li>
            <strong>Evaluation overhead.</strong> Shadow evaluation is charged every time it runs; in the expensive regime it was a third of RetrainWise&apos;s spending in the first benchmark.
          </li>
          <li>
            <strong>Conservatism.</strong> Requiring high confidence that net value is positive blocks marginal but positive updates. This is intended; settings were not tuned on these test streams.
          </li>
          <li>
            <strong>Budget as a hard cap.</strong> On long streams a fixed budget dominates the outcome.
          </li>
        </ul>
      </DocSection>

      <DocSection id="limitations" title="Limitations">
        <ul>
          <li>All costs are assumptions: a static, unverified price snapshot plus synthetic engineer hours and incident probabilities.</li>
          <li>Linear learners were benchmarked; tree ensembles may behave differently.</li>
          <li>Airlines and Covertype are ordered replays, not verified chronologies.</li>
          <li>The cost-aware baseline is inspired by CARA-CT rather than an exact re-implementation.</li>
          <li>The oracle is optimal only over keep or full retrain on a checkpoint grid.</li>
          <li>Language-model explanations are advisory and are always shown next to the deterministic figures.</li>
        </ul>
      </DocSection>

      <DocSection id="reproduce" title="Reproduce">
        <p>
          Every number above is read from the stored benchmark result files, not typed in by hand. Run your own comparisons on your data from <strong>Experiments</strong> in the app; the <Link href="/docs">documentation</Link> explains each screen.
        </p>
      </DocSection>
    </DocPage>
  );
}
