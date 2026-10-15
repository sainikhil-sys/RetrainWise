import { ArrowRight, Check, Minus } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

import { auth } from "@/auth";
import { Button } from "@/components/ui/button";
import { REPO_URL, SELF_HOST_URL, SITE_ONLY } from "@/lib/site";
import { cn } from "@/lib/utils";
import { HeroPreview } from "./_components/hero-preview";
import { LandingMotion } from "./_components/landing-motion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "RetrainWise — retrain models when the value exceeds the cost" },
  description: "RetrainWise estimates how much of a model's error a refresh would remove, prices each update option and asks a person to approve before anything changes. Local-first.",
};

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[12.5px] font-medium text-muted-foreground">{children}</div>;
}
function H2({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("font-serif text-[36px] leading-[1.08] tracking-[-0.01em] sm:text-[44px]", className)}>{children}</h2>;
}

const METHODS = ["Probe model", "Difference-in-differences", "Renewal rule", "Value-of-information probes", "Recovery ratios", "Chronological validation", "Guardrails", "Human approval", "Immutable audit trail", "Rollback with checksums"];

const BENCH: [string, string][] = [
  ["216", "replays"],
  ["4", "datasets"],
  ["6", "policies"],
  ["3", "price regimes"],
];

const STEPS = [
  { name: "Detect", text: "Every batch is predicted before its labels arrive. Error, drift, model age and spend are tracked continuously." },
  { name: "Evaluate", text: "A cheap probe model estimates avoidable staleness. Candidate updates are trained on past rows and scored on newer ones." },
  { name: "Approve", text: "Keep, partial update or full retrain are ranked by net value under guardrails. A person approves." },
  { name: "Update", text: "The candidate is checked again: checksum, chronological validation, budget. Only then is it promoted." },
  { name: "Monitor", text: "The new and retired models predict the same rows. The realised gain calibrates the next decision." },
];

const COMPARE: { label: string; calendar: boolean | string; drift: boolean | string; rw: boolean | string }[] = [
  { label: "Acts when something changed", calendar: false, drift: true, rw: true },
  { label: "Separates avoidable staleness from a harder task", calendar: false, drift: false, rw: true },
  { label: "Prices compute, people, risk and monitoring", calendar: false, drift: false, rw: true },
  { label: "Chooses between partial and full updates", calendar: false, drift: false, rw: true },
  { label: "Requires human approval before production changes", calendar: "depends", drift: "depends", rw: true },
  { label: "Cheapest when models age fast and retraining is cheap", calendar: "often", drift: "sometimes", rw: "not always" },
];

function Cell({ v }: { v: boolean | string }) {
  if (v === true) return <Check className="mx-auto size-4" aria-label="yes" />;
  if (v === false) return <Minus className="mx-auto size-4 text-ink-3" aria-label="no" />;
  return <span className="text-[12.5px] text-muted-foreground">{v}</span>;
}

/* Small, labelled interface drawings for the product sections. */
function Frame({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-border bg-background shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)]">
      <div className="p-5">{children}</div>
      <figcaption className="border-t border-border bg-subtle px-5 py-2 text-[11px] text-muted-foreground">{caption} · illustration</figcaption>
    </figure>
  );
}

const PREVIEWS: { id: string; eyebrow: string; title: string; text: string; drawing: ReactNode }[] = [
  {
    id: "monitoring",
    eyebrow: "Monitoring",
    title: "Know what changed, and what did not.",
    text: "Rolling error with intervals, per-feature drift, ADWIN and DDM detectors, label delay and coverage. Input drift without lost accuracy is reported as exactly that.",
    drawing: (
      <svg viewBox="0 0 360 120" className="w-full" aria-hidden>
        {Array.from({ length: 8 }).map((_, r) =>
          Array.from({ length: 18 }).map((_, c) => {
            const hot = c > 10 && r < 3;
            return <rect key={`${r}-${c}`} x={c * 20} y={r * 15} width="18" height="13" rx="1.5" fill={hot ? (c > 13 ? "#0a0a0a" : "#5f5f5c") : c > 10 && r < 5 ? "#c4c4c0" : "#f0f0ee"} />;
          }),
        )}
      </svg>
    ),
  },
  {
    id: "staleness",
    eyebrow: "Counterfactual staleness",
    title: "Is the model stale, or did the task get harder?",
    text: "A probe model trained on recent rows is scored on the same rows as the deployed model. Comparing that gap with the gap at deployment (difference-in-differences) isolates the error a refresh could actually remove.",
    drawing: (
      <svg viewBox="0 0 360 130" className="w-full" aria-hidden>
        <line x1="0" x2="360" y1="100" y2="100" stroke="#ededeb" />
        <path d="M10,96 C80,95 140,92 190,80 C240,66 290,40 350,30" fill="none" stroke="#0a0a0a" strokeWidth="2" />
        <path d="M10,98 C80,98 140,96 190,92 C240,88 290,86 350,84" fill="none" stroke="#8a8a87" strokeWidth="1.5" strokeDasharray="4 3" />
        <line x1="350" x2="350" y1="30" y2="84" stroke="#c62828" strokeDasharray="2 2" />
        <text x="292" y="62" fontSize="10" fill="#c62828">
          avoidable
        </text>
        <line x1="10" x2="10" y1="96" y2="98" stroke="#5f5f5c" />
        <text x="16" y="116" fontSize="10" fill="#8a8a87">
          gap at deployment
        </text>
      </svg>
    ),
  },
  {
    id: "decisions",
    eyebrow: "Decision analysis",
    title: "Every recommendation shows its arithmetic.",
    text: "Expected benefit is avoidable error reduction × horizon × the value of an error. Cost adds compute, engineering, validation, deployment risk and the probe. You see the formula, the interval and every guardrail.",
    drawing: (
      <div className="space-y-2 font-mono text-[11.5px]">
        <div className="text-muted-foreground">benefit = Δerror × horizon × value</div>
        <div className="text-muted-foreground">cost = compute + people + risk + probe</div>
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-3 font-sans text-[12px]">
          {["Keep", "Partial", "Full"].map((a, i) => (
            <div key={a} className={cn("border-l-2 pl-2", i === 1 ? "border-foreground font-medium" : "border-border text-muted-foreground")}>
              {a}
              <div className="text-[10.5px] font-normal text-muted-foreground">{i === 0 ? "reference" : i === 1 ? "highest net value" : "blocked by budget"}</div>
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: "models",
    eyebrow: "Models",
    title: "Train, validate, then promote. In that order.",
    text: "Train real candidates with your choice of model, preprocessing and seed. Each is scored on withheld, later rows and compared with production. Exact metrics are stored at full precision.",
    drawing: (
      <div className="space-y-2.5 text-[12px]">
        {[
          ["Train", "fits on earlier rows", true],
          ["Validate", "scores on withheld later rows", true],
          ["Promote", "after approval only", false],
        ].map(([k, t, done]) => (
          <div key={k as string} className="flex items-center gap-3">
            <span className={cn("flex size-5 items-center justify-center rounded-full border text-[10px]", done ? "border-foreground bg-foreground text-background" : "border-border")}>{done ? "✓" : ""}</span>
            <span className="w-16 font-medium">{k}</span>
            <span className="text-muted-foreground">{t}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "approvals",
    eyebrow: "Approvals and audit",
    title: "Nothing reaches production without a person.",
    text: "Operators and the agent can only request. Approvers approve, and a workspace can require a different person to approve. Every action lands in an append-only audit trail you can export.",
    drawing: (
      <ol className="space-y-2 border-l border-border pl-4 text-[12px]">
        {["Operator requested a partial update", "Approver approved: validation passed", "v004 promoted after chronological validation", "Outcome measured over 2,000 labels"].map((t) => (
          <li key={t} className="relative">
            <span className="absolute -left-[19.5px] top-1.5 size-1.5 rounded-full bg-foreground" />
            {t}
          </li>
        ))}
      </ol>
    ),
  },
  {
    id: "experiments",
    eyebrow: "Experiments",
    title: "Test the policy before you trust it.",
    text: "Replay real and synthetic streams under six policies with identical labels and cost traces. Compare accuracy against total cost, per dataset and price regime, including the cases where RetrainWise loses.",
    drawing: (
      <svg viewBox="0 0 360 120" className="w-full" aria-hidden>
        <line x1="20" x2="350" y1="105" y2="105" stroke="#ededeb" />
        <line x1="20" x2="20" y1="10" y2="105" stroke="#ededeb" />
        {[
          [60, 70, "#c4c4c0"],
          [120, 40, "#8a8a87"],
          [200, 35, "#8a8a87"],
          [260, 30, "#5f5f5c"],
        ].map(([x, y, c], i) => (
          <circle key={i} cx={x as number} cy={y as number} r="5" fill={c as string} />
        ))}
        <rect x="150" y="22" width="10" height="10" transform="rotate(45 155 27)" fill="#0a0a0a" />
        <text x="168" y="30" fontSize="10" fill="#0a0a0a">
          RetrainWise
        </text>
        <text x="300" y="118" fontSize="9" fill="#8a8a87">
          cost →
        </text>
      </svg>
    ),
  },
];

const ROLES = [
  { role: "ML engineers", text: "Stop retraining on a timer. See whether the error is avoidable before spending compute, and train candidates with exact, reproducible metrics." },
  { role: "Platform and MLOps", text: "One local service with a job queue, worker logs, cancellation, checksums and rollback. SQLite to start, PostgreSQL when you grow." },
  { role: "Approvers and risk", text: "Clear requests with evidence, formula and guardrails. Separate-approver rules, immutable audit events and exports." },
  { role: "Engineering leads", text: "Spend on model updates where they pay back, and see the cost of monitoring itself." },
];

export default async function LandingPage() {
  // Signed-in people never see the marketing page: the app opens on the dashboard
  // (the app layout then sends anyone mid-setup to onboarding).
  if (!SITE_ONLY && (await auth())?.user) redirect("/overview");
  return (
    <LandingMotion>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="bg-dots mask-fade-y pointer-events-none absolute inset-0" />
        <div className="relative mx-auto max-w-[1200px] px-4 pb-10 pt-16 text-center sm:px-6 lg:pt-24">
          <Link href="/research" className="inline-flex items-center gap-2 rounded-full border border-border bg-background/80 py-1 pl-1.5 pr-3 text-[12.5px] backdrop-blur transition-colors hover:border-foreground/40" data-land>
            <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">New</span>
            Probe-based staleness estimation
            <ArrowRight className="size-3" />
          </Link>
          <h1 className="mx-auto mt-6 max-w-4xl font-serif text-[52px] leading-[0.98] tracking-[-0.02em] sm:text-[80px]" data-land>
            Retrain models when the <em className="italic">value</em> exceeds the cost.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[16.5px] leading-relaxed text-ink-2" data-land>
            RetrainWise estimates how much of a model&apos;s error a refresh would actually remove, prices keeping it, updating it and retraining it, and asks a person to approve before production changes.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3" data-land>
            <Button size="lg" asChild>
              <Link href={SITE_ONLY ? SELF_HOST_URL : "/signin?next=/onboarding"}>
                {SITE_ONLY ? "Run it locally" : "Get started"} <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              {SITE_ONLY ? (
                <a href={REPO_URL} target="_blank" rel="noreferrer noopener">
                  View on GitHub
                </a>
              ) : (
                <Link href="/signin?next=/overview">Explore the demo</Link>
              )}
            </Button>
          </div>
          <p className="mt-4 text-[12.5px] text-muted-foreground" data-land>
            Local-first ML lifecycle intelligence · runs on your machine · the demo uses a synthetic stream and simulated costs
          </p>
        </div>
        <div className="relative px-4 pb-20 sm:px-6">
          <HeroPreview />
        </div>
      </section>

      {/* Method strip */}
      <section aria-label="Methods" className="mask-fade-x overflow-hidden border-y border-border bg-subtle py-4">
        <div className="animate-marquee flex w-max gap-10 whitespace-nowrap font-serif text-[22px] text-ink-2">
          {[...METHODS, ...METHODS].map((m, i) => (
            <span key={i} className="flex items-center gap-10" aria-hidden={i >= METHODS.length}>
              {m}
              <span className="text-ink-3">✦</span>
            </span>
          ))}
        </div>
      </section>

      {/* Problem */}
      <section id="product" className="border-t border-border bg-subtle">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <div className="max-w-2xl" data-land>
            <Eyebrow>The problem</Eyebrow>
            <H2 className="mt-3">Drift alarms tell you something changed. They do not tell you whether acting is worth it.</H2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
              Inputs shift all the time without hurting accuracy. Sometimes accuracy drops because the task got harder for every model, and retraining recovers nothing. And a retrain has a price: compute, review, validation and the risk of a bad deploy.
            </p>
          </div>
          <div className="mt-10 overflow-x-auto rounded-lg border border-border bg-background" data-land>
            <table className="w-full min-w-[620px] text-[13.5px]">
              <caption className="sr-only">Calendar retraining, drift-triggered retraining and RetrainWise compared</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-5 py-3 font-medium" />
                  <th className="px-3 py-3 text-center font-medium">Calendar</th>
                  <th className="px-3 py-3 text-center font-medium">Drift-triggered</th>
                  <th className="px-3 py-3 text-center font-serif text-[17px] font-normal">RetrainWise</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.label} className="border-b border-border/70 last:border-0">
                    <td className="px-5 py-3">{r.label}</td>
                    <td className="px-3 py-3 text-center">
                      <Cell v={r.calendar} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Cell v={r.drift} />
                    </td>
                    <td className="bg-subtle/60 px-3 py-3 text-center">
                      <Cell v={r.rw} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
        <div className="max-w-2xl" data-land>
          <Eyebrow>How it works</Eyebrow>
          <H2 className="mt-3">Five steps, one record.</H2>
        </div>
        <ol className="relative mt-12 grid gap-4 md:grid-cols-5">
          <span aria-hidden className="absolute left-0 right-0 top-[39px] hidden h-px bg-border md:block" />
          {STEPS.map((s, i) => (
            <li key={s.name} data-step className="group relative rounded-lg border border-border bg-background p-5 transition-shadow hover:shadow-[0_18px_40px_-24px_rgba(0,0,0,0.3)]">
              <span className="relative z-10 flex size-7 items-center justify-center rounded-full border border-foreground bg-background text-[12px] tabular transition-colors group-hover:bg-foreground group-hover:text-background">{i + 1}</span>
              <div className="mt-4 font-serif text-[26px] leading-none">{s.name}</div>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Research engine */}
      <section className="border-y border-border">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div data-land>
            <Eyebrow>The research engine</Eyebrow>
            <H2 className="mt-3">Measure the error you can remove, not just the error you see.</H2>
            <ul className="mt-6 space-y-4 text-[14.5px] leading-relaxed text-ink-2">
              <li>
                <b className="font-medium text-foreground">Probe model.</b> A cheap model trained on recent labelled rows, cross-fitted so it never scores rows it learned from.
              </li>
              <li>
                <b className="font-medium text-foreground">Difference-in-differences.</b> The deployed-minus-probe gap now, minus the same gap at deployment. What remains is avoidable staleness; a shared rise is a harder task.
              </li>
              <li>
                <b className="font-medium text-foreground">Renewal rule.</b> Act when the marginal cost of keeping the model reaches the running average cost of its cycle, renewal included.
              </li>
              <li>
                <b className="font-medium text-foreground">Value of information.</b> Probes run only when what they could reveal is worth their price, within a monitoring budget.
              </li>
              <li>
                <b className="font-medium text-foreground">Recovery ratios.</b> Past updates teach how much of the avoidable error a partial update recovers compared with a full retrain.
              </li>
            </ul>
            <Link href="/research" className="mt-6 inline-flex items-center gap-1.5 text-[14px] underline decoration-border underline-offset-4 hover:decoration-foreground">
              Read the method and the benchmark results <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <figure data-land className="rounded-lg border border-border p-6">
            <svg viewBox="0 0 420 260" className="w-full" role="img" aria-label="Diagram: the deployed model's error rises above the probe's; the part of the gap beyond the gap at deployment is avoidable staleness">
              <line x1="40" x2="400" y1="220" y2="220" stroke="#c4c4c0" />
              <line x1="40" x2="40" y1="20" y2="220" stroke="#c4c4c0" />
              <text x="400" y="238" fontSize="10" textAnchor="end" fill="#8a8a87">
                time since deployment →
              </text>
              <text x="34" y="26" fontSize="10" textAnchor="end" fill="#8a8a87">
                error
              </text>
              <path d="M50,180 C130,178 200,170 260,140 C310,115 350,80 390,70" fill="none" stroke="#0a0a0a" strokeWidth="2.2" />
              <path d="M50,190 C130,190 200,186 260,176 C310,168 350,160 390,156" fill="none" stroke="#8a8a87" strokeWidth="1.6" strokeDasharray="5 4" />
              <line x1="56" x2="56" y1="180" y2="190" stroke="#0a0a0a" />
              <text x="64" y="206" fontSize="10.5" fill="#5f5f5c">
                gap at deployment
              </text>
              <line x1="390" x2="390" y1="70" y2="146" stroke="#c62828" strokeWidth="1.5" />
              <line x1="390" x2="390" y1="146" y2="156" stroke="#0a0a0a" strokeWidth="1.5" />
              <text x="382" y="110" fontSize="11" textAnchor="end" fill="#c62828">
                avoidable staleness
              </text>
              <text x="252" y="196" fontSize="10.5" fill="#8a8a87">
                fresh probe: task difficulty
              </text>
              <text x="230" y="128" fontSize="10.5" fill="#0a0a0a">
                deployed model
              </text>
            </svg>
            <figcaption className="mt-3 text-[12px] text-muted-foreground">Conceptual diagram, not data.</figcaption>
          </figure>
        </div>
      </section>

      {/* Product: bento */}
      <section className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
        <div className="max-w-2xl" data-land>
          <Eyebrow>The product</Eyebrow>
          <H2 className="mt-3">A workspace for the whole update decision.</H2>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-6">
          {PREVIEWS.map((p, i) => (
            <article
              key={p.id}
              data-land
              className={cn(
                "group flex flex-col overflow-hidden rounded-xl border border-border bg-background transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_28px_60px_-36px_rgba(0,0,0,0.4)]",
                i === 0 || i === 3 ? "md:col-span-4" : i >= 4 ? "md:col-span-3" : "md:col-span-2",
              )}
            >
              <div className="flex-1 border-b border-border bg-subtle p-5">
                <div className="flex min-h-[150px] items-center">{p.drawing}</div>
              </div>
              <div className="p-5">
                <Eyebrow>{p.eyebrow}</Eyebrow>
                <h3 className="mt-1.5 font-serif text-[24px] leading-[1.12]">{p.title}</h3>
                <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">{p.text}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground">Drawings of the interface, not measured results.</p>
      </section>

      {/* Benchmark band */}
      <section className="border-y border-border bg-foreground text-background">
        <div className="bg-grid-dark">
          <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
            <div className="grid gap-10 md:grid-cols-[1fr_1.4fr] md:items-end">
              <div data-land>
                <div className="text-[12.5px] font-medium text-background/60">Tested, not assumed</div>
                <h2 className="mt-3 font-serif text-[36px] leading-[1.08] sm:text-[44px]">Benchmarked against five other policies, losses included.</h2>
              </div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-background/15 bg-background/15 sm:grid-cols-4" data-land>
                {BENCH.map(([n, label]) => (
                  <div key={label} className="bg-foreground p-5">
                    <dt className="text-[12px] text-background/60">{label}</dt>
                    <dd className="mt-1 font-serif text-[40px] leading-none">{n}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="mt-8 max-w-3xl text-[14px] leading-relaxed text-background/75" data-land>
              In the reference replays RetrainWise had the lowest total cost in 6 of 12 dataset × price combinations. Calendar retraining won on Electricity under cheap and balanced prices, where models age fast and retraining is cheap.{" "}
              <Link href="/research" className="text-background underline underline-offset-4">
                See every result
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="border-t border-border bg-subtle">
        <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6">
          <div className="max-w-2xl" data-land>
            <Eyebrow>Who it is for</Eyebrow>
            <H2 className="mt-3">Built for the people who own the decision.</H2>
          </div>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => (
              <div key={r.role} data-land className="bg-background p-6">
                <div className="font-serif text-[22px] leading-tight">{r.role}</div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-ink-2">{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
        <div data-land>
          <Eyebrow>Security and control</Eyebrow>
          <H2 className="mt-3">Your data stays where it is.</H2>
        </div>
        <ul className="grid gap-x-10 gap-y-6 text-[14px] leading-relaxed sm:grid-cols-2" data-land>
          {[
            ["Local-first", "Data, models and the engine run on your machine. Datasets are downloaded from their original sources with checksums."],
            ["Approval by people", "Roles from Viewer to Admin. The agent and operators can only request; approvals are enforced on the server."],
            ["Immutable audit trail", "Database triggers reject edits and deletions of audit events. Exports are recorded too."],
            ["Passwordless sign-in", "One-time email links, database sessions that expire, rate limits on sign-in and every API."],
            ["Verified artifacts", "Every model artifact carries a SHA-256 checksum that is checked before it serves or is restored."],
            ["No silent automation", "Bounded autonomy is off by default, admin-only and capped by count and cost."],
          ].map(([k, t]) => (
            <li key={k}>
              <div className="font-medium">{k}</div>
              <p className="mt-1 text-ink-2">{t}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-border bg-foreground text-background">
        <div aria-hidden className="bg-grid-dark absolute inset-0 [mask-image:radial-gradient(ellipse_60%_80%_at_80%_50%,#000,transparent)]" />
        <div className="relative mx-auto flex max-w-[1200px] flex-col items-start gap-8 px-4 py-24 sm:px-6 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-2xl font-serif text-[40px] leading-[1.05] sm:text-[52px]" data-land>
            Make model updates a decision, not a reflex.
          </h2>
          <div className="flex flex-wrap gap-3" data-land>
            <Button size="lg" variant="secondary" asChild>
              <Link href={SITE_ONLY ? SELF_HOST_URL : "/signin?next=/onboarding"}>
                {SITE_ONLY ? "Run it locally" : "Get started"} <ArrowRight />
              </Link>
            </Button>
            <Button size="lg" variant="ghost" className="text-background hover:bg-background/10 hover:text-background" asChild>
              <Link href="/docs">Read the docs</Link>
            </Button>
          </div>
        </div>
      </section>
    </LandingMotion>
  );
}
