"use client";

import { ArrowLeft, ArrowRight, Check, CircleNotch, CloudArrowDown, Sparkle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Reveal } from "@/components/motion";
import { api } from "@/components/rw-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DATASET_INFO, type DatasetName } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type Dataset = { name: DatasetName; cached: boolean; synthetic: boolean; title: string };

const REGIMES = [
  { id: "cheap", title: "Cheap", text: "Small CPU instance, mostly automated pipeline, low deployment risk. A full retrain costs about $50 (assumed)." },
  { id: "balanced", title: "Balanced", text: "Mid-size instance, an engineer reviews data and validation, moderate risk. About $150 per full retrain (assumed)." },
  { id: "expensive", title: "Expensive", text: "GPU instance, regulated sign-off, high deployment risk. About $570 per full retrain (assumed)." },
] as const;

const STEPS = ["Workspace", "Data", "Cost regime", "Start"];

export function OnboardingFlow({
  email,
  workspace,
  workspaces,
  canAdmin,
}: {
  email: string;
  workspace: { id: string; name: string; defaultRegime: string } | null;
  workspaces: { id: string; name: string }[];
  canAdmin: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState(workspace ? 1 : 0);
  const [wsName, setWsName] = useState("");
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  const [dataset, setDataset] = useState<DatasetName>("synthetic");
  const [regime, setRegime] = useState<string>(workspace?.defaultRegime ?? "balanced");
  const [pending, setPending] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    api<{ datasets: Dataset[] }>("/api/datasets")
      .then((r) => setDatasets(r.datasets))
      .catch((e: Error) => toast.error("Could not read datasets", { description: e.message }));
  }, [workspace]);

  const selected = datasets?.find((d) => d.name === dataset);

  async function createWorkspace() {
    if (wsName.trim().length < 2) return;
    setPending(true);
    try {
      await api("/api/workspaces", { body: { name: wsName.trim() } });
      router.refresh();
      setStep(1);
    } catch (e) {
      toast.error("Workspace not created", { description: (e as Error).message });
    } finally {
      setPending(false);
    }
  }

  async function finish(start: boolean) {
    setPending(true);
    try {
      if (start) {
        const r = await api<{ id: string; rows: number; active_version: number }>("/api/runs", { body: { dataset, size: "standard", seed: 42, regime } });
        toast.success("First monitored run started", { description: `${r.rows.toLocaleString()} rows; model v${String(r.active_version).padStart(3, "0")} trained on the initial window.` });
      }
      await api("/api/onboarding", { body: { defaultRegime: regime } });
      router.push("/overview");
      router.refresh();
    } catch (e) {
      toast.error(start ? "Run not started" : "Could not finish", { description: (e as Error).message });
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <span className="font-serif text-[22px] tracking-[-0.01em]">RetrainWise</span>
        <span className="text-[12.5px] text-muted-foreground">{email}</span>
      </header>
      <div className="mx-auto max-w-2xl px-6 py-14">
        <ol className="mb-12 flex items-center gap-3 text-[12.5px]" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className={cn("flex items-center gap-2", i === step ? "font-medium text-foreground" : i < step ? "text-foreground" : "text-ink-3")} aria-current={i === step ? "step" : undefined}>
                <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px]", i < step ? "border-foreground bg-foreground text-white" : i === step ? "border-foreground" : "border-border")}>
                  {i < step ? <Check size={11} weight="bold" /> : i + 1}
                </span>
                {s}
              </span>
              {i < STEPS.length - 1 && <span aria-hidden className="h-px w-6 bg-border" />}
            </li>
          ))}
        </ol>

        <Reveal key={step}>
          {step === 0 && (
            <section>
              <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.01em]">Create a workspace</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                A workspace holds one team&apos;s monitored models, decisions, model versions and audit history. You will be its admin and can invite others with Viewer, Operator, Approver or Admin roles.
              </p>
              <form
                className="mt-8 flex flex-col gap-3 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createWorkspace();
                }}
              >
                <Input autoFocus value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="e.g. Credit risk models" maxLength={60} className="h-10" aria-label="Workspace name" />
                <Button type="submit" size="lg" disabled={pending || wsName.trim().length < 2}>
                  {pending && <CircleNotch className="animate-spin" />} Create workspace
                </Button>
              </form>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.01em]">Choose a data stream</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                RetrainWise replays a dataset batch by batch: the model predicts first, labels arrive later, and monitoring decides whether an update is worth its cost.
              </p>
              {workspaces.length > 1 && <p className="mt-2 text-[13px] text-muted-foreground">Setting up {workspace?.name}.</p>}
              <div className="mt-8 divide-y divide-border border-y border-border" role="radiogroup" aria-label="Dataset">
                {(datasets ?? []).map((d) => (
                  <label key={d.name} className={cn("flex cursor-pointer items-start gap-4 py-4", dataset === d.name && "")}>
                    <input type="radio" name="dataset" className="mt-1 accent-black" checked={dataset === d.name} onChange={() => setDataset(d.name)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
                        {DATASET_INFO[d.name].title}
                        {d.synthetic ? (
                          <span className="rounded border border-border px-1.5 text-[11px] font-normal text-ink-2">synthetic · offline</span>
                        ) : d.cached ? (
                          <span className="rounded border border-ok/30 bg-ok-soft px-1.5 text-[11px] font-normal text-ok">real · cached</span>
                        ) : (
                          <span className="rounded border border-border px-1.5 text-[11px] font-normal text-muted-foreground">real · not downloaded</span>
                        )}
                      </span>
                      <span className="mt-1 block text-[13px] leading-relaxed text-ink-2">{DATASET_INFO[d.name].blurb}</span>
                    </span>
                    {!d.synthetic && !d.cached && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!!downloading}
                        onClick={async (e) => {
                          e.preventDefault();
                          setDownloading(d.name);
                          try {
                            await api(`/api/datasets/${d.name}/download`, { body: {} });
                            setDatasets((all) => all?.map((x) => (x.name === d.name ? { ...x, cached: true } : x)) ?? null);
                            setDataset(d.name);
                            toast.success(`${DATASET_INFO[d.name].title} downloaded and verified`);
                          } catch (err) {
                            toast.error("Download failed", { description: (err as Error).message });
                          } finally {
                            setDownloading(null);
                          }
                        }}
                      >
                        {downloading === d.name ? <CircleNotch className="animate-spin" /> : <CloudArrowDown />} Download
                      </Button>
                    )}
                  </label>
                ))}
                {!datasets && (
                  <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
                    <CircleNotch className="animate-spin" /> Starting the ML engine and reading datasets…
                  </div>
                )}
              </div>
              <div className="mt-6 grid gap-4 text-[13px] leading-relaxed text-ink-2 sm:grid-cols-2">
                <p>
                  <span className="font-medium text-foreground">Synthetic data</span> is generated on this computer with known abrupt, gradual, recurring and input-only drift. It is ideal for a first look: you can see whether RetrainWise reacts at the right moments.
                </p>
                <p>
                  <span className="font-medium text-foreground">Real datasets</span> (Electricity, Airlines, Covertype) are downloaded from their original sources with checksums and provenance. Their drift is real and unlabeled, so outcomes are less predictable.
                </p>
              </div>
              <Nav onBack={workspace ? undefined : () => setStep(0)} onNext={() => setStep(2)} nextDisabled={!selected?.cached} />
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.01em]">Set a default cost regime</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                Costs decide whether an update is worth it. These are assumed prices for a simulated cost model, not your cloud bill. You can change every assumption later in Settings.
              </p>
              <div className="mt-8 divide-y divide-border border-y border-border" role="radiogroup" aria-label="Cost regime">
                {REGIMES.map((r) => (
                  <label key={r.id} className="flex cursor-pointer items-start gap-4 py-4">
                    <input type="radio" name="regime" className="mt-1 accent-black" checked={regime === r.id} onChange={() => setRegime(r.id)} disabled={!canAdmin} />
                    <span>
                      <span className="block text-[14px] font-medium">{r.title}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-2">{r.text}</span>
                    </span>
                  </label>
                ))}
              </div>
              <Nav onBack={() => setStep(1)} onNext={() => setStep(3)} />
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="font-serif text-[44px] leading-[1.05] tracking-[-0.01em]">Start your first monitored model</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
                RetrainWise trains an initial model on the first 1,000 rows of <span className="text-foreground">{DATASET_INFO[dataset].title}</span>, then you process batches and watch the evidence build.
              </p>
              <dl className="mt-8 divide-y divide-border border-y border-border text-[13.5px]">
                {[
                  ["Dataset", `${DATASET_INFO[dataset].title} · standard sample (first 20,000 rows)`],
                  ["Data type", dataset === "synthetic" ? "Synthetic, generated locally" : "Real, cached original source"],
                  ["Initial model", "Logistic regression (SGD), seed 42"],
                  ["Cost regime", `${regime} (assumed prices)`],
                  ["Updates", "Only after evaluation, explicit approval and chronological validation"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2.5">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" onClick={() => void finish(true)} disabled={pending}>
                  {pending ? <CircleNotch className="animate-spin" /> : <Sparkle />} Start monitored run
                </Button>
                <Button variant="ghost" onClick={() => void finish(false)} disabled={pending}>
                  Skip for now
                </Button>
                <Button variant="ghost" onClick={() => setStep(2)} disabled={pending}>
                  <ArrowLeft /> Back
                </Button>
              </div>
            </section>
          )}
        </Reveal>
        <p className="mt-16 text-[12px] text-muted-foreground">
          Need context first? Read{" "}
          <Link href="/docs" className="underline underline-offset-4">
            how RetrainWise works
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, nextDisabled }: { onBack?: () => void; onNext: () => void; nextDisabled?: boolean }) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <Button size="lg" onClick={onNext} disabled={nextDisabled}>
        Continue <ArrowRight />
      </Button>
      {onBack && (
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft /> Back
        </Button>
      )}
    </div>
  );
}
