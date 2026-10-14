# RetrainWise

**A lifecycle-aware agent for cost-benefit training decisions.**

RetrainWise monitors a deployed classifier on a data stream and recommends one of three actions:
**full retraining**, a **partial (incremental) update**, or **deferring**. It compares the expected
value of recovered accuracy against compute, engineering, validation and deployment-risk costs,
explains the recommendation, requires approval before acting, validates candidates on a
chronological hold-out, promotes or rejects them, and monitors the result.

It is a single **Next.js** application (TypeScript, App Router) with one SQLite database. Everything,
including model training, runs in the Node.js server on a CPU laptop. No cloud service is needed.

| What is real | What is simulated or assumed |
|---|---|
| Model training (SGD logistic regression with genuine incremental updates), predictions, metrics, drift statistics (PSI, ADWIN, DDM), validation, the registry, the audit log, accounts and email delivery | Dollar prices: `src/lib/pricing_snapshot.json` is an assumed snapshot, not live billing data. Engineer hours and incident costs are synthetic. "Deployment" is a local registry swap. |

## Quick start

Requirements: Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env        # then fill in your SMTP settings (see "Accounts and email")
npm run mail:test -- you@example.com
npm run dev
```

Open <http://localhost:3000>, create an account, enter the 6-digit code from the email, and on **Overview**
click **Start offline demo (synthetic drift stream)**. The demo needs no network connection.

For a production server:

```bash
npm run build
npm start
```

All runtime state lives in `data/` (database, model artifacts, downloaded datasets, benchmark results). It is
not committed. Delete the folder to start from scratch.

## Accounts and email

Every page requires a signed-in, verified account. New users create an account, receive a **6-digit code by
email**, verify it, and are signed in. **Forgot password?** emails a reset code. Approvals, rollbacks and other
actions are recorded in the audit log under the signed-in email.

Email is sent over SMTP. Copy `.env.example` to `.env`, fill in your provider's settings, restart the app, then
confirm delivery from a terminal before testing sign-up:

```bash
npm run mail:check
npm run mail:test -- you@example.com
```

`mail:check` flags known misconfigurations; `mail:test` sends a real message and prints the exact SMTP failure
if it cannot (rejected login, refused recipient, wrong port/security mode, timeout). The sign-up screen shows the
same reason instead of failing silently. Common causes of missing mail:

- **Gmail** rejects your normal password. Turn on 2-Step Verification, create an App Password
  (myaccount.google.com/apppasswords) and use it as `SMTP_PASSWORD`.
- **Port and security must match**: 587 with `SMTP_SECURITY=starttls`, 465 with `SMTP_SECURITY=ssl`.
- **`SMTP_FROM` must be an address the provider lets you send as** (your login for Gmail/Outlook, a verified
  sender for SendGrid/Mailgun/SES).
- Delivered mail can land in **spam/junk**.

Codes expire after 10 minutes, allow 5 attempts, and can be resent once a minute (5 per hour). Five wrong
passwords lock the account for 15 minutes. Passwords are stored as scrypt hashes; codes and session tokens as
SHA-256 digests. Sessions last 7 days in an HTTP-only cookie, and a password reset signs out every session.
For offline development only, `AUTH_DEV_CODES=1` with no `SMTP_HOST` shows codes on screen.

## Real datasets (explicit download, never substituted)

```bash
npm run datasets -- electricity airlines covertype
```

This writes `data/datasets/<name>.csv.gz` and `<name>_provenance.json` (source URL, retrieval time, SHA-256
checksums, target column, licence, ordering notes). You can also use the download button on **Data and
simulation**. If a real dataset is missing, the app shows an error and the command above; it never falls back to
synthetic data. See [docs/DATASETS.md](docs/DATASETS.md).

## Experiments

```bash
npm run benchmark -- --datasets synthetic electricity --size standard --seeds 1 2 3 --regimes cheap balanced expensive --prefix results
```

* Sizes: `small` (first 5,000 rows), `standard` (first 20,000), `full` (all rows).
* Policies: never, calendar, drift-triggered, CARA-CT-inspired cost-aware baseline, RetrainWise, and a
  constrained hindsight oracle.
* Outputs in `data/results/`: `<prefix>_summary.csv` (one row per run), `<prefix>_aggregate.csv` (mean and
  standard deviation over seeds) and `<prefix>_details.json` (configuration plus per-batch traces).
* Experiments can also be started from the **Experiments** page. They run in the background inside the server,
  with progress, cancellation and failure state stored in SQLite. The page also shows the archived results of
  the original research run (`research/results/`).

## Optional local LLM (Ollama)

Install [Ollama](https://ollama.com), pull a tool-calling model such as `ollama pull llama3.1`, then choose
**Local Ollama** on **Agent and audit** (set `OLLAMA_URL` if it is not on `http://127.0.0.1:11434`). The agent
uses only bounded, read-only tools and may at most *prepare* an execution request. Approval and enforcement
remain in deterministic code. Without Ollama, the labelled deterministic explanation mode is used.

## The application

| Page | Purpose |
|---|---|
| Overview | Active version, rolling error vs reference, learning debt, spend vs budget, PSI, label counts, latest recommendation, recent activity |
| Data and simulation | Dataset choice, download, provenance, schema preview, seed and size, start a run, process batches |
| Monitoring | Prequential metrics, rolling error with Wilson CI, ADWIN/DDM alarms, learning debt, PSI heatmap, reference bins, label availability |
| Decision analysis | Shadow evaluation, ranked actions, itemised costs, benefit intervals, guardrails, sensitivity table, what-if explorer |
| Model lifecycle | Approval form, agent-prepared requests, registry, decisions and outcomes, post-update monitoring, rollback |
| Experiments | Policy benchmarks as background jobs, progress and cancellation, saved comparisons, CSV/JSON export |
| Agent and audit | Deterministic or Ollama explanations, tool evidence, approvals, filterable and exportable audit log |
| Settings | Economics, guardrails, monitoring, stream and model parameters, agent limits, bounded autonomy |
| Account | Change password |

A typical walkthrough: start the offline demo → process 9 batches (past the abrupt drift at row 4,000) →
**Monitoring** shows predictive degradation without covariate shift → **Decision analysis** → *Evaluate update
options* → **Model lifecycle** → approve the recommended action → the candidate passes or fails the validation
gate → inspect the registry and audit log → run a benchmark on **Experiments**.

## Tests

```bash
npm test
npm run typecheck
```

The suite covers economics and ranking, non-finite inputs, every guardrail, PSI, ADWIN and DDM, preprocessing
leakage, full and incremental training, ARFF parsing, reproducibility, future-label leakage, approval
enforcement, duplicate prevention, validation rejection, promotion, rollback, restart recovery, the agent's tool
loop (mock provider), background jobs and cancellation, and the account flows including delivery through a
real local SMTP server.

## Project layout

| Path | Role |
|---|---|
| `src/app/(auth)/` | Sign in, sign up, verify, forgot / reset password pages and their server actions |
| `src/app/(app)/` | The signed-in application pages and their server actions |
| `src/app/api/` | Downloads: results, audit log, settings |
| `src/lib/config.ts` | Validated settings, sample sizes, data paths |
| `src/lib/db.ts` | SQLite schema, transactions, audit events, JSON-lines log |
| `src/lib/datasets.ts` | Downloads, caching, provenance, synthetic drift stream |
| `src/lib/ml/` | Data frames, window-only preprocessing, SGD estimator, training, shadow evaluation, validation gate, artifacts |
| `src/lib/monitoring.ts` | PSI, ADWIN, DDM, metrics, drift status, evaluation trigger |
| `src/lib/economics.ts` | Cost model, cost traces, benefit, guardrails, ranking, sensitivity |
| `src/lib/lifecycle.ts` | SQLite-backed lifecycle: batches, decisions, approval, promotion, rollback, autonomy |
| `src/lib/agent.ts` | Bounded tools, Ollama tool loop, deterministic explanations |
| `src/lib/experiments.ts`, `src/lib/jobs.ts` | Benchmark harness, oracle, background jobs |
| `src/lib/auth/` | Accounts, codes, sessions, SMTP delivery and diagnostics |
| `scripts/` | Terminal commands: mail check/test, dataset download, benchmark |
| `tests/` | Vitest suite |
| `docs/` | [Architecture](docs/ARCHITECTURE.md), [methodology](docs/METHODOLOGY.md), [datasets](docs/DATASETS.md) |
| `research/` | The original Python research prototype's report, results, charts and presentation (see [research/README.md](research/README.md)) |
