# RetrainWise: a lifecycle-aware agent for cost-benefit training decisions

**Research report.** All numbers come from `results_*.csv` / `results_full_*.csv` produced by
`experiments.py` (now in `engine/`) on 2026-10-12. Dollar figures are **simulated** under the assumed cost model in
`pricing_snapshot.json`. They show relative behaviour, not real savings.

## Abstract

Retraining a deployed model is an economic decision, but common practice treats it as a technical trigger: a
calendar schedule or a drift alarm. RetrainWise monitors a deployed classifier and recommends full retraining, a partial
(incremental) update, or deferring. It estimates the error-rate reduction of each update by chronological shadow
evaluation, scales that estimate by a realisation factor learned from measured post-update outcomes, and prices each
action with an itemised cost model (compute, engineering, validation, expected deployment risk). It ranks actions by net
expected value under eight guardrails, explains the result with an optional local LLM (or a deterministic explainer),
and executes only approved actions that pass a validation gate.

We compared RetrainWise with never-retrain, calendar, drift-triggered and CARA-CT-inspired policies and a constrained
hindsight oracle. The comparison covered three real streams (Electricity, Airlines, Covertype) and a synthetic drift
stream, with 3 seeds and 3 cost regimes (216 runs). RetrainWise had the lowest mean total cost of ownership (TCO) among
the five online policies in **6 of 12** dataset × regime cells and the best mean rank (1.92 of 5). It did not win on
Electricity in any regime, and it lost in the expensive regime on two of the three real datasets. There, shadow
evaluation overhead was 34% of its spending. On complete datasets (1 seed), it was the best online policy on
Electricity and Airlines but was budget-capped on Covertype.

## 1. Introduction and problem

The proposal (RetrainWise Project Description, Sections 1–3) asks a practical question: *is it worth paying, now, to
retrain this model?* Two phenomena degrade deployed models:

* **covariate drift**, a change in P(X);
* **concept drift**, a change in P(Y|X).

Detectors such as ADWIN and DDM signal *that* something changed, not whether acting pays (Gama et al., 2014).
RetrainWise makes the decision explicit, auditable and cost-aware, and keeps a human (or a bounded policy) in control.

## 2. Related work (references verified on 2026-10-12)

Each reference was checked online. Corrections to the proposal's bibliography are noted in the reference list.

* **Drift detection.** ADWIN (Bifet & Gavaldà, 2007) and DDM (Gama et al., 2004) are surveyed by Gama et al. (2014).
  They have no cost model. RetrainWise uses them only as *triggers for evaluation* and as evidence.
* **Cost-sensitive adaptation.** Žliobaitė, Budka & Stahl (2015) frame updating as a question of utility.
  Mahadevan & Mathioudakis (2023, arXiv:2310.04216; journal version 2024 in *Knowledge-Based Systems* 293:111610) propose
  **CARA**, which trades staleness cost against retraining cost κ. CARA has three variants: threshold (Cara-T),
  cumulative threshold (Cara-CT) and periodic (Cara-P). Thresholds are tuned offline on a cost matrix, and the authors
  report costs close to a dynamic-programming oracle on Electricity, Airlines and Covertype.
  Hoffman et al. (2024, arXiv:2405.13926) and Regol et al. (2025, ICML) study decision-theoretic and learned refit
  timing. Katz (2026, arXiv:2604.06438) tracks "posterior learning debt". The proposal cites this work under a different
  title, which we could not find.
* **Forecasting operations.** Spiliotis & Petropoulos (2024) and Zanotti (2025) show that less frequent updates can
  preserve accuracy at lower cost.
* **MLOps and agents.** Kreuzberger et al. (2023) describe MLOps automation, where triggers remain thresholds or
  schedules. DriftGuard (Alam et al., 2026) and Katalay et al. (2025) add drift localisation and multi-criteria
  triggers. AIDE (Jiang et al., 2025), MLAgentBench (Huang et al., 2024) and ArchPilot (Yuan et al., 2025) automate
  *model development*, not lifecycle economics. Liu et al. (2024) field-tested an LLM agent for network lifecycle
  management.

## 3. Method (details in METHODOLOGY.md)

1. **Prequential replay.** Predict a batch, reveal labels (with configurable delay and availability), then monitor.
2. **Monitoring.**
   * Fixed-bin PSI with a sampling-noise floor.
   * ADWIN and DDM on 0/1 errors; ADWIN also locates the change row.
   * Rolling error with a Wilson interval.
   * CUSUM learning debt.

   PSI alone is reported as covariate shift. Predictive degradation needs label evidence.
3. **Evaluation trigger.** Shadow evaluation (which is charged) runs only after new labels and a cooldown, and when a
   detector, sustained degradation, enough learning debt, covariate shift or a periodic check calls for it.
4. **Shadow evaluation.** A full candidate is trained on recent rows (the post-change window when one is known), and a
   partial candidate on new rows via `partial_fit`. Both are scored with the incumbent on a chronological hold-out that
   none of them trained on.
5. **Economics.** For each action:
   * benefit = r̂ · f · horizon · value per error;
   * cost = compute + engineering + validation + incident probability × incident cost;
   * net = benefit − cost;
   * P(net > 0) comes from the paired standard error.

   The realisation factor f starts at a prior of 0.7 and is updated from realised versus predicted reductions.
6. **Guardrails, approval and gate.** The eight guardrails are re-checked at execution. Approval is unique per decision.
   Artifact checksums are verified, and the gate requires strictly lower hold-out error with no material F1 loss.
   Rejected candidates are registered as rejected.
7. **Agent.** The agent explains decisions using four read-only tools and can at most *prepare* a request.
   Decisions never depend on the LLM.

## 4. Experimental setup

* **Learner:** `SGDClassifier(log_loss, alpha=1e-4, 15 epochs)` with window-fitted imputation, scaling and one-hot encoding.
* **Stream:** initial window 1,000 rows; batch 500; full-retrain window 3,000; hold-out 30%; label delay 0; all labels available.
* **Economics:** horizon 5,000 predictions; $1 per avoided error; budget $3,000; diurnal compute-price trace.
  Engineers cost $80/h and an incident $1,000 (both assumed).
* **Design (standard):** first 20,000 rows of each stream; seeds 1, 2, 3; regimes cheap, balanced and expensive;
  six policies. That is 216 runs, which took 454 seconds on a laptop CPU.
* **Design (full data):** all rows; seed 1; balanced regime; batch 2,000. That is 18 runs taking 6,409 seconds, of
  which 5,849 seconds was the Covertype oracle.
* **Fairness:** identical streams, label masks and cost traces across policies within a cell. The calendar and
  drift baselines are budget-unaware (violations are counted). The drift baseline retrains on ADWIN's post-change window.
* **Leakage check:** an automated test corrupts all labels after row 3,000 and confirms that every online policy's
  decisions before that row are unchanged.

## 5. Results

### 5.1 Standard streams, balanced regime (mean over 3 seeds)

| Dataset | Policy | Accuracy | Full | Partial | Evals | Ops cost $ | Error cost $ | TCO $ (± sd) | vs best online |
|---|---|---|---|---|---|---|---|---|---|
| airlines | Never retrain | 0.545 | 0.0 | 0.0 | 0.0 | 0 | 8,643 | 8,643 (±318) | +7.8% |
| airlines | Calendar | 0.575 | 3.0 | 0.0 | 0.0 | 450 | 8,082 | 8,532 (±830) | +6.4% |
| airlines | Drift-triggered | 0.615 | 6.3 | 0.0 | 0.0 | 950 | 7,313 | 8,263 (±738) | +3.0% |
| airlines | Cost-aware (CARA-CT-inspired) | 0.589 | 2.7 | 0.0 | 0.0 | 400 | 7,809 | 8,209 (±213) | +2.4% |
| airlines | **RetrainWise** | 0.606 | 1.3 | 4.0 | 31.7 | 527 | 7,493 | **8,020 (±421)** | +0.0% |
| airlines | Hindsight oracle | 0.646 | 3.3 | 0.0 | 0.0 | 500 | 6,722 | 7,222 (±130) | −10.0% |
| covertype | Never retrain | 0.278 | 0.0 | 0.0 | 0.0 | 0 | 13,713 | 13,713 (±266) | +21.0% |
| covertype | Calendar | 0.333 | 3.0 | 0.0 | 0.0 | 450 | 12,665 | 13,115 (±480) | +15.7% |
| covertype | Drift-triggered | 0.557 | 29.0 | 0.0 | 0.0 | 4,350 | 8,410 | 12,760 (±483) | +12.6% |
| covertype | Cost-aware (CARA-CT-inspired) | 0.428 | 4.3 | 0.0 | 0.0 | 650 | 10,872 | 11,522 (±1,299) | +1.6% |
| covertype | **RetrainWise** | 0.481 | 7.0 | 6.7 | 23.3 | 1,477 | 9,859 | **11,336 (±90)** | +0.0% |
| covertype | Hindsight oracle | 0.612 | 8.0 | 0.0 | 0.0 | 1,200 | 7,367 | 8,567 (±232) | −24.4% |
| electricity | Never retrain | 0.728 | 0.0 | 0.0 | 0.0 | 0 | 5,173 | 5,173 (±278) | +23.2% |
| electricity | **Calendar** | 0.803 | 3.0 | 0.0 | 0.0 | 450 | 3,750 | **4,200 (±73)** | +0.0% |
| electricity | Drift-triggered | 0.795 | 34.3 | 0.0 | 0.0 | 5,151 | 3,903 | 9,054 (±275) | +115.6% |
| electricity | Cost-aware (CARA-CT-inspired) | 0.758 | 1.0 | 0.0 | 0.0 | 150 | 4,596 | 4,746 (±387) | +13.0% |
| electricity | RetrainWise | 0.783 | 1.0 | 5.3 | 30.7 | 540 | 4,129 | 4,669 (±543) | +11.2% |
| electricity | Hindsight oracle | 0.817 | 2.0 | 0.0 | 0.0 | 300 | 3,471 | 3,771 (±82) | −10.2% |
| synthetic | Never retrain | 0.619 | 0.0 | 0.0 | 0.0 | 0 | 7,245 | 7,245 (±81) | +51.9% |
| synthetic | Calendar | 0.641 | 3.0 | 0.0 | 0.0 | 450 | 6,814 | 7,264 (±292) | +52.3% |
| synthetic | Drift-triggered | 0.705 | 6.3 | 0.0 | 0.0 | 950 | 5,600 | 6,550 (±1,585) | +37.4% |
| synthetic | Cost-aware (CARA-CT-inspired) | 0.583 | 2.0 | 0.0 | 0.0 | 300 | 7,923 | 8,223 (±1,075) | +72.4% |
| synthetic | **RetrainWise** | 0.784 | 3.0 | 2.7 | 18.3 | 657 | 4,112 | **4,769 (±141)** | +0.0% |
| synthetic | Hindsight oracle | 0.817 | 3.3 | 0.0 | 0.0 | 500 | 3,484 | 3,984 (±140) | −16.5% |

The cheap and expensive regimes are in `results_aggregate.csv`, and `results_chart_tco.png` shows all regimes.

### 5.2 Which online policy had the lowest mean TCO?

| Dataset | cheap | balanced | expensive |
|---|---|---|---|
| synthetic | **RetrainWise** | **RetrainWise** | **RetrainWise** |
| electricity | Calendar (RW +7.5%) | Calendar (RW +11.2%) | Never (RW +6.9%) |
| airlines | **RetrainWise** | **RetrainWise** | CARA-CT-inspired (RW +6.3%) |
| covertype | Drift-triggered (RW +0.3%) | **RetrainWise** | CARA-CT-inspired (RW +12.9%) |

Overall, RetrainWise won 6 of 12 cells, CARA-CT-inspired 2, calendar 2, drift-triggered 1 and never-retrain 1.
The median gap of RetrainWise to the best online policy was +0.17%, and its mean rank was 1.92 of 5 online policies
(next best: CARA-CT-inspired at 2.75). The hindsight oracle was lowest in every cell, as it should be, since it has
hindsight within its action space.

### 5.3 Complete datasets (seed 1, balanced, batch 2,000)

| Dataset (rows) | Never | Calendar | Drift-triggered | CARA-CT-insp. | RetrainWise | Oracle |
|---|---|---|---|---|---|---|
| Electricity (45,312) TCO $ | 13,744 | 12,774 | 14,493 | 12,565 | **11,177** | 10,559 |
| Airlines (539,383) TCO $ | 262,881 | 242,679 | 228,599 | 230,494 | **211,337** | 203,730 |
| Covertype (581,012) TCO $ | 261,571 | 209,372 | **161,316** | 270,189 | 246,710 | 161,076 |

On Covertype, RetrainWise exhausted its $3,000 budget ($2,998 spent), after which 215 update attempts were blocked.
The budget-unaware drift baseline spent $43,354 across 289 retrains, with 270 budget violations. On a 580k-row stream
with frequent drift, a fixed per-run budget is a binding constraint and RetrainWise respects it, as designed. A budget
that scales with stream length would change this result; we did not test that.

### 5.4 Behavioural findings

* **Fewer, cheaper actions.** RetrainWise used partial updates where they were sufficient (for example, 5.3 partial
  versus 1.0 full on Electricity, balanced) and retrained far less often than the drift-triggered policy.
  That policy over-retrained heavily on Electricity: 34 retrains and +116% TCO in the balanced regime.
* **Guardrails acted.** Across the 36 standard RetrainWise runs there were 149 guardrail-blocked updates or evaluations
  and 13 validation-gate rejections, with zero budget violations. The budget-unaware drift baseline had 246 budget violations.
* **Regime sensitivity.** In the expensive regime RetrainWise retrained much less: 0 full updates on Electricity and
  Airlines, versus 1.0 and 1.3 in the balanced regime.
* **Covariate shift is not concept drift.** On the synthetic stream, the abrupt concept change produced predictive
  degradation with no PSI signal. In the covariate-only segment (rows 17,000–20,000, balanced regime):
  * seed 1 deferred at every batch;
  * seeds 2 and 3 made one update at row 17,500 (plausibly still recovering from the recurring concept at 14,000) and then deferred.

  Each of these deferrals followed a *paid* evaluation, triggered by "covariate shift with enough new labels".
  So covariate shift did not cause needless retraining, but it did cause repeated evaluation spending (see §6.1).
* **Realised gains.** Post-update counterfactual checks completed a mean of 6.8 times per standard run. In the UI
  walkthrough, one measured update moved the realisation factor from 0.70 to 0.82.

## 6. Discussion: where RetrainWise loses, and why

1. **Evaluation overhead.** Shadow evaluation is charged every time it runs. Its share of RetrainWise's spend was
   0.0% (cheap), 13% (balanced) and **34% (expensive)**. In the expensive regime it ran about 34–36 evaluations per
   run on Electricity and Airlines and then mostly deferred. That paid for information that did not change the action.
   A value-of-information rule for *when to evaluate* is the clearest improvement.
2. **Hold-out cost.** The full candidate trains on 70% of the window, so on Electricity, where a plain calendar refit on
   the full window was cheap and effective, RetrainWise's candidates were slightly weaker.
3. **Conservatism.** Requiring P(net > 0) ≥ 0.8 together with a 0.7 realisation prior blocks marginal but positive
   updates. This was intended. Settings were **not** tuned on these test streams.
4. **Budget as a hard cap.** On long streams (§5.3) a fixed budget dominates the outcome.

## 7. Limitations

* All costs are assumptions: a static, unverified price snapshot plus synthetic engineer hours and incident
  probabilities. There is no live billing API and no Google Cluster Data.
* There is one learner (linear SGD). Results for tree ensembles or Hoeffding trees may differ.
* Airlines and Covertype are ordered replays, not verified chronologies.
* The cost-aware baseline is CARA-CT-*inspired*: there is no offline threshold tuning, labelled errors stand in for
  similarity-weighted query losses, and costs vary over time.
* The oracle is optimal only over {defer, full retrain on 3 window lengths} at ≤ 60 checkpoints.
* Three seeds per cell. Standard deviations are reported but no significance tests were run, and several gaps are
  within one standard deviation (for example Airlines balanced, RetrainWise $8,020 ± 421 vs CARA-CT $8,209 ± 213).
* The full-data results use one seed and the balanced regime only.
* LLM explanations are advisory and were unreliable in the real Ollama tests on this CPU laptop:
  * `llama3.1` mislabelled an interval and a guardrail;
  * `qwen2.5-coder` once recommended a different action from the engine (now caught by a deterministic consistency
    check), and later misstated a cost.

  Every LLM report is shown next to the deterministic verified figures (REQUIREMENTS_CHECKLIST.md).

## 8. Future work

* Value-of-information gating of shadow evaluation.
* A budget proportional to the stream's value.
* Learned horizon-persistence models instead of a constant realisation factor.
* More learners, delayed-label and partial-label experiments (both supported by the settings but not benchmarked here).
* Calibrating engineer-hour and incident distributions from real MLOps data.
* An exact CARA re-implementation for direct comparison.

## References

Status from the online check on 2026-10-12. "Proposal said" marks corrections to the project description.

1. Žliobaitė, I., Budka, M., & Stahl, F. (2015). Towards cost-sensitive adaptation: When is it worth updating your predictive model? *Neurocomputing*, 150, 240–249. doi:10.1016/j.neucom.2014.05.084. *Verified.*
2. Mahadevan, A., & Mathioudakis, M. (2023). Cost-effective retraining of machine learning models. arXiv:2310.04216. *Verified; the proposal said 2024.*
3. Mahadevan, A., & Mathioudakis, M. (2024). Cost-aware retraining for machine learning. *Knowledge-Based Systems*, 293, 111610. doi:10.1016/j.knosys.2024.111610. *Partially verified (search results only).*
4. Hoffman, K., Salerno, S., Leek, J., & McCormick, T. (2024). Some models are useful, but how long? A decision-theoretic approach to choosing when to refit large-scale prediction models. arXiv:2405.13926. *Verified; the proposal gave the first author as "J."*
5. Regol, F., Schwinn, L., Sprague, K., Coates, M., & Markovich, T. (2025). When to retrain a machine learning model. *ICML 2025*, PMLR 267. arXiv:2505.14903. *Verified.*
6. Katz, H. (2026). Cost-sensitive retraining via posterior learning debt. arXiv:2604.06438. *The proposal's title ("Learning debt and cost-sensitive Bayesian retraining: A forecasting operations framework") and "Anonymous" author could not be confirmed.*
7. Spiliotis, E., & Petropoulos, F. (2024). On the update frequency of univariate forecasting models. *European Journal of Operational Research*, 314(1), 111–121. doi:10.1016/j.ejor.2023.08.056. *Verified; the proposal's title differs.*
8. Zanotti, M. (2025). On the retraining frequency of global models in retail demand forecasting. *Machine Learning with Applications*, 22. doi:10.1016/j.mlwa.2025.100769. *Verified; the proposal's title and initial differ.*
9. Gama, J., Žliobaitė, I., Bifet, A., Pechenizkiy, M., & Bouchachia, A. (2014). A survey on concept drift adaptation. *ACM Computing Surveys*, 46(4), 44. doi:10.1145/2523813. *Verified.*
10. Bifet, A., & Gavaldà, R. (2007). Learning from time-changing data with adaptive windowing. *SIAM SDM 2007*, 443–448. doi:10.1137/1.9781611972771.42. *Verified.*
11. Alam, S., Rahman, M. A., & Sadeqa, B. (2026). DriftGuard: A hierarchical framework for concept drift detection and remediation in supply chain forecasting. arXiv:2601.08928. *Verified; the proposal said "Anonymous".*
12. Katalay, E. K., Dimandja, D. O., & Masakuna, J. F. (2025). A multi-criteria automated MLOps pipeline for cost-effective cloud-based classifier retraining in response to data distribution shifts. arXiv:2512.11541. *Verified; the proposal said "Anonymous".*
13. "Model monitoring, data drift detection, and efficient model retraining: A review" (2025). ***Unverified*: not found; not relied on in this report.**
14. Kreuzberger, D., Kühl, N., & Hirschl, S. (2023). Machine learning operations (MLOps): Overview, definition, and architecture. *IEEE Access*, 11, 31866–31879. doi:10.1109/ACCESS.2023.3262138. *Verified.*
15. Kaur, J. (2026). AgentOps: The next evolution in AI lifecycle management. XenonStack blog post. *Exists, but is not a peer-reviewed source.*
16. Yuan, Z., et al. (2025). ArchPilot: A proxy-guided multi-agent approach for machine learning engineering. arXiv:2511.03985. *Verified.*
17. Huang, Q., Vora, J., Liang, P., & Leskovec, J. (2024). MLAgentBench: Evaluating language agents on machine learning experimentation. *ICML 2024*, PMLR 235. arXiv:2310.03302. *Verified; the proposal said 2023.*
18. Jiang, Z., et al. (2025). AIDE: AI-driven exploration in the space of code. arXiv:2502.13138. *Verified; the proposal's title differs.*
19. Liu, X., et al. (2024). First field trial of LLM-powered AI agent for lifecycle management of autonomous driving optical networks. arXiv:2409.14605. *Verified.*
20. Zhu, J., et al. (2026). Catching every ripple: Enhanced anomaly awareness via dynamic concept adaptation. *IEEE TPAMI*. arXiv:2604.14726. *Verified.*
21. Gama, J., Medas, P., Castillo, G., & Rodrigues, P. (2004). Learning with drift detection. *SBIA 2004*, LNCS 3171, 286–295. doi:10.1007/978-3-540-28645-5_29. *Verified.*

Dataset sources: OpenML 151 and 1169; Blackard (1998), Covertype, UCI ML Repository, doi:10.24432/C50K5N.
See DATASETS.md for exact files and checksums.
