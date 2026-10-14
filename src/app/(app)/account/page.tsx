import { ActionForm, Submit } from "@/components/client";
import { Header } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { changePasswordAction } from "../actions";

export default async function Account() {
  const user = await requireUser();
  return (
    <>
      <Header title="Account" subtitle="Your sign-in details. Approvals and rollbacks are recorded under this email." />
      <div className="card stack" style={{ maxWidth: 520 }}>
        <div><strong>{user.name}</strong></div>
        <div className="muted">{user.email} · member since {user.created.slice(0, 10)}
          {user.last_login ? ` · last sign-in ${user.last_login.replace("T", " ").slice(0, 16)} UTC` : ""}</div>
      </div>
      <h2>Change password</h2>
      <ActionForm action={changePasswordAction} className="card stack">
        <div style={{ maxWidth: 420 }} className="stack">
          <label>Current password<input name="current" type="password" autoComplete="current-password" required /></label>
          <label>New password<input name="password" type="password" autoComplete="new-password" required minLength={8} /></label>
          <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" required /></label>
        </div>
        <div><Submit pendingText="Updating…">Update password</Submit></div>
      </ActionForm>
    </>
  );
}
