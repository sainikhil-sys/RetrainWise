import type { ReactNode } from "react";
import { describeMail, isConfigured, mailProblems } from "@/lib/auth/mail";
import { auth } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  const cfg = auth().mail;
  return (
    <main className="auth">
      <div className="card">
        <div className="brand"><span aria-hidden>♻️</span> RetrainWise</div>
        {children}
        {!isConfigured(cfg) ? (
          <div className="alert warn">
            Email delivery is not configured, so verification and reset codes cannot be sent. Set SMTP_HOST,
            SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM in <code>.env</code> (see <code>.env.example</code>) and
            restart.{cfg.devCodes ? " Development codes are shown on screen instead." : ""}
          </div>
        ) : (
          mailProblems(cfg).map((p) => <p key={p} className="muted">⚠ Mail configuration: {p}</p>)
        )}
        {isConfigured(cfg) ? <p className="muted" style={{ marginTop: 14 }}>Mail: {describeMail(cfg)}</p> : null}
      </div>
    </main>
  );
}
