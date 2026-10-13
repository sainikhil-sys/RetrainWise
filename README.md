# RetrainWise

**A lifecycle-aware agent for cost-benefit training decisions.**

RetrainWise monitors a deployed classifier on a data stream and recommends one of three actions:
**full retraining**, a **partial (incremental) update**, or **deferring**. It compares the expected
value of recovered accuracy against compute, engineering, validation and deployment-risk costs,
explains the recommendation, requires approval before acting, validates candidates on a
chronological hold-out, promotes or rejects them, and monitors the result.

Everything is one flat folder, one Streamlit application and one SQLite database. It runs offline on a CPU laptop.

| What is real | What is simulated or assumed |
|---|---|
| Model training (scikit-learn `SGDClassifier`, genuine `partial_fit`), predictions, metrics, drift statistics (PSI, ADWIN, DDM), validation, the registry, the audit log | Dollar prices: `pricing_snapshot.json` is an assumed snapshot, not live billing data. Engineer hours and incident costs are synthetic. "Deployment" is a local registry swap. |

## Quick start (Windows)

Double-click `start_windows.bat`. It creates a virtual environment in `%LOCALAPPDATA%\RetrainWise\venv`
(outside the project folder), installs `requirements.txt` once, then runs:

```bash
streamlit run app.py
```

Open <http://localhost:8501>. On **Overview**, click **Start the offline demo**, then follow the **Next step** box on each page.
No network connection is needed for the demo.

## Manual installation (any OS, Python 3.10–3.12)

```bash
python -m venv ~/.venvs/retrainwise
```

```bash
~/.venvs/retrainwise/bin/python -m pip install -r requirements.txt
```

```bash
streamlit run app.py
```

(On Windows, use `%USERPROFILE%\.venvs\retrainwise\Scripts\python.exe`. Activate the environment before running `streamlit`.)

## Real datasets (explicit download, never substituted)

```bash
python datasets.py electricity airlines covertype
```

This writes `data_<name>.csv.gz` and `data_<name>_provenance.json` (source URL, retrieval time,
SHA-256 checksums, target column, licence, ordering notes). You can also use the download button on
**Data and simulation**. If a real dataset is missing, the app shows an error and the command
above; it never falls back to synthetic data. See [DATASETS.md](DATASETS.md).

## Tests

```bash
python -m unittest test_project -v
```

The suite has 53 tests covering: economics and ranking, non-finite inputs, every guardrail, PSI, ADWIN and DDM
(cross-checked against River when it is installed), preprocessing leakage, full and incremental training,
ARFF parsing, reproducibility, future-label leakage, approval enforcement, duplicate prevention,
validation rejection, promotion, rollback, restart recovery, the agent's tool loop (mock provider), and
the job worker and cancellation. Last run: **53 tests, all passing**.

## Experiments

```bash
python experiments.py --datasets synthetic electricity airlines covertype --size standard --seeds 1 2 3 --regimes cheap balanced expensive --prefix results
```

```bash
python reporting.py charts results
```

* Sizes: `small` (first 5,000 rows), `standard` (first 20,000), `full` (all rows).
* Policies: never, calendar, drift-triggered, CARA-CT-inspired cost-aware baseline, RetrainWise, and a constrained hindsight oracle.
* Outputs: `<prefix>_summary.csv` (one row per run), `<prefix>_details.json` (configuration plus per-batch traces), `<prefix>_aggregate.csv` (mean and standard deviation over seeds), and `<prefix>_chart_*.png`.
* Experiments can also be started from the **Experiments** tab. They run in a separate `worker.py` process, with progress, cancellation and failure state stored in SQLite.

The submitted results are `results_*` (standard size, 216 runs) and `results_full_*` (complete datasets,
1 seed, balanced regime, batch size 2,000). They are summarised in [RESEARCH_REPORT.md](RESEARCH_REPORT.md).

## Optional local LLM (Ollama)

Install [Ollama](https://ollama.com), pull a tool-calling model such as `ollama pull llama3.1`, then choose
**Local Ollama** on the **Agent and audit** tab. The agent uses only bounded, read-only tools and may at most
*prepare* an execution request. Approval and enforcement remain in deterministic code. Without Ollama, the
labelled deterministic explanation mode is used.

## The application

| Tab | Purpose |
|---|---|
| Overview | Active version, rolling error vs reference, learning debt, spend vs budget, PSI, label counts, latest recommendation, recent activity |
| Data and simulation | Dataset choice, download, provenance, schema preview, seed and size, start a run, process batches |
| Monitoring | Prequential metrics, rolling error with Wilson CI, ADWIN/DDM alarms, learning debt, PSI heatmap, reference bins, label availability |
| Decision analysis | Shadow evaluation, ranked actions, itemised costs, benefit intervals, guardrails, sensitivity table, what-if explorer |
| Model lifecycle | Approval form, agent-prepared requests, registry, decisions and outcomes, post-update monitoring, rollback |
| Experiments | Policy benchmarks as background jobs, progress and cancellation, saved comparisons, CSV/JSON export |
| Agent and audit | Deterministic or Ollama explanations, tool evidence, approvals, filterable and exportable audit log |
| Settings | Economics, guardrails, monitoring, stream and model parameters, agent limits, bounded autonomy |

## Files

| File | Role |
|---|---|
| `app.py` | Streamlit UI (the only application framework): pages, navigation, workflow |
| `ui.py` | Presentation helpers: theme-safe styling, step tracker, plain-language text, glossary, activity feed |
| `config.py` | Validated settings, sample sizes, safe file names |
| `database.py` | SQLite schema, transactions, audit events, JSON-lines log |
| `datasets.py` | Downloads, caching, provenance, synthetic drift stream |
| `preprocessing.py` | Schema alignment and window-only preprocessing |
| `monitoring.py` | PSI, ADWIN, DDM, metrics, drift status, evaluation trigger |
| `models.py` | Full and incremental training, shadow evaluation, validation gate, artifacts |
| `economics.py` | Cost model, cost traces, benefit, guardrails, ranking, sensitivity |
| `pipeline.py` | SQLite-backed lifecycle: batches, decisions, approval, promotion, rollback, autonomy |
| `agent.py` | Bounded tools, Ollama tool loop, deterministic explanations |
| `experiments.py` | Benchmark harness and oracle |
| `jobs.py`, `worker.py` | Persistent background jobs |
| `reporting.py` | Aggregation, charts, deck, ZIP |
| `test_project.py` | unittest suite |
| `pricing_snapshot.json`, `settings.example.json` | Assumed prices, example configuration |
| `retrainwise.db`, `model_v*.joblib` | Demo state from the interface walkthrough (safe to delete; recreated automatically) |

More detail: [ARCHITECTURE.md](ARCHITECTURE.md), [METHODOLOGY.md](METHODOLOGY.md),
[DEMO_GUIDE.md](DEMO_GUIDE.md), [REQUIREMENTS_CHECKLIST.md](REQUIREMENTS_CHECKLIST.md).

## Resetting

Stop the app, delete `retrainwise.db`, `retrainwise.db-wal`, `retrainwise.db-shm` and `model_v*.joblib`,
then start again.
