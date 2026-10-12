# Requirements → implementation checklist

The checklist covers two sources: the project description PDF (objectives O1–O7, sections 4–7) and the build brief.
Status values:

* ✅ **Done**: implemented and verified.
* ⚠️ **Partial / with caveat**: implemented, with a stated caveat.
* ❌ **Not done**.

Verification codes:

* **[T]** automated test in `test_project.py`.
* **[UI]** exercised in the running Streamlit app on 2026-10-12.
* **[R]** shown in exported benchmark results.

## Architecture constraints

| Requirement | Status | Where / evidence |
|---|---|---|
| Python + Streamlit only; no other app framework or server | ✅ | `app.py`; worker is a plain `python worker.py` process [UI] |
| One flat `RetrainWise` folder, no subfolders, no `pages/` | ✅ | Navigation via `st.sidebar.radio`; the venv lives in `%LOCALAPPDATA%` |
| SQLite for state and audit | ✅ | `database.py`, 12 tables [T][UI] |
| One start command `streamlit run app.py` | ✅ | README; `start_windows.bat` [UI] |
| `unittest` tests | ✅ | `test_project.py`, 53 tests [T] |
| No venvs, credentials or caches in the submission | ✅ | `reporting.package` excludes data caches, logs, candidates and `.tmp` files |

## Core behaviour (O1, O3)

| Requirement | Status | Where / evidence |
|---|---|---|
| Recommend full retrain / partial update / defer | ✅ | `economics.rank_actions` [T][UI] |
| Benefit = Δerror × volume × value; cost = compute + engineering + validation + risk; net = benefit − cost; defer as reference | ✅ | `economics.py`; `test_benefit_cost_and_net_formula` [T] |
| Recovery estimated from evidence, not assumed | ✅ | Chronological shadow evaluation plus a realisation factor from measured post-update outcomes [T][UI] |
| No fit and evaluate on the same rows; evaluation overhead included | ✅ | `models.plan_windows`; `test_shadow_evaluation_is_chronological_and_leak_free`; evaluation charged [T][R] |
| Each decision: ranked actions, itemised costs, benefit, net value, uncertainty, feasibility, guardrails, evidence and assumptions, justification | ✅ | Decision payload; *Decision analysis* tab [UI] |
| Cheap / balanced / expensive regimes, cost traces, horizon, error value | ✅ | `pricing_snapshot.json`, `cost_trace` [T] |
| Minimum evidence, cooldown, minimum benefit, action limit, budget, incremental compatibility | ✅ | 8 guardrails, re-checked at execution [T][UI] |
| Conservative when evidence is insufficient | ✅ | Defer is the recommendation when nothing is feasible; `test_insufficient_evidence_defaults_to_defer` [T] |
| Sensitivity to assumptions | ✅ | `economics.sensitivity` and the what-if explorer [T][UI] |

## Datasets (Section 4)

| Requirement | Status | Where / evidence |
|---|---|---|
| Electricity OpenML 151, Airlines OpenML 1169, Covertype UCI 31 | ✅ | Downloaded and cached; row counts match the sources (45,312 / 539,383 / 581,012) |
| Synthetic stream with abrupt, gradual and recurring drift | ✅ | `datasets.synthetic`, plus a covariate-only segment [T] |
| Explicit download and caching; provenance (URL, date, checksums, target, licence, preprocessing) | ✅ | `data_*_provenance.json`; DATASETS.md |
| Source order preserved; chronology vs replay explained | ✅ | DATASETS.md |
| Small / standard / full configurations | ✅ | `config.SAMPLE_SIZES`; standard and full results [R] |
| Never substitute synthetic data | ✅ | `test_missing_real_dataset_never_falls_back` [T] |
| Missing values, categoricals, unseen categories, multiclass, inconsistent schemas | ✅ | `preprocessing.py` [T] |
| Preprocessing fitted only on available data | ✅ | `test_fit_uses_only_training_window` [T] |
| Public cloud pricing data | ⚠️ | Static **assumed** snapshot; not fetched live and not verified against provider pages in this build (stated in the file) |
| Google Cluster Data traces | ❌ | Not used. Compute duration is parametrised as hours per 10k rows. Documented as future work. |
| Synthetic engineer-hour and deployment-risk costs | ✅ | Regime profiles (synthetic assumptions, labelled) |

## Monitoring (O2, L1)

| Requirement | Status | Where / evidence |
|---|---|---|
| Real batch-by-batch prequential inference | ✅ | `pipeline.process_batch`; `test_prequential_predict_then_reveal` [T][UI] |
| Accuracy, precision, recall, F1; rolling error | ✅ | Telemetry [UI] |
| Model age and time since update | ✅ | Batches, predictions and labels since update; wall-clock age |
| PSI with fixed reference bins, safe for constant features and small samples | ✅ | `test_psi_constant_missing_and_small_samples_safe` [T] |
| ADWIN and DDM on errors | ✅ | ADWIN cross-checked with River; DDM alarms identical to River's [T] |
| Degradation, accumulated staleness, sample size, uncertainty, label availability | ✅ | Learning debt, Wilson CI, label counts [UI] |
| Covariate drift ≠ concept drift | ✅ | `test_covariate_shift_is_not_predictive_degradation`; demo shows both cases [T][UI] |

## Agent layer (O4, L3)

| Requirement | Status | Where / evidence |
|---|---|---|
| Optional Ollama tool calling over stdlib HTTP | ✅ | `agent.ollama_provider` (`urllib`) |
| Bounded tools: telemetry, registry and validation history, costs and pricing, action evaluations | ✅ | `TOOL_SPECS` |
| Agent may prepare, not execute; approval in deterministic code | ✅ | `prepare_execution_request` → `execution_requests`; `test_mock_provider_tool_loop` checks the decision stays pending [T] |
| Argument validation, tool restriction, iteration and time limits | ✅ | `validate_arguments`, ≤ 4 calls per turn, ≤ 6 iterations, deadline-bounded requests [T] |
| Explanation: what changed, why it matters, costs and benefits, recommendation, uncertainty | ✅ | Deterministic template; required headings in the LLM prompt [T][UI] |
| Labelled deterministic fallback | ✅ | [T][UI] |
| Tool calls and evidence in SQLite | ✅ | `agent_reports`, `agent_tool_calls` [T][UI] |
| Mock-provider test, reported separately from a real Ollama test | ✅ | Mock: [T]. Real: see the "Real Ollama test" section below. |

## Training lifecycle (L4)

| Requirement | Status | Where / evidence |
|---|---|---|
| Initial training; full retraining on a recent window; genuine incremental updates | ✅ | `models.train_full`, `partial_update` (`partial_fit`) [T][UI] |
| Chronological candidate validation; rejection; promotion | ✅ | `validation_gate`; `test_validation_failure_rejects_candidate` [T][UI] |
| Versioned artifacts `model_v001.joblib` …; rollback; post-update monitoring | ✅ | [T][UI] |
| Persist preprocessing, schema, classes, interval, seed, configuration, metrics | ✅ | Artifact fields plus registry metadata |
| Recommendation-only by default; opt-in bounded autonomy with enforced limits | ✅ | `test_bounded_autonomy_respects_limits` [T] |
| Rerun and double-click safety; no arbitrary uploaded models | ✅ | Position keys, decision keys, UNIQUE approvals, SHA-256 checks [T][UI] |

## Benchmarking (O5, O6, O7)

| Requirement | Status | Where / evidence |
|---|---|---|
| Never, calendar, drift-triggered, cost-aware baseline, RetrainWise, constrained hindsight oracle | ✅ | `experiments.py` [R] |
| CARA verified; labelled "inspired" with the differences documented | ✅ | METHODOLOGY.md §6 |
| Oracle action space and objective defined; optimal only within it | ✅ | METHODOLOGY.md §6 |
| Identical streams and cost traces; no future-label leakage | ✅ | `test_no_future_label_leakage_in_online_policies` [T] |
| All required metrics, plus variation over seeds | ✅ | `results_summary.csv`, `results_aggregate.csv` [R] |
| Configurable seeds and regimes; real-dataset standard evaluations | ✅ | 216 standard runs (4 datasets × 3 seeds × 3 regimes × 6 policies) plus 18 full-data runs [R] |
| Honest reporting | ✅ | RESEARCH_REPORT.md reports the cells where RetrainWise loses |

## Application, persistence and jobs

| Requirement | Status | Where / evidence |
|---|---|---|
| Eight sections with real data and working controls | ✅ | [UI] every tab |
| SQLite as the source of truth; survives restart | ✅ | `test_state_survives_restart_and_interrupted_work_is_marked` [T]; server restart [UI] |
| Background jobs with progress, cancellation and failures; interrupted jobs identified; no false resumability claim | ✅ | `jobs.py`, `worker.py` [T][UI] |
| Transactions, safe paths, input validation, structured logs, no secrets | ✅ | `BEGIN IMMEDIATE`, `safe_child`, `Settings.validate`, `retrainwise.log` |

## Deliverables

| Deliverable | Status |
|---|---|
| Source, `requirements.txt`, `settings.example.json`, README, `start_windows.bat` | ✅ |
| ARCHITECTURE (Mermaid diagrams), METHODOLOGY, DATASETS, DEMO_GUIDE, this checklist | ✅ |
| Benchmark CSV/JSON and charts | ✅ `results_*`, `results_full_*` |
| RESEARCH_REPORT with verified references | ✅ (verification status per reference) |
| `presentation.pptx` | ✅ generated from the result files |
| Final ZIP | ✅ `RetrainWise_submission.zip` |

## Real Ollama test (reported separately from the mock tests)

Ollama 0.32.6 on this CPU laptop:

* **`llama3.1:latest`**: completed in 2 iterations and 125 seconds. It made one validated tool call
  (`get_action_evaluations`, emitted as JSON embedded in its text, which the loop now parses) and wrote a report
  under the required headings. **Quality caveat:** it mislabelled the benefit interval as an error-reduction
  interval, and it attributed the full-retrain confidence guardrail to the partial update. The deterministic
  "verified figures" attached to every LLM report exist for exactly this reason.
* **`qwen2.5-coder:7b`** was run three times, with fixes in between:
  1. It returned its tool call as plain JSON text, and the first loop accepted that text as the report.
     **Fixed:** textual tool calls are now executed, and JSON-only answers are rejected.
  2. It called only `get_monitoring_telemetry` and **recommended "defer" while the engine recommended "partial"**.
     **Fixed:** the loop now asks the model to call `get_action_evaluations` before answering, and a deterministic
     consistency check flags any mismatch with a visible warning (`completed_with_warning`).
     Applied retroactively, the check flags this report and passes the llama3.1 report.
  3. After both fixes it completed in 3 iterations (226 seconds), called both tools, and recommended the same action
     as the engine. **Remaining inaccuracies:** it put the partial-update cost at $40 (it omitted the $10 deployment
     risk; the real figure is $50) and quoted a benefit interval that does not match the verified figures. It also
     pasted an "action request" as JSON inside its report text. That was **not** executed or recorded as a request,
     because only tool calls can prepare requests.

## Not implemented / limitations

* No live billing API or Google Cluster Data; prices are an assumed static snapshot.
* Only one learner (linear `SGDClassifier`). Hoeffding trees and ensembles are not implemented.
* Jobs and interrupted executions are not resumable; they are marked `interrupted` and must be resubmitted.
* LLM explanations are advisory and can be inaccurate, as observed in the real test above.
* No containerisation, MLflow, Airflow or Prometheus integrations (optional in the proposal).
