import { Receipt } from "lucide-react";
import type { Metadata } from "next";

import { SettingsForm } from "@/components/settings-form";
import { Alert, Card, CardBody, CardHeader, PageHeader, SimLabel, Table, Td, Th } from "@/components/ui";
import { engineCall } from "@/lib/engine";
import { money } from "@/lib/format";
import { getSettings } from "@/lib/queries";
import { DEFAULT_SETTINGS } from "@/lib/settings-meta";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

type Pricing = {
  label: string;
  captured: string;
  verification_status: string;
  sources_to_check: string[];
  instances: Record<string, { provider: string; region: string; vcpu: number; memory_gib: number; gpu?: string; usd_per_hour: number }>;
  regimes: Record<string, { description: string; instance: string } & Record<string, { compute_hours_per_10k_rows: number; engineer_hours: number; validation_hours: number; incident_probability: number } | string>>;
  notes: string[];
};

export default async function SettingsPage() {
  const [settings, pricing] = await Promise.all([getSettings(), engineCall<Pricing>("pricing", {}, { timeoutMs: 60_000 })]);
  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Assumptions, guardrails and limits"
        description="Every value is validated twice: in the browser and again by the Python engine before it is stored in SQLite. Saving marks pending decisions as stale, because they were computed under the old assumptions."
      />
      {settings.autonomy && (
        <Alert tone="warn" title="Bounded autonomy is on" className="mb-6">
          A batch that triggers evaluation may execute the top-ranked action without a click — at most {settings.autonomy_max_actions} action(s) per run, each costing at most {money(settings.autonomy_max_cost)}, and only if every guardrail and the validation gate pass.
        </Alert>
      )}
      <SettingsForm settings={settings} defaults={DEFAULT_SETTINGS} />

      <Card className="mt-6">
        <CardHeader title="Pricing snapshot" icon={Receipt} description={pricing.label} action={<SimLabel kind="assumed" />} />
        <CardBody className="space-y-5">
          <p className="text-sm text-slate-400">
            {pricing.captured}. {pricing.verification_status}
          </p>
          <Table caption="Instances">
            <thead>
              <tr>
                <Th>Instance</Th>
                <Th>Provider</Th>
                <Th>Region</Th>
                <Th align="right">vCPU</Th>
                <Th align="right">Memory</Th>
                <Th>GPU</Th>
                <Th align="right">USD / hour</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pricing.instances).map(([k, v]) => (
                <tr key={k}>
                  <Td mono>{k}</Td>
                  <Td>{v.provider}</Td>
                  <Td>{v.region}</Td>
                  <Td align="right">{v.vcpu}</Td>
                  <Td align="right">{v.memory_gib} GiB</Td>
                  <Td>{v.gpu ?? "—"}</Td>
                  <Td align="right">{money(v.usd_per_hour, 3)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Table caption="Cost regimes">
            <thead>
              <tr>
                <Th>Regime</Th>
                <Th>Action</Th>
                <Th align="right">Compute h / 10k rows</Th>
                <Th align="right">Engineer h</Th>
                <Th align="right">Validation h</Th>
                <Th align="right">Incident probability</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(pricing.regimes).flatMap(([name, r]) =>
                (["full", "partial", "evaluation"] as const).map((a) => {
                  const p = r[a] as { compute_hours_per_10k_rows: number; engineer_hours: number; validation_hours: number; incident_probability: number };
                  return (
                    <tr key={`${name}-${a}`} className={name === settings.regime ? "bg-teal-400/[0.05]" : undefined}>
                      <Td>{a === "full" ? <span title={r.description}>{name}{name === settings.regime ? " (active)" : ""}</span> : ""}</Td>
                      <Td>{a}</Td>
                      <Td align="right">{p.compute_hours_per_10k_rows}</Td>
                      <Td align="right">{p.engineer_hours}</Td>
                      <Td align="right">{p.validation_hours}</Td>
                      <Td align="right">{(p.incident_probability * 100).toFixed(1)}%</Td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </Table>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            {pricing.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
