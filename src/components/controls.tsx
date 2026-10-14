import { processBatchesAction } from "@/app/(app)/actions";
import type { Run } from "@/lib/lifecycle";
import { ActionForm, Submit } from "./client";

/** "Process N batches" control for the active run. */
export function ProcessControls({ run }: { run: Run }) {
  if (run.position >= run.n_rows) return <div className="alert good">End of stream reached. Start a new run to continue.</div>;
  return (
    <ActionForm action={processBatchesAction} className="row">
      <label className="inline">Batches to process <input name="n" type="number" min={1} max={40} defaultValue={1}
        style={{ width: 80 }} /></label>
      <Submit pendingText="Predicting, revealing labels, updating monitors…">▶ Process batches</Submit>
    </ActionForm>
  );
}
