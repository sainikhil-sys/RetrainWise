# RetrainWise

**A lifecycle-aware ML decision system.** RetrainWise monitors a deployed classifier on a data stream and
recommends one of three actions — **keep the existing model**, apply an **incremental / partial update**, or perform
**full retraining**. It estimates how much of the current error is *avoidable* with a cheap fresh probe model and a
difference-in-differences comparison, then compares the value of recovering it with compute, engineering, validation,
deployment-risk and probe costs.
It explains the recommendation, requires explicit approval, validates candidates on a chronological hold-out, promotes
or rejects them, supports rollback, and keeps a complete audit trail.

The product is a **Next.js 16 (App Router, TypeScript, Tailwind CSS, shadcn/ui)** application with email-code sign-in,
workspaces and roles. The machine learning runs in the **Python lifecycle engine** (`engine/`). Accounts, sessions and
the application audit log live in **SQLite via Prisma** (`data/app.db`, PostgreSQL-ready); each workspace's engine
state lives in its own SQLite database (`engine/workspaces/<id>/retrainwise.db`).

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

Open <http://localhost:3000>, choose **Get started**, enter any email address and type the 6-digit code you receive.
Without an email provider configured, development builds keep the email in a local outbox at
<http://localhost:3000/dev/mailbox> (and print the code in the terminal), so you can always sign in locally.

* `npm run dev` creates `.env` with a fresh `AUTH_SECRET` on first run, applies database migrations and checks that the
  engine's Python is ready (it prints how to fix it if not).
* `npm run setup:python` creates `engine/.venv` and installs `engine/requirements.txt` (uses `uv` when available).
  Interpreter search order: `RETRAINWISE_PYTHON`, `engine/.venv`, `.venv`, `~/.venvs/retrainwise`,
  `%LOCALAPPDATA%\RetrainWise\venv` (Windows), then `python`/`python3` on `PATH`.
* Production: `npm run build` then `npm run start`.

## First run: sign-in and onboarding

1. **Sign in with a code.** Any email address works. A 6-digit code is emailed; it expires after 10 minutes, works once,
   allows 5 wrong attempts, and can be resent after 30 seconds. A new address creates an account. Codes are stored only
   as a salted hash; sign-in requests and code checks are rate limited.
2. **Profile.** First sign-in asks for name, job title, company, role, what you will monitor and how many models you run.
3. **Workspace.** New users create a workspace (they become its admin), choose a data stream and a default cost regime,
   and can start the first monitored model. People invited to a workspace skip straight to the app.
4. **Dashboard.** Once signed in, opening the app goes to the Overview, never the marketing page. Sessions are
   database-backed and expire after `SESSION_MAX_AGE_DAYS` (default 7).

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Prisma database. Default `file:../data/app.db` (SQLite). Use a `postgresql://` URL with `provider = "postgresql"` in `prisma/schema.prisma` for PostgreSQL. |
| `AUTH_SECRET` | Signs sessions and hashes sign-in codes. Generated automatically in development; set a long random value in production. |
| `AUTH_URL` | Public base URL (used in email links), e.g. `http://localhost:3000`. |
| `SESSION_MAX_AGE_DAYS` | Session lifetime in days (default 7). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | Send email through SMTP (for example Gmail with an app password: host `smtp.gmail.com`, port `587`). Used first when set; reaches any address without a verified domain. |
| `AUTH_RESEND_KEY`, `EMAIL_FROM` | Send email through Resend. Resend delivers to everyone only from a **verified domain**; with its test sender `onboarding@resend.dev` it delivers only to the Resend account owner. If your domain is rejected, the app retries once from the test sender. |
| `CONTACT_EMAIL` | Where the public contact form delivers messages. |
| `LLM_API_KEY` | API key for a hosted OpenAI-compatible endpoint serving open-source models (Groq, OpenRouter, Together, Hugging Face). Never stored in the database or shown in the app. |
| `RETRAINWISE_PYTHON` | Optional path to the engine's Python interpreter. |
| `RETRAINWISE_ALLOWED_HOSTS` | Extra host names allowed to call the API besides localhost (set when deploying behind a domain). |

## Emails

Every email uses one responsive, branded template (`src/lib/email-template.ts`) with a plain-text twin. Preview them at
<http://localhost:3000/dev/emails> (development only, nothing is sent).

* **Sign-in code**: large, readable 6-digit code; expiry and security note.
* **Work reports** (`src/lib/report.ts`): after each action, the person who did it gets a short report with exact
  figures: stream started, batches processed, evaluation results, approval requested / approved / rejected, model
  promoted, rolled back or validated, training queued and finished (with metrics), benchmark queued and finished,
  dataset downloaded, settings changed or reset, team invitations, agent reports, open-source model downloads, welcome
  and workspace-ready emails. Each user can turn these off under **Profile → Notifications**. Sent reports are logged in
  the `EmailReport` table, which also prevents duplicates.
* **Approval requests** to approvers who opted in, and **invitations** to new members.

## Roles

| Role | Can |
|---|---|
| Viewer | Read monitoring, decisions, approved model history, reports and experiments |
| Operator | Run streams and batches, evaluate options, train and validate candidates, run benchmarks, request actions |
| Approver | Everything an operator can, plus approve or reject updates, promote or reject candidates, roll back |
| Admin | Everything, plus team and roles, costs, budgets, guardrails, autonomy, agent and workspace settings |

The server enforces every permission. Neither an operator nor the agent can bypass an approval; a workspace can also
require that one person requests and another approves.

## Open-source models for the agent

The advisory agent explains a decision from stored evidence through read-only tools and can at most prepare a request
for approval. Choose its model on **Agent & audit**:

* **Deterministic**: no language model (default).
* **On this computer (Ollama)**: install [Ollama](https://ollama.com/download) (`winget install Ollama.Ollama` on
  Windows), then download a model from the built-in catalog (Llama 3.2 3B, Llama 3.1 8B, Qwen 2.5 7B, Qwen 3 8B,
  Granite 3.3 8B, Mistral NeMo 12B). Nothing leaves the machine.
* **Hosted open-source**: any OpenAI-compatible endpoint, with presets for Groq, OpenRouter, Together AI, Hugging Face,
  LM Studio and Ollama's `/v1`. Put the key in `LLM_API_KEY`, choose the model (for example `llama-3.3-70b-versatile`)
  and save it as the default.

Language-model output is always shown next to the deterministic, verified figures, and a consistency check flags a
report whose recommendation differs from the engine's.

## How the pieces fit

```
Browser ──► Next.js pages (server components; engine data read-only from per-workspace SQLite)
        └─► Next.js API routes (/api/*, zod-validated, role-checked, rate-limited)
                 ├─► Prisma (accounts, sessions, workspaces, roles, notifications, app audit log, email reports)
                 └─► engine bridge (one long-lived Python process per server)
                          └─► pipeline.Lifecycle / jobs / agent ──► engine/workspaces/<id>/retrainwise.db
                          └─► worker.py processes (training jobs, benchmarks)
```

* Writes and ML work go through `src/lib/engine.ts`, which keeps one Python process running `engine/bridge.py serve`.
  Only allow-listed commands exist; arguments are validated in the API route, the bridge and the engine.
* Slow commands (dataset downloads, language-model explanations, Ollama model downloads) run in separate one-shot
  processes. Training jobs and benchmarks run in `engine/worker.py` with progress and logs in SQLite.
* Duplicate actions are refused (in-flight keys, expected stream positions, unique approvals); audit tables reject
  `UPDATE` and `DELETE` through database triggers.

More detail: [ARCHITECTURE.md](ARCHITECTURE.md), [METHODOLOGY.md](METHODOLOGY.md), [DATASETS.md](DATASETS.md),
[RESEARCH_REPORT.md](RESEARCH_REPORT.md), [docs/UI_GUIDE.md](docs/UI_GUIDE.md).

## Pages

| Page | What you can do |
|---|---|
| **Landing, Docs, Research, Privacy, Terms, Contact** | Public pages; Research reads the benchmark CSVs; Contact emails `CONTACT_EMAIL` |
| **Overview** | Model health, rolling error, staleness estimate, budget, the current recommendation, lifecycle stage, next step, activity |
| **Data & streams** | Choose and download datasets with provenance, inspect schema and rows, set stream options, start streams, process batches |
| **Monitoring** | Error and metrics with intervals, counterfactual staleness (probe DiD), PSI heatmap, ADWIN/DDM, renewal rule, probe log |
| **Decision analysis** | Ranked keep / partial / full with the arithmetic, guardrails, hold-out evidence, sensitivity, what-if, request and approve |
| **Model lifecycle** | Production model, pending approvals, post-update outcomes, rollback, version history, approvals |
| **Models** | Train model (real training with live logs), candidates, versions, job history; version pages with exact metrics, confusion matrix, validation gate, artifact, exports, promote / reject / rollback |
| **Experiments** | Benchmark six policies, live progress, results, traces, CSV export |
| **Agent & audit** | Open-source model explanations, agent-prepared requests, reports with tool calls, filterable and exportable audit trail |
| **Settings** | Workspace, Team (invite, roles), Engine settings (with undo), Pricing assumptions |
| **Profile** | Profile details, notification and email-report preferences, sessions, sign out |

## Database and migrations

```bash
npm run db:migrate     # create and apply a migration after editing prisma/schema.prisma
npm run db:studio      # browse the app database
```

`npm run dev` and `npm run build` apply pending migrations automatically (`prisma migrate deploy`).

## Real datasets (explicit download, never substituted)

Use **Download** on *Data & streams*, or `python engine/datasets.py electricity airlines covertype`. Files and
provenance (source URL, time, SHA-256 checksums, licence) are written to `engine/`. If a real dataset is missing, the
app says so; it never falls back to synthetic data.

## Tests

```bash
npm test
```

Runs the TypeScript type check and the Python engine suite (`engine/test_project.py`: economics, guardrails,
monitors, training, approvals, promotion, rollback, recovery, the agent tool loop and the open-source model provider,
jobs, the bridge, and the probe/DiD/renewal/VOI logic). Engine only: `npm run test:engine`.

## Deployment

RetrainWise runs on **Vercel** as two projects that share one **Neon PostgreSQL** database:

| Project | Root | What it runs |
|---|---|---|
| `retrainwise` | repository root | The Next.js app. `npm run vercel-build` switches Prisma to PostgreSQL, syncs the schema, installs the audit triggers and builds. |
| `retrainwise-engine` | `engine/` | The Python engine as a Vercel Python Function (`engine/app.py`, Python 3.12). |

* **Engine state.** Serverless functions have no persistent disk, so each workspace's engine folder (its SQLite
  database and model artifacts) and every downloaded dataset are stored in PostgreSQL (`EngineStore`,
  `EngineDataset`) by `engine/cloud_store.py`. A request restores the folder when it is stale, runs the command and
  writes it back under a per-workspace advisory lock.
* **Engine connection.** The web project sets `RETRAINWISE_ENGINE_URL` to the engine's URL. Both projects derive the
  same bearer token from the shared database URL, so no secret is copied between them (set
  `RETRAINWISE_ENGINE_TOKEN` on both to override it).
* **Jobs.** Training jobs and benchmarks run inside the request, so a single job must finish within the 300-second
  function limit; payloads are limited to 4.5 MB.
* **Language models.** Ollama is not reachable from Vercel; use hosted open-source models with an API key
  (*Agent & audit → Model API keys*).

Environment for the web project (set in Vercel; never commit them):

| Variable | Value |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Added by the Neon integration (connect it to both projects) |
| `AUTH_SECRET` | Long random string |
| `AUTH_URL` | The public URL, e.g. `https://retrainwise.vercel.app` |
| `SMTP_*` or `AUTH_RESEND_KEY` + `EMAIL_FROM` | Email delivery; with Resend, `EMAIL_FROM` must use a verified domain to reach every address |
| `CONTACT_EMAIL` | Inbox for the contact form |
| `RETRAINWISE_ENGINE_URL` | The engine project's URL, e.g. `https://retrainwise-engine.vercel.app` |
| `LLM_API_KEY` | Optional default key for hosted open-source models |

`node scripts/vercel-env.mjs` uploads the values from `.env.vercel` (falling back to `.env`) and redeploys.

**Container alternative.** `Dockerfile` runs the whole app in one container with SQLite under `/data` (mount a
persistent disk there); `render.yaml` deploys it on Render. Jobs then run in background workers with no time limit.

## Project layout

| Path | Role |
|---|---|
| `src/app/(marketing)/` | Landing, docs, research, privacy, terms, contact |
| `src/app/(app)/` | Signed-in application pages |
| `src/app/signin/`, `src/app/onboarding/` | Code sign-in and first-run setup |
| `src/app/api/` | API routes (validated, role-checked) |
| `src/lib/` | Auth, permissions, engine bridge, queries, email template and reports, OTP |
| `prisma/` | App database schema and migrations |
| `engine/` | The Python lifecycle engine (`pipeline`, `staleness`, `training`, `agent`, `worker`, `bridge`, tests) |
| `scripts/` | Environment setup, Python checks and test helpers |

## Resetting

Stop the app, delete `data/app.db` (accounts and workspaces) and/or `engine/workspaces/` (engine state), then start
again; migrations recreate the database.
