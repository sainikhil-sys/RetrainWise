import type { Metadata } from "next";

import { Callout, DataTable, Section, SimLabel } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { wsEngine } from "@/lib/engine";
import { money } from "@/lib/format";
import { getSettings } from "@/lib/queries";

export const metadata: Metadata = { title: "Pricing assumptions" };
export const dynamic = "force-dynamic";

type Profile = { compute_hours_per_10k_rows: number; engineer_hours: number; validation_hours: number; incident_probability: number; fixed_usd?: number };
type Pricing = {
  label: string;
  captured: string;
  verification_status: string;
  currency: string;
  sources_to_check: string[];
  instances: Record<string, { provider: string; region: string; vcpu: number; memory_gib: number; gpu?: string; usd_per_hour: number }>;
  regimes: Record<string, { description: string; instance: string } & Partial<Record<"full" | "partial" | "probe" | "evaluation", Profile>>>;
  notes: string[];
};

export default async function PricingPage() {
  const ctx = await requirePage("/settings/pricing");
  const [pricing, settings] = await Promise.all([wsEngine(ctx.workspace.id).call<Pricing>("pricing", {}, { timeoutMs: 60_000 }), getSettings(ctx.workspace.id)]);
  const instances = Object.entries(pricing.instances).map(([id, i]) => ({ id, ...i }));
  const regimes = Object.entries(pricing.regimes);

  return (
    <>
      <Callout tone="warn" title={pricing.label}>
        {pricing.captured}. {pricing.verification_status}
      </Callout>

      <Section title="Instances" description={`On-demand list prices in ${pricing.currency}, used to scale the simulated compute term.`} action={<SimLabel>Assumed prices</SimLabel>}>
        <DataTable
          caption="Instances"
          rows={instances}
          rowKey={(i) => i.id}
          columns={[
            { key: "id", header: "Instance", cell: (i) => <span className="font-mono text-[12.5px]">{i.id}</span> },
            { key: "p", header: "Provider", cell: (i) => `${i.provider} · ${i.region}` },
            { key: "c", header: "vCPU / memory", cell: (i) => `${i.vcpu} vCPU · ${i.memory_gib} GiB${i.gpu ? ` · ${i.gpu}` : ""}` },
            { key: "u", header: "Per hour", align: "right", cell: (i) => money(i.usd_per_hour, 3) },
          ]}
        />
      </Section>

      <Section title="Cost regimes" description={`The active regime for this workspace is ${settings.regime}. Engineer time is priced at ${money(settings.engineer_hourly_rate)} per hour and an incident at ${money(settings.incident_cost, 0)} (Engine settings).`}>
        <div className="grid gap-4 lg:grid-cols-3">
          {regimes.map(([name, r]) => (
            <div key={name} className={`rounded-md border p-4 ${name === settings.regime ? "border-foreground" : "border-border"}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-serif text-[22px] capitalize">{name}</span>
                {name === settings.regime && <span className="text-[11.5px] text-muted-foreground">active</span>}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{r.description}</p>
              <p className="mt-2 font-mono text-[12px]">{r.instance}</p>
              <table className="mt-3 w-full text-[12px]">
                <caption className="sr-only">{name} profile</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 font-medium" />
                    {(["full", "partial", "probe"] as const).filter((k) => r[k]).map((k) => (
                      <th key={k} className="py-1 text-right font-medium capitalize">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Compute h / 10k rows", "compute_hours_per_10k_rows"],
                      ["Engineer hours", "engineer_hours"],
                      ["Validation hours", "validation_hours"],
                      ["Incident probability", "incident_probability"],
                    ] as const
                  ).map(([label, key]) => (
                    <tr key={key} className="border-t border-border/60">
                      <td className="py-1 text-muted-foreground">{label}</td>
                      {(["full", "partial", "probe"] as const)
                        .filter((k) => r[k])
                        .map((k) => (
                          <td key={k} className="tabular py-1 text-right">
                            {r[k]![key] ?? "—"}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Notes">
        <ul className="list-disc space-y-1.5 pl-5 text-[13px] text-ink-2">
          {pricing.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p className="mt-4 text-[12.5px] text-muted-foreground">
          Check current prices:{" "}
          {pricing.sources_to_check.map((s, i) => (
            <span key={s}>
              {i > 0 && " · "}
              <a href={s} target="_blank" rel="noreferrer noopener" className="underline underline-offset-4">
                {new URL(s).hostname}
              </a>
            </span>
          ))}
        </p>
      </Section>
    </>
  );
}
