# Methodology and assumptions

This document defines exactly what the code computes. Symbols refer to `Settings` fields in `config.py`.

## 1. Stream protocol (prequential)

The stream is replayed in source order. Rows `0 … initial_size-1` train the initial model. After that, each batch of
`batch_size` rows goes through four steps:

1. **Predict** every row with the active model.
2. **Reveal labels.** Row *i* ever receives a label with probability `label_fraction`. This is decided by a
   seeded draw, so it is identical for every policy. A label becomes available `label_delay_batches` batches later.
3. **Monitor** using only revealed labels.
4. **Decide.** Learning or updating happens only through an action; the new model serves from the next batch.

Benchmark accuracy scores every prediction against its true label offline. Online decisions use revealed labels only.

## 2. Monitoring (L1)

| Signal | Definition |
|---|---|
| Batch metrics | Accuracy and macro precision, recall and F1 on labels revealed in the batch |
| Rolling error | Mean of the last `rolling_window` revealed errors, with a Wilson 95% interval |
| Reference error | Expected error of the active model when deployed: its chronological hold-out error (initial model: 80/20 split of the initial window) |
| Degradation | Rolling error − reference error |
| ADWIN | Bifet & Gavaldà (2007) cut test on the 0/1 error stream: ε = √(2·m·σ²·ln(2 ln n/δ)) + (2/3)·m·ln(2 ln n/δ), with m = 1/(n₀−5+1) + 1/(n₁−5+1), `adwin_delta` = δ. The exact window is capped at 5,000 items and checked every 32 items. Only *increases* in error count as alarms. The first row left in the window after a cut is the estimated **change row**. |
| DDM | Gama et al. (2004): warning when p+s > p_min + 2·s_min, drift when p+s > p_min + 3·s_min, after 30 instances. Its alarms match River's `DDM` exactly on the test stream. |
| PSI | For each feature, `psi_bins` quantile bins fixed from the model's training window (constant features get a split at the constant; categorical features use the top 30 values plus "other" and "missing"). PSI = Σ (a−e)·ln(a/e) with +0.5 count smoothing. |
| PSI shift flag | PSI ≥ `psi_threshold` **and** PSI ≥ 3 × noise floor, where the floor is (k−1)(1/n+1/m), the expected PSI under no change. Reliable only when n ≥ 100. |
| Learning debt (staleness) | CUSUM-style D ← max(0, D + Σ(error − reference error)), reset when a model is deployed. Shown in errors and in dollars (× `error_value`). |
| Model age | Batches since update, predictions since update, labels since update, and wall-clock age |

**Covariate shift vs predictive degradation.** The status is *covariate shift only* when PSI flags features but no
label-based signal fires. *Predictive degradation* requires an ADWIN error increase, a DDM drift, or a rolling-error
95% CI lower bound above reference + `degradation_margin`. A PSI alarm is never treated as proof of concept drift. On
the synthetic stream, the abrupt concept flip produces predictive degradation with **no** PSI signal, and the
covariate-only segment produces PSI alarms with no degradation. This is visible in the demo.

**Evaluation trigger** (decision workflow step 1). Shadow evaluation is suggested only when at least `min_evidence`
labels have arrived since the last update and the cooldown has passed, and when at least one of these holds:

* an ADWIN increase;
* a DDM drift;
* sustained degradation;
* learning-debt cost ≥ ½ of the cheapest action cost;
* a covariate shift with `min_evidence` new labels;
* `max_batches_between_evaluations` reached.

## 3. Candidates and chronological shadow evaluation

Let E be the sorted revealed rows and T the incumbent's `trained_until`.

* **Window W**: rows since the ADWIN change row if there are at least 300 of them, otherwise the last `train_window` rows of E.
* **Fresh rows** F = {e ∈ E : e ≥ T}. **Hold-out** H = the last ⌈`validation_fraction`·|W|⌉ rows of F (halved if F is short; at least 20).
* **Full candidate**: new preprocessing and a new `SGDClassifier(log_loss)` fitted on W ∩ {e < min H}.
* **Partial candidate**: a deep copy of the incumbent with one `partial_fit` pass over F ∩ {e < min H}, preprocessing frozen.
  It is incompatible if a label class is unseen or the schema lost columns.
* The incumbent and both candidates are scored on H. No model has seen H.
  The **paired** per-row error difference gives the reduction r̂, its standard error
  se = max(sd/√n, 0.5/n), and a 95% CI.

The candidate that is later promoted is this exact object. Its hold-out error becomes the new reference error.

## 4. Economic decision engine (L2)

For action a ∈ {partial, full}, with defer as the zero reference:

```
expected reduction   ρ_a = r̂_a × f                          (f = realisation factor)
expected benefit     B_a = ρ_a × H_pred × v                   (H_pred = horizon_predictions, v = error_value)
benefit std. error   σ_a = se_a × f × H_pred × v
total action cost    C_a = compute + engineering + validation + deployment_risk
net expected value   N_a = B_a − C_a
confidence           P(N_a > 0) = Φ(N_a / σ_a)
```

**Cost items** (`economics.action_costs`, profiles in `pricing_snapshot.json`):

* compute = hours_per_10k_rows × max(0.25, rows/10,000) × instance $/h × cost-trace multiplier(batch)
* engineering = engineer_hours × `engineer_hourly_rate`
* validation = validation_hours × `engineer_hourly_rate`
* deployment_risk = incident_probability × `incident_cost` (an *expected* cost)

Shadow evaluation is priced with the `evaluation` profile and charged when the evaluation runs. After that it is sunk,
so it does not change the ranking, but it does count in total cost of ownership and against the budget.

| Regime | Instance (assumed $/h) | Full: eng h / val h / P(incident) | Partial | Evaluation |
|---|---|---|---|---|
| cheap | aws_m5_large ($0.096) | 0.25 / 0.25 / 1% | 0.05 / 0.10 / 0.5% | compute only |
| balanced | aws_m5_xlarge ($0.192) | 1.0 / 0.5 / 3% | 0.25 / 0.25 / 1% | + 0.05 eng h |
| expensive | aws_p3_2xlarge ($3.06) | 4.0 / 2.0 / 8% | 1.0 / 1.0 / 3% | + 0.25 eng h |

With defaults ($80/h, $1,000 per incident, 3,000 training rows), a full retrain costs about $50 (cheap),
$150 (balanced) or $572 (expensive).

**Cost traces** (`cost_trace_kind`) are deterministic per seed and shared by all policies:

* flat: 1;
* diurnal: 1 + 0.3·sin(2πb/24) + N(0, 0.05);
* spot-like: an AR(1) log-normal around 0.45 with 5% spikes of ×3;
* custom: a user-supplied list.

All traces are clipped to [0.2, 5].

**Realisation factor** f. After each promotion, the retired model is kept as a counterfactual. On the next
`post_update_window` revealed labels, both models are scored on the same rows. The realised reduction divided by the
shadow-predicted reduction gives a ratio, clipped to [0, 1.5]. Then:

```
f = (w·f₀ + Σ ratios) / (w + n),    f₀ = realization_prior = 0.7,  w = realization_prior_weight = 2
```

The prior below 1 encodes that retraining does **not** guarantee recovery. f moves toward the observed ratios as evidence accumulates.

**Guardrails.** Every non-defer action must pass all of these, otherwise it is infeasible:

1. candidate available / incremental compatibility;
2. hold-out n ≥ `min_evidence`;
3. cooldown: batches since update ≥ `cooldown_batches`;
4. B ≥ `min_benefit`;
5. N > 0;
6. P(N > 0) ≥ `min_confidence`;
7. C ≤ `action_limit`;
8. spent + C ≤ `budget`.

Ranking puts feasible actions first, ordered by N. Defer is always feasible, so when evidence is insufficient or
nothing clears the guardrails, **defer** is recommended. That is the conservative default.

**Sensitivity analysis** re-ranks the same evidence with one assumption changed at a time:

* error value ×0.25 to ×4;
* horizon ×0.5 and ×2;
* each other cost regime;
* realisation factor 0.4 and 1.0.

## 5. Approval, validation and promotion (L4)

`Lifecycle.execute` runs these steps in order:

1. Check that the decision is still pending and matches the current position, version and settings hash.
2. Require explicit approval (manual mode) or the bounded-autonomy limits: autonomy on, fewer than
   `autonomy_max_actions` actions, and cost ≤ `autonomy_max_cost`.
3. Insert a UNIQUE approval row, so a second click fails.
4. Re-check the guardrails with the current spend.
5. Verify the candidate artifact's SHA-256.
6. Recompute the hold-out comparison from stored data and apply the **validation gate**: hold-out error strictly below
   the incumbent's, macro-F1 not lower by more than `f1_tolerance`, and n ≥ `min_evidence`.
7. Promote: write `model_vNNN.joblib`, archive the previous version, reset the monitors with the new reference
   error and PSI bins, and start post-update tracking. If the gate fails, register the candidate as `rejected`.

Rollback restores an archived version after explicit approval and verifies its checksum.

## 6. Benchmark policies

| Policy | Rule | Budget | Validation |
|---|---|---|---|
| never | keep the initial model | – | – |
| calendar | full retrain on the last `train_window` revealed rows every `calendar_every_batches` (10) batches | not enforced; violations counted | none |
| drift_triggered | full retrain on an ADWIN error increase or DDM drift, trained on ADWIN's post-change window (≥ 300 rows) | not enforced; violations counted | none |
| cara_ct_inspired | full retrain when learning-debt cost ≥ current full-retrain cost | enforced | none |
| retrainwise | trigger → shadow evaluation (charged) → rank with guardrails → validation gate | enforced | yes |
| hindsight_oracle | exact DP, see below | reported | n/a |

Baseline retrains also run an 80/20 chronological probe to obtain a reference error for learning-debt tracking.
That probe costs runtime only, not dollars.

### CARA: what was verified and how the baseline differs

The CARA paper (Mahadevan & Mathioudakis, arXiv:2310.04216, v1 2023; journal version in *Knowledge-Based Systems*
293, 2024) was checked on arXiv. It defines a staleness cost from RBF-similarity-weighted 0-1 losses of query batches
against data batches, using a relative cost Ψ̄ (stale model vs fresh model). The retraining cost κ is fixed, in
staleness units. It proposes **Cara-T** (retrain when Ψ̄ ≥ τ), **Cara-CT** (retrain when the cumulative Ψ̄ since the
last retrain ≥ τ_cum; CUSUM-inspired) and **Cara-P** (periodic). Thresholds are tuned offline by dual annealing on an
offline cost matrix, and the Oracle is a DP over that matrix.

`cara_ct_inspired` is **not** an exact re-implementation. The differences are:

* it uses labelled excess 0-1 errors relative to the post-retrain reference error, not query-similarity-weighted losses;
* the threshold is the current full-retrain dollar cost, with no offline tuning;
* costs vary with the cost trace instead of a fixed κ;
* the learner is linear SGD, not a Random Forest.

### Constrained hindsight oracle

**Action space:** at evenly spaced checkpoints (at most `oracle_max_checkpoints` = 60; every batch on standard
streams), keep the current model or fully retrain on the most recent `train_window`, ⌊`train_window`/3⌋ or
⌊`train_window`/6⌋ revealed rows (minimum 300). Labels are revealed exactly as in the online policies.

**Objective:** minimise the realised prediction-error cost over the whole stream (using all future labels, i.e. hindsight)
plus full-retrain action costs from the same cost trace.

**Solution:** exact dynamic programming over (checkpoint, window) nodes, since a full retrain makes the model
independent of earlier choices. The oracle is optimal **only within this space**. It excludes partial updates and
evaluation overhead and does not enforce the budget (violations are reported). Online policies with partial updates
could in principle beat it, although none did in the submitted results.

## 7. Metrics reported

* Prequential accuracy and macro-F1 over all scored rows.
* Full and partial update counts, evaluations, validation rejections, and guardrail-blocked updates or evaluations.
* Budget violations.
* Itemised operational spend (compute, engineering, validation, deployment risk, evaluation).
* Error cost = errors × `error_value`.
* **TCO** = operational spend + error cost.
* Runtime and decision time per run.
* Mean and standard deviation over seeds, and the percentage gap to the best online policy in each cell.

## 8. Key assumptions and their consequences

* Dollar values are assumptions. Conclusions concern **relative** behaviour under the stated cost model, not real savings.
* The benefit assumes the hold-out error difference persists over the horizon, discounted by f.
  Under recurring drift this can over- or under-state the value.
* In benchmarks, the horizon is capped at the remaining stream length. This uses the known stream length, not labels.
* Real-data ordering: Electricity is chronological; Airlines and Covertype are ordered replays (see DATASETS.md).
