import { Chart } from "@/components/charts";
import { ActionForm, AutoRefresh, QuerySelect, Submit } from "@/components/client";
import { Badge, DataTable, Header } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { REGIMES, SAMPLE_SIZES } from "@/lib/config";
import { DATASETS, isCached } from "@/lib/datasets";
import { POLICIES, POLICY_LABELS, type Policy } from "@/lib/experiments";
import { money, num, type Tone } from "@/lib/format";
import { listJobs, recover } from "@/lib/jobs";
import { lifecycle } from "@/lib/lifecycle";
import { listResultSets, loadResultSet } from "@/lib/results";
import { cancelJobAction, submitJobAction } from "../actions";

const POLICY_COLORS: Record<Policy, string> = { retrainwise: "#2a78d6", calendar: "#eb6834", drift_triggered: "#1baf7a",
  cara_ct_inspired: "#eda100", never: "#e87ba4", hindsight_oracle: "#008300" };
const JOB_TONES: Record<string, Tone> = { completed: "good", running: "info", queued: "info", failed: "bad", cancelled: "warn",
  interrupted: "warn" };

export default async function Experiments({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser();
  const db = lifecycle().db;
  recover(db);
  const jobs = listJobs(db, 6);
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  const cached = DATASETS.filter(isCached);
  const missing = DATASETS.filter((d) => !isCached(d));
  const sets = listResultSets();
  const params = await searchParams;
  const chosen = sets.find((s) => s.prefix === params.set) ?? sets.find((s) => s.prefix === "results") ?? sets[0];
  const loaded = chosen ? loadResultSet(chosen) : null;
  const agg = loaded?.aggregate ?? [];
  const cells = [...new Set(agg.map((r) => `${r.dataset} · ${r.regime}`))];
  const presentPolicies = POLICIES.filter((p) => agg.some((r) => r.policy === p));
  const chartRows = cells.map((cell) => {
    const row: Record<string, unknown> = { cell };
    for (const p of presentPolicies) {
      const r = agg.find((a) => `${a.dataset} · ${a.regime}` === cell && a.policy === p);
      row[p] = r?.total_cost_mean ?? null;
      row[`${p}_std`] = r?.total_cost_std ?? 0;
    }
    return row;
  });
  return (
    <>
      <Header title="Experiments" subtitle="Compare six policies on identical streams and cost traces. Jobs run in the background." />
      <AutoRefresh active={active} />
      <ActionForm action={submitJobAction} className="card stack">
        <div className="form-grid">
          <label>Datasets
            <select name="datasets" multiple defaultValue={["synthetic"]}>{cached.map((d) => <option key={d}>{d}</option>)}</select>
          </label>
          <label>Policies
            <select name="policies" multiple defaultValue={[...POLICIES]}>
              {POLICIES.map((p) => <option key={p} value={p}>{POLICY_LABELS[p]}</option>)}
            </select>
          </label>
          <label>Cost regimes
            <select name="regimes" multiple defaultValue={["balanced"]}>{REGIMES.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <div className="stack">
            <label>Sample configuration
              <select name="size" defaultValue="small">
                {Object.entries(SAMPLE_SIZES).map(([s, n]) => (
                  <option key={s} value={s}>{n ? `${s} (${n.toLocaleString("en-US")} rows)` : `${s} (all rows)`}</option>
                ))}
              </select>
            </label>
            <label>Seeds (comma-separated)<input name="seeds" defaultValue="1,2" /></label>
          </div>
        </div>
        <p className="muted">Hold Ctrl/⌘ to select several items.{missing.length ? ` Not cached (download in Data and simulation): ${missing.join(", ")}.` : ""}</p>
        <div><Submit pendingText="Submitting…">Start benchmark job</Submit></div>
      </ActionForm>
      <h2>Jobs</h2>
      {!jobs.length ? <p className="muted">No jobs yet.</p> : jobs.map((j) => (
        <div key={j.id} className="card stack" style={{ marginBottom: 8 }}>
          <div className="row">
            <code>{j.id}</code> <Badge tone={JOB_TONES[j.status] ?? "info"}>{j.status}</Badge>
            <span className="muted">{j.payload.datasets.join(", ")} · {j.payload.size} · seeds {j.payload.seeds.join(", ")} ·{" "}
              {j.payload.regimes.join(", ")} · {j.payload.policies.length} policies</span>
          </div>
          {j.status === "queued" || j.status === "running" ? (
            <>
              <div className="progress"><div style={{ width: `${Math.round(100 * (j.progress || 0))}%` }} /></div>
              <div className="row">
                <span className="muted">{j.message}</span><span className="spacer" />
                <ActionForm action={cancelJobAction}><input type="hidden" name="job_id" value={j.id} />
                  <Submit className="danger" pendingText="Cancelling…">Cancel</Submit></ActionForm>
              </div>
            </>
          ) : j.status === "completed" && j.result ? (
            <span className="muted">{j.result.runs} runs in {j.result.wall_seconds.toFixed(0)}s →{" "}
              <a href={`?set=${j.result.prefix}`}>{j.result.prefix}</a></span>
          ) : j.error ? <span className="muted">{j.error.split("\n")[0].slice(0, 300)}</span> : null}
        </div>
      ))}
      <h2>Saved comparisons</h2>
      {!chosen || !loaded ? <p className="muted">No exported results yet.</p> : (
        <>
          <div style={{ maxWidth: 480 }}>
            <QuerySelect name="set" label="Result set" value={chosen.prefix}
              options={sets.map((s) => [s.prefix, `${s.prefix} (${s.source})`])} />
          </div>
          <p className="muted">{loaded.summary.length} runs · datasets {[...new Set(loaded.summary.map((r) => r.dataset))].join(", ")} ·
            seeds {[...new Set(loaded.summary.map((r) => r.seed))].join(", ")} · size {loaded.summary[0]?.size} · costs are
            simulated USD{chosen.source !== "this app" ? " · produced by the original Python research prototype" : ""}</p>
          <Chart title="Mean total cost of ownership (± std over seeds); lower is better" data={chartRows} x="cell" money
            height={380} series={presentPolicies.map((p) => ({ key: p, name: POLICY_LABELS[p], color: POLICY_COLORS[p], kind: "bar",
              errorKey: `${p}_std` }))} />
          <DataTable rows={agg.map((r) => ({ dataset: r.dataset, regime: r.regime, policy: POLICY_LABELS[r.policy as Policy] ?? r.policy,
            seeds: r.seeds, accuracy: num(r.accuracy_mean, 4), macro_f1: num(r.macro_f1_mean, 4),
            full_updates: num(r.full_updates_mean, 1), partial_updates: num(r.partial_updates_mean, 1),
            evaluations: num(r.evaluations_mean, 1), rejected: num(r.rejected_actions_mean, 1), blocked: num(r.blocked_actions_mean, 1),
            budget_violations: num(r.budget_violations_mean, 1), operational_cost: money(r.operational_cost_mean),
            error_cost: money(r.error_cost_mean), total_cost: money(r.total_cost_mean), total_cost_std: money(r.total_cost_std),
            "TCO vs best online": r.tco_vs_best_online_pct === null ? "—" : `${num(r.tco_vs_best_online_pct, 1)}%` }))} />
          <p className="row" style={{ marginTop: 10 }}>
            {chosen.files.filter((f) => /\.(csv|json|png)$/.test(f)).map((f) => (
              <a key={f} className="button" href={`/api/results?set=${encodeURIComponent(chosen.prefix)}&file=${encodeURIComponent(f)}`}>
                ⬇ {f}</a>
            ))}
          </p>
        </>
      )}
    </>
  );
}
