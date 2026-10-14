import { ActionForm, Submit } from "@/components/client";
import { Header, Json } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { COST_TRACE_KINDS, REGIMES, type Settings } from "@/lib/config";
import { pricing } from "@/lib/economics";
import { lifecycle } from "@/lib/lifecycle";
import { resetSettingsAction, saveSettingsAction } from "../actions";

type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];

function Num({ s, k, label, min, max, step }: { s: Settings; k: NumKey; label: string; min?: number; max?: number;
  step?: number | "any" }) {
  return <label>{label}<input name={k} type="number" defaultValue={s[k]} min={min} max={max} step={step ?? "any"} required /></label>;
}

export default async function SettingsPage() {
  await requireUser();
  const s = lifecycle().settings();
  return (
    <>
      <Header title="Settings" subtitle="Economic assumptions, guardrails, monitoring windows, model parameters, agent and autonomy." />
      <ActionForm action={saveSettingsAction}>
        <fieldset>
          <legend>Economics (assumed USD)</legend>
          <div className="form-grid">
            <label>Cost regime<select name="regime" defaultValue={s.regime}>{REGIMES.map((r) => <option key={r}>{r}</option>)}</select></label>
            <Num s={s} k="error_value" label="Value of avoiding one error ($)" min={0} />
            <Num s={s} k="horizon_predictions" label="Decision horizon (predictions)" min={1} step={1} />
            <label>Compute price trace
              <select name="cost_trace_kind" defaultValue={s.cost_trace_kind}>{COST_TRACE_KINDS.map((k) => <option key={k}>{k}</option>)}</select>
            </label>
            <Num s={s} k="engineer_hourly_rate" label="Engineer hourly rate ($)" min={0} />
            <Num s={s} k="incident_cost" label="Incident cost ($)" min={0} />
            <label>Custom trace multipliers<input name="cost_trace_custom" defaultValue={s.cost_trace_custom.join(",")} /></label>
            <Num s={s} k="realization_prior" label="Realisation prior" min={0} max={1.5} />
          </div>
        </fieldset>
        <fieldset>
          <legend>Guardrails</legend>
          <div className="form-grid">
            <Num s={s} k="budget" label="Cumulative budget ($)" min={0} />
            <Num s={s} k="action_limit" label="Per-action spending limit ($)" min={0} />
            <Num s={s} k="min_benefit" label="Minimum expected benefit ($)" min={0} />
            <Num s={s} k="min_confidence" label="Required P(net > 0)" min={0.5} max={0.99} step={0.01} />
            <Num s={s} k="min_evidence" label="Minimum hold-out labels" min={1} step={1} />
            <Num s={s} k="cooldown_batches" label="Cooldown (batches)" min={0} step={1} />
            <Num s={s} k="max_batches_between_evaluations" label="Max batches between evaluations" min={1} step={1} />
            <Num s={s} k="f1_tolerance" label="Validation macro-F1 tolerance" min={0} max={0.5} />
          </div>
        </fieldset>
        <fieldset>
          <legend>Monitoring</legend>
          <div className="form-grid">
            <Num s={s} k="rolling_window" label="Rolling window (labels)" min={10} step={1} />
            <Num s={s} k="psi_threshold" label="PSI threshold" min={0.01} max={5} />
            <Num s={s} k="psi_bins" label="PSI bins" min={2} max={50} step={1} />
            <Num s={s} k="adwin_delta" label="ADWIN delta" min={0.000001} max={0.5} />
            <Num s={s} k="degradation_margin" label="Degradation margin" min={0} max={1} />
            <Num s={s} k="ddm_min_instances" label="DDM minimum instances" min={1} step={1} />
          </div>
        </fieldset>
        <fieldset>
          <legend>Stream and model (apply to new runs; batch size and labels apply immediately)</legend>
          <div className="form-grid">
            <Num s={s} k="batch_size" label="Batch size" min={10} max={100000} step={1} />
            <Num s={s} k="initial_size" label="Initial training rows" min={50} step={1} />
            <Num s={s} k="train_window" label="Full-retrain window (rows)" min={100} step={1} />
            <Num s={s} k="label_delay_batches" label="Label delay (batches)" min={0} max={100} step={1} />
            <Num s={s} k="label_fraction" label="Label availability" min={0.01} max={1} />
            <Num s={s} k="validation_fraction" label="Hold-out fraction" min={0.05} max={0.6} />
            <Num s={s} k="sgd_alpha" label="SGD alpha" min={0.0000001} max={1} />
            <Num s={s} k="sgd_epochs" label="SGD epochs" min={1} max={200} step={1} />
            <Num s={s} k="post_update_window" label="Post-update window (labels)" min={10} step={1} />
            <Num s={s} k="seed" label="Seed" min={0} step={1} />
          </div>
        </fieldset>
        <fieldset>
          <legend>Agent and autonomy</legend>
          <div className="form-grid">
            <label>Default explanation mode
              <select name="agent_mode" defaultValue={s.agent_mode}>
                <option value="deterministic">deterministic</option><option value="ollama">ollama</option>
              </select>
            </label>
            <label>Ollama model tag<input name="ollama_model" defaultValue={s.ollama_model} maxLength={80} /></label>
            <Num s={s} k="agent_max_iterations" label="Agent max iterations" min={1} max={12} step={1} />
            <Num s={s} k="agent_timeout_seconds" label="Agent time budget (s)" min={5} max={600} step={1} />
            <label className="inline"><input type="checkbox" name="autonomy" defaultChecked={s.autonomy} /> Bounded autonomy (opt-in)</label>
            <Num s={s} k="autonomy_max_actions" label="Max autonomous actions per run" min={0} max={100} step={1} />
            <Num s={s} k="autonomy_max_cost" label="Max autonomous action cost ($)" min={0} />
          </div>
          <p className="muted">When bounded autonomy is on, a batch that triggers evaluation may execute the top action
            automatically if every guardrail and the limits above pass.</p>
        </fieldset>
        <Submit pendingText="Saving…">Save settings</Submit>
      </ActionForm>
      <div className="row" style={{ marginTop: 14 }}>
        <ActionForm action={resetSettingsAction} confirm="Restore all settings to their defaults?">
          <Submit className="" pendingText="Restoring…">Reset to defaults</Submit>
        </ActionForm>
        <a className="button" href="/api/settings">Export settings JSON</a>
      </div>
      <details>
        <summary>Pricing snapshot (assumed reference prices)</summary>
        <Json value={pricing()} />
      </details>
    </>
  );
}
