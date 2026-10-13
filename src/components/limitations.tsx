import { TriangleAlert } from "lucide-react";

import { Card, CardBody, CardHeader } from "./ui";

const ITEMS: { title: string; body: string }[] = [
  {
    title: "Rapidly ageing models with cheap retraining",
    body: "When a model goes stale within a few batches and retraining is cheap, a simple aggressive policy (calendar or drift-triggered retraining) can match or beat RetrainWise: probing, baselines and evidence thresholds add delay and overhead that only pay off when actions are expensive or drift is intermittent. The benchmark results show these losses rather than hiding them.",
  },
  {
    title: "Probe estimates are noisy and assume a stable baseline gap",
    body: "Difference-in-differences assumes the deployed-vs-probe gap measured right after deployment would have stayed constant without staleness. Each estimate rests on one batch of labels, so it carries a wide interval, and every new version needs fresh baseline probes before staleness can be estimated again.",
  },
  {
    title: "Labels are required",
    body: "Probes, detectors and validation all need true labels. With long label delays or low label availability, every signal lags the stream and the system acts later.",
  },
  {
    title: "Simulated money",
    body: "Compute prices are an assumed snapshot, engineer hours and incident probabilities are synthetic, deployment is a local registry swap, and probe overheads are assumed. Dollar results show relative behaviour, not real savings.",
  },
  {
    title: "Recovery ratios start from priors",
    body: "Partial-vs-full choices use recovery ratios learned from post-update measurements; until a few updates have been measured they are mostly the configured priors.",
  },
  {
    title: "Single model family",
    body: "The engine uses scikit-learn SGD logistic models. The probe/decision logic is model-agnostic, but other model families were not evaluated.",
  },
];

export function Limitations({ compact }: { compact?: boolean }) {
  return (
    <Card>
      <CardHeader title="Limitations" icon={TriangleAlert} description="What this system cannot do well, stated plainly." />
      <CardBody>
        <ul className={compact ? "grid gap-3 md:grid-cols-2" : "grid gap-3 md:grid-cols-2 xl:grid-cols-3"}>
          {ITEMS.map((i) => (
            <li key={i.title} className="rounded-xl border border-slate-800 bg-slate-900/30 p-3">
              <div className="text-sm font-medium text-amber-200">{i.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{i.body}</p>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
