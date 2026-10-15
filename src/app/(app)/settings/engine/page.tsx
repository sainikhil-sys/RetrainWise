import type { Metadata } from "next";

import { Callout } from "@/components/rw";
import { requirePage } from "@/lib/authz";
import { money } from "@/lib/format";
import { OPERATOR_SETTINGS, can } from "@/lib/permissions";
import { getSettings } from "@/lib/queries";
import { SETTINGS_GROUPS } from "@/lib/settings-meta";
import { EngineSettingsForm } from "../_components/engine-form";

export const metadata: Metadata = { title: "Engine settings" };
export const dynamic = "force-dynamic";

export default async function EngineSettingsPage() {
  const ctx = await requirePage("/settings/engine");
  const settings = await getSettings(ctx.workspace.id);
  const all = SETTINGS_GROUPS.flatMap((g) => g.fields.map((f) => f.key as string));
  const editable = can(ctx.role, "settings.engine") ? all : can(ctx.role, "stream.configure") ? all.filter((k) => OPERATOR_SETTINGS.has(k)) : [];

  return (
    <>
      <p className="mb-6 max-w-2xl text-[13.5px] leading-relaxed text-ink-2">
        Every value is validated here and again by the engine before it is stored. Operators can change stream settings; costs, budgets, guardrails, probe scheduling, the agent and autonomy need an admin.
      </p>
      {settings.autonomy && (
        <Callout tone="warn" title="Bounded autonomy is on" className="mb-8">
          The engine may carry out the top-ranked action without a click, at most {settings.autonomy_max_actions} per stream and {money(settings.autonomy_max_cost)} each, and only when every guardrail and the validation gate pass. The agent and operators still cannot approve anything.
        </Callout>
      )}
      <EngineSettingsForm settings={settings} editable={editable} canReset={can(ctx.role, "settings.engine")} />
    </>
  );
}
