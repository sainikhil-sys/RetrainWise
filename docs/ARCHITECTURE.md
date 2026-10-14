# Architecture

RetrainWise is one Next.js (App Router) application. Pages are server components that read state directly from
the library in `src/lib`; every change goes through a server action. There is no separate API server and no
external service apart from SMTP (accounts) and, optionally, a local Ollama.

```
Browser ──► middleware (session cookie present?) ──► (auth) pages ─┐
                                                   └► (app) pages ─┤ server actions
                                                                   ▼
            ┌──────────────── src/lib ──────────────────────────────────────────┐
            │ auth/      accounts, codes, sessions, SMTP mailer                 │
            │ lifecycle  runs, batches, decisions, approval, promotion, rollback │
            │   ├─ monitoring   PSI, ADWIN, DDM, drift status, triggers   (L1)  │
            │   ├─ economics    costs, benefit, guardrails, ranking       (L2)  │
            │   ├─ ml/          preprocessing, SGD, shadow evaluation, gate     │
            │   └─ datasets     synthetic stream, downloads, provenance         │
            │ agent      bounded tools, Ollama loop, deterministic reports (L3) │
            │ experiments + jobs   policy benchmark, background jobs            │
            │ db         SQLite (better-sqlite3), BEGIN IMMEDIATE transactions   │
            └───────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
               data/  retrainwise.db · models/*.json · datasets/ · results/
```

## Layers

* **L1 Monitoring** (`monitoring.ts`): prequential metrics on revealed labels, rolling error with a Wilson
  interval, ADWIN and DDM on the 0/1 error stream, PSI against bins fixed from the model's training window,
  learning debt, and the evaluation trigger. PSI is reported as covariate shift only.
* **L2 Decision** (`economics.ts`, `ml/models.ts`): chronological shadow evaluation of a full and a partial
  candidate, itemised simulated costs, expected benefit with uncertainty, guardrails and ranking against the
  zero-value *defer* reference.
* **L3 Agent** (`agent.ts`): explanations from bounded, schema-validated, read-only tools. The agent can at most
  record an execution request; it never executes.
* **L4 Lifecycle** (`lifecycle.ts`): approval, guardrail re-check, artifact checksum, validation gate, promotion,
  post-update tracking, rollback and bounded autonomy.

## Guarantees

* **Approval is enforced in code.** Manual execution needs an explicit approval; autonomy needs the setting on and
  its action and cost limits. Each decision accepts at most one approval (UNIQUE constraint).
* **Idempotency.** Batch processing carries the expected stream position; decisions are keyed by run, position,
  model version and settings hash, so repeated clicks reuse the stored decision and are never charged twice.
* **No leakage.** Preprocessing is fitted on each training window only; candidates are scored on the most recent
  labelled rows that no compared model saw; incremental updates refuse rows the model already learned from.
* **Integrity.** Model artifacts are JSON files whose SHA-256 is stored in the registry and checked before loading.
* **Recovery.** Executions in flight when the server stopped are marked `interrupted`; background jobs whose
  heartbeat stopped are marked `interrupted`. Nothing resumes silently.
* **Accounts.** Every page and server action re-validates the session against SQLite (the middleware only checks
  that a cookie exists). Passwords use scrypt; codes and session tokens are stored as SHA-256 digests.

## Concurrency

All ML work is synchronous and fast (milliseconds per batch), so a server action runs to completion without
interleaving with another. Benchmarks are long, so they run as in-process background jobs that yield to the event
loop between batches, write progress and heartbeats to SQLite, and check a cancellation flag. One job runs at a
time and identical submissions are deduplicated.
