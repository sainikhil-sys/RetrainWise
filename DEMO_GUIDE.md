# Demonstration guide (about 10 minutes, fully offline)

This script walks the required flow:

**select data → process batches → inspect monitoring → obtain a recommendation → approve an update →
validate and promote or reject → inspect registry and audit → run a benchmark → export results**

The walkthrough numbers below were produced with seed 42 on 2026-10-12 (with the earlier Streamlit interface, which the
Next.js dashboard replaced; the engine and its numbers are unchanged). Other seeds or settings give different numbers.

## 0. Start

Run `npm install`, `npm run setup:python` (once) and `npm run dev`, then open <http://localhost:3000>.
For a clean start, stop the app and delete `engine/retrainwise.db*` and `engine/model_v*.joblib`.

## 1. Select data

* **Overview → Start offline demo (synthetic drift stream)** creates run *synthetic · standard · seed 42*
  (20,000 rows) and trains `v001` on rows 0–999.
* Alternatively, open **Data & simulation**, choose a dataset, size and seed, then **Start stream**. This tab shows the
  provenance record, the schema preview and the synthetic drift points (abrupt at 4,000, gradual 8,000–12,000,
  recurring at 14,000, covariate-only from 17,000).

## 2. Process batches

On **Data & simulation**, set *Batches to process* to **9** and press **Process 9 batches**. The stream passes the abrupt
drift at row 4,000. Pressing the button twice cannot double-process: every call carries the expected stream position.

## 3. Inspect monitoring

Open **Monitoring**. The status badges read **predictive degradation**, *no covariate signal*, and *predictive signal*.
The rolling error rises from about 0.12 to 0.6 while the PSI heatmap stays quiet. This is concept drift without
covariate shift. The *Detectors & staleness* tab shows ADWIN and DDM alarms and growing learning debt.
*Labels & reference* shows the fixed PSI bins of the training window.

## 4. Obtain a recommendation

Open **Decision analysis** and press **Evaluate update options**. In the walkthrough:

* ADWIN placed the change point at **row 4,000** (the true drift point), so full retraining used the post-change window.
* Hold-out error was 0.656 for the incumbent and 0.144 for the full candidate, on 450 labels.
* The recommendation was **Full retraining**: expected benefit $1,788.89, cost $150.01, net $1,638.87, P(net>0) = 1.00.
* Shadow evaluation overhead charged: $4.02.

Review the itemised cost bars, benefit intervals, the guardrail table, the sensitivity table and the what-if explorer.

## 5. Approve the update

Open **Model lifecycle**.

1. Press **Approve and execute** without a name or without ticking the box. The form refuses ("Tick the box to confirm your approval.").
2. Enter an approver name, tick the approval box and execute.
3. The guardrails are re-checked, the artifact checksum is verified, and the hold-out comparison is recomputed.
   The outcome is **promoted as v002**.
4. A second execution of the same decision is refused: "Decision already promoted".

## 6. Watch the result, and reject or promote again

* Process about 6 more batches. *Post-update monitoring* compares v002 with the retired v001 on new labels.
  After 500 labels, the realised reduction updates the realisation factor (0.70 → 0.82 in the walkthrough).
* Evaluate again at row 8,500 (gradual drift and the new category `west`):
  * Full retraining: net $4.17, P = 0.54. **Blocked by the confidence guardrail.**
  * Partial update: net $45.22, P = 0.82. **Recommended.**

  Approving the partial update promoted **v003**, a genuine `partial_fit` update.
* **Rollback**: choose v002, give a reason, tick approval, and press **Roll back**. The registry shows v003 as `rolled_back`.
* To see a validation rejection, approve an action that is blocked by guardrails (for example *Full retraining* above).
  The outcome is *rejected: blocked by guardrails*. Validation-gate rejections also occur in the benchmarks
  (13 across the RetrainWise runs).

## 7. Inspect registry and audit

* **Model lifecycle → Registry** lists versions, artifacts, SHA-256 prefixes, training intervals, reference errors and approvers.
* **Agent & audit**:
  * Generate a **deterministic** explanation (labelled "no language model used"), with its tool evidence table.
  * Optionally switch to **Local Ollama** (for example `llama3.1:latest`). The agent can only read evidence and *prepare* requests.
  * Filter the audit log by event kind and export it as JSON.

## 8. Run a benchmark and export results

Open **Experiments** and keep the defaults (synthetic, all six policies, balanced, small, seeds 1,2). Press
**Start benchmark**. A worker process runs 12 runs (about 17 seconds in the walkthrough) while the panel shows
progress, with a **Cancel** button.

Then choose a result set under *Results*. The submission set `results` has 216 runs. Use the
**Summary CSV / Aggregate CSV / Details JSON** buttons.

## 9. Restart test

Stop `npm run dev` and start it again. The active run, position, active model version, spend, decisions and audit log
are all restored from SQLite. Any job or execution that was in flight is marked `interrupted`; nothing is silently resumed.
