# RetrainWise

**A lifecycle-aware ML decision system.** RetrainWise monitors a deployed classifier on a data stream and
recommends one of three actions — **keep the existing model**, apply an **incremental / partial update**, or perform
**full retraining**. It estimates how much of the current error is *avoidable* with a cheap fresh probe model and a
difference-in-differences comparison, then compares the value of recovering it with compute, engineering, validation,
deployment-risk and probe costs.
It explains the recommendation, requires explicit approval, validates candidates on a chronological hold-out, promotes
or rejects them, supports rollback, and keeps a complete audit trail.

The dashboard is a **Next.js (App Router, TypeScript, Tailwind CSS)** application. The machine learning runs in the
existing **Python lifecycle engine** (`engine/`). **SQLite** (`engine/retrainwise.db`) is the single source of truth.

| What is real | What is simulated or assumed (labelled in the UI) |
|---|---|
| Batch-by-batch inference, prequential evaluation, PSI, ADWIN and DDM, probe-model training and difference-in-differences staleness estimates, scikit-learn training with genuine `partial_fit`, chronological candidate validation, promotion, rollback, recovery-ratio measurement, the model registry with SHA-256 checksums, benchmarks, the audit log | Dollar prices (`engine/pricing_snapshot.json` is an assumed snapshot, not billing data), engineer hours, incident risk, probe overheads, and "deployment", which is a local registry swap. The synthetic stream is generated locally. |

## The research approach in one page

1. **Telemetry.** Every batch is predicted first; labels arrive later (configurable delay and availability). Predictions,
   labels, error rates, rolling metrics with Wilson intervals, PSI, ADWIN/DDM, model age, probe results and cost records
   are stored in SQLite (`predictions`, `batches`, `probes`, `cost_records`, …).
2. **Probe model.** A cheap model trained on the most recent labelled rows is scored next to the deployed model on the
   *same* newly labelled rows (cross-fitted, so it never scores rows it was trained on).
3. **Difference-in-differences staleness.** The first probes after a deployment measure the normal deployed-vs-probe gap.
   Later, *avoidable staleness* = gap now − baseline gap. If both models get worse together, the gap does not move and
   the extra error is reported as *the task got harder for all models* instead.
4. **Renewal rule.** An update is *due* when the marginal avoidable-error cost per prediction reaches the running
   average cost of the current model cycle (renewal cost + avoidable cost so far, per prediction).
5. **Adaptive probing.** Probes cost money. A probe runs when its expected value of information exceeds its cost,
   within a monitoring budget and min/max intervals (or on a fixed schedule).
6. **Partial vs full.** Each action is credited with its learned **recovery ratio** of the avoidable error, measured
   after past updates. Costs cover fit time (compute), engineering, validation, expected deployment risk and the probe.
7. **Deterministic enforcement.** Guardrails, budgets, the chronological validation gate, promotion and rollback are
   enforced in Python. The optional LLM agent only reads evidence, explains and prepares requests for a human.

```
Expected benefit   = estimated avoidable error reduction × prediction horizon × value of avoiding one error
Total action cost  = compute + engineering + validation + expected deployment-risk cost + probe evaluation cost
Net expected value = expected benefit − total action cost
```

Full definitions: [METHODOLOGY.md](METHODOLOGY.md) §3a–4.

## Quick start

Requirements: **Node.js 20.9+** and **Python 3.10–3.12**.

```bash
npm install
```

```bash
npm run setup:python
```

```bash
npm run dev
```

Open <http://localhost:3000>. On **Overview**, click **Start offline demo (synthetic stream)**, then process a few
batches. No network connection is needed for the demo.

* `npm run setup:python` creates `engine/.venv` and installs `engine/requirements.txt` (it uses `uv` when available,
  otherwise `python -m venv` + `pip`). You only need it once.
* `npm run dev` first checks that the engine's Python is ready and prints how to fix it if not. The dashboard still
  starts; actions report a clear "engine unavailable" error until Python is set up.
* To use an interpreter you already have, set `RETRAINWISE_PYTHON` to its path instead of running `setup:python`.
  Interpreter search order: `RETRAINWISE_PYTHON`, `engine/.venv`, `.venv`, `%LOCALAPPDATA%\RetrainWise\venv`
  (Windows), `~/.venvs/retrainwise`, then `python`/`python3` on `PATH`.

Production build: `npm run build` then `npm run start`.

## How the pieces fit

```
Browser ──► Next.js pages (server components read SQLite directly, read-only)
        └─► Next.js API routes (/api/*)  ──zod-validated JSON──►  engine bridge (one long-lived Python process)
                                                                   └─► pipeline.Lifecycle / jobs / agent ──► SQLite
                                                                   └─► worker.py processes (benchmarks)
```

* **Reads**: pages query `engine/retrainwise.db` with `better-sqlite3` in read-only mode (WAL allows this while the
  engine writes).
* **Writes and ML work**: every action goes through `src/lib/engine.ts`, which keeps one Python process running
  `engine/bridge.py serve` and sends it one JSON command at a time. Only allow-listed commands exist; arguments are
  validated by zod in the API route, again by the bridge, and again by the engine. Nothing goes through a shell.
* Slow, self-contained commands (dataset downloads, Ollama explanations) run in a separate one-shot Python process so
  they cannot block the dashboard. Benchmarks run in `engine/worker.py` processes with progress in SQLite.
* **Duplicate-action prevention**: buttons are disabled while a request runs; the API refuses an action that is already
  queued or running (HTTP 409); batch processing is keyed by the expected stream position; evaluations are keyed by
  (run, position, model, settings); and each decision can be approved at most once (`UNIQUE` in SQLite).
* **Transactional persistence**: every engine write uses `BEGIN IMMEDIATE` transactions (`engine/database.py`).
* **Local-only API**: requests must come to `localhost`/`127.0.0.1` (blocks LAN access and DNS rebinding),
  state-changing requests must be `application/json` and same-origin. Set `RETRAINWISE_ALLOW_REMOTE=1` only if you
  deliberately want to expose the dashboard on a network.
* On engine start, executions that were cut off by a crash or restart are marked `interrupted`, and benchmark jobs
  whose worker stopped heart-beating are marked `interrupted`. Nothing is resumed silently.

More detail: [ARCHITECTURE.md](ARCHITECTURE.md), [METHODOLOGY.md](METHODOLOGY.md), [DATASETS.md](DATASETS.md),
[DEMO_GUIDE.md](DEMO_GUIDE.md), [REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md),
[RESEARCH_REPORT.md](RESEARCH_REPORT.md).

## Pages

| Page | What you can do |
|---|---|
| **Overview** | Active model version, accuracy, rolling error (95% CI), max PSI, counterfactual staleness estimate (probe DiD), model age, labelled samples, simulated spend vs budget, the latest recommendation, the workflow stepper, recent activity and limitations |
| **Data & simulation** | Choose synthetic, Electricity, Airlines or Covertype; download and cache real datasets with provenance and checksums; inspect schema, first rows and class balance; set seed and sample size; start a stream; process the next batch(es) |
| **Monitoring** | Accuracy, precision, recall, F1, rolling error with Wilson interval, ADWIN/DDM alarms, learning debt and staleness, probe-model results (deployed vs probe error, difference-in-differences with interval, task-hardness shift, renewal rule, probe log with VOI and cost), a PSI heatmap per feature and batch, label availability, and the active model's reference window. States clearly that feature drift alone does not prove concept drift |
| **Decision analysis** | Estimated avoidable error and probe evidence, the renewal rule, recovery-ratio assumptions, ranked keep / partial / full actions, the benefit/cost/net formula with real numbers, itemised costs (incl. probe), confidence intervals, feasibility, guardrails, hold-out evidence, sensitivity analysis and a what-if explorer |
| **Model lifecycle** | Explicit approval form (name + confirmation), agent-prepared requests, chronological validation outcomes, model registry with artifact metadata, rejected candidates, post-update monitoring and recovery outcomes (realised gain ÷ avoidable error) and rollback |
| **Experiments** | Benchmarks of Never, Calendar, Drift-triggered, a CARA-CT-inspired cost-aware baseline, RetrainWise and a constrained hindsight oracle; live progress and cancellation; result tables, charts, per-batch traces, CSV/JSON export |
| **Agent & audit** | Deterministic explanations by default, optional local Ollama tool calling over read-only tools (telemetry, registry, probe results, pricing, evaluations; it can only *prepare* a request), stored reports with every tool call, approvals and outcomes, and a filterable, exportable (JSON/CSV) audit log |
| **Settings** | Budgets (including the monitoring budget), cooldowns, probe scheduling and frequency, recovery priors, cost regime and price trace, prediction horizon, error value, evidence thresholds, batch size, label delay and availability, model parameters, agent limits and bounded autonomy, plus the assumed pricing snapshot |

## Real datasets (explicit download, never substituted)

Use **Download and cache** on *Data & simulation*, or:

```bash
python engine/datasets.py electricity airlines covertype
```

This writes `engine/data_<name>.csv.gz` and `engine/data_<name>_provenance.json` (source URL, retrieval time, SHA-256
checksums, target column, licence, ordering notes). If a real dataset is missing, the app says so; it never falls back
to synthetic data.

## Optional local LLM (Ollama)

Install [Ollama](https://ollama.com), pull a tool-calling model (for example `ollama pull llama3.1`), then choose
**Local Ollama** on *Agent & audit*. The agent only reads evidence through bounded, schema-validated tools and may at
most prepare an execution request, which a person must approve on *Model lifecycle*. If Ollama is unavailable, the
attempt is recorded and the labelled deterministic explanation is used instead.

## Tests

```bash
npm test
```

This runs the TypeScript type check and the Python engine suite (`engine/test_project.py`, 66 tests: economics,
guardrails, PSI/ADWIN/DDM, preprocessing leakage, training, reproducibility, approval enforcement, duplicate
prevention, validation rejection, promotion, rollback, restart recovery, the agent tool loop, the job worker, the
web bridge protocol, and the probe/DiD/renewal/VOI/recovery-ratio logic). The engine tests alone: `npm run test:engine`.

## Experiments from the command line

```bash
cd engine
python experiments.py --datasets synthetic electricity airlines covertype --size standard --seeds 1 2 3 --regimes cheap balanced expensive --prefix results
python reporting.py charts results
```

Outputs (`<prefix>_summary.csv`, `<prefix>_details.json`, `<prefix>_aggregate.csv`, `<prefix>_chart_*.png`) appear in
`engine/` and on the *Experiments* page. The submitted results are `results_*` (216 standard-size runs) and
`results_full_*` (complete datasets), summarised in [RESEARCH_REPORT.md](RESEARCH_REPORT.md).

## Project layout

| Path | Role |
|---|---|
| `src/app/` | Next.js pages (one folder per page) and API routes under `src/app/api/` |
| `src/components/` | UI primitives, charts (Recharts), forms and page-specific client components |
| `src/lib/engine.ts` | Python bridge: long-lived engine process, command queue, timeouts, duplicate detection |
| `src/lib/db.ts`, `src/lib/queries.ts` | Read-only SQLite access and typed queries |
| `src/lib/api.ts` | Local-only request guard, JSON body validation, error mapping |
| `engine/bridge.py` | JSON command bridge (serve / one-shot modes) over the engine |
| `engine/staleness.py` | Probe model, difference-in-differences, renewal rule, VOI probe scheduling, recovery ratios |
| `engine/pipeline.py`, `monitoring.py`, `models.py`, `economics.py`, `agent.py`, `experiments.py`, `datasets.py`, `jobs.py`, `worker.py` | The Python lifecycle engine (unchanged algorithms) |
| `engine/retrainwise.db`, `engine/model_v*.joblib` | Runtime state (recreated automatically) |
| `scripts/` | `setup-python`, `check-python`, `run-engine-tests` helpers |

## Resetting

Stop the app, delete `engine/retrainwise.db`, `engine/retrainwise.db-wal`, `engine/retrainwise.db-shm` and
`engine/model_v*.joblib`, then start again.
