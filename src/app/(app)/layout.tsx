import type { ReactNode } from "react";
import { NavLinks } from "@/components/client";
import { Badge } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { money, version } from "@/lib/format";
import { lifecycle } from "@/lib/lifecycle";
import { signOutAction } from "../(auth)/actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const life = lifecycle();
  const cfg = life.settings();
  const run = life.activeRun();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span aria-hidden>♻️</span>
          <div>RetrainWise<small>Lifecycle-aware cost-benefit training decisions</small></div>
        </div>
        <NavLinks />
        <div className="divider" />
        {run ? (
          <div className="stack" style={{ gap: 6, fontSize: "0.88rem" }}>
            <div><strong>Active run</strong> <code>{run.id}</code></div>
            <div className="muted">{run.dataset} · {run.size_label} · seed {run.seed}</div>
            <div className="progress" aria-label="Stream progress">
              <div style={{ width: `${Math.min(100, (100 * run.position) / run.n_rows)}%` }} />
            </div>
            <div className="muted">row {run.position.toLocaleString("en-US")} / {run.n_rows.toLocaleString("en-US")}</div>
            <div>Model <strong>{version(run.active_version)}</strong> · spent {money(run.spent)} of {money(cfg.budget)}</div>
          </div>
        ) : (
          <p className="muted">No active run. Start one in <em>Data and simulation</em>.</p>
        )}
        <div>{cfg.autonomy ? <Badge tone="warn">Bounded autonomy ON</Badge> : <Badge tone="good">Recommendation-only</Badge>}</div>
        <div className="divider" />
        <div style={{ fontSize: "0.88rem" }}>
          Signed in as <strong>{user.name}</strong>
          <div className="muted"><code>{user.email}</code></div>
        </div>
        <form action={signOutAction}><button type="submit" style={{ width: "100%" }}>Sign out</button></form>
        <p className="muted" style={{ fontSize: "0.78rem" }}>
          Model training, predictions and metrics are real. Prices, engineer hours and deployment risk are
          <strong> simulated assumptions</strong>; deployment is a local registry swap (simulated).
        </p>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
