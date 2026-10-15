import type { Metadata } from "next";
import Link from "next/link";

import { DocPage, DocSection } from "../_components/doc-page";

export const metadata: Metadata = {
  title: "Documentation",
  description: "How to use RetrainWise: sign-in, onboarding, streams, monitoring, decisions, training, approvals, experiments, roles, email reports and self-hosting.",
};

const TOC = [
  { id: "start", label: "Getting started" },
  { id: "concepts", label: "Key concepts" },
  { id: "data", label: "Data & streams" },
  { id: "monitoring", label: "Monitoring" },
  { id: "decisions", label: "Decision analysis" },
  { id: "models", label: "Models & training" },
  { id: "lifecycle", label: "Lifecycle & rollback" },
  { id: "experiments", label: "Experiments" },
  { id: "agent", label: "Agent & audit" },
  { id: "roles", label: "Roles & approvals" },
  { id: "emails", label: "Emails & notifications" },
  { id: "settings", label: "Settings" },
  { id: "keyboard", label: "Keyboard shortcuts" },
  { id: "self-host", label: "Install & self-host" },
  { id: "faq", label: "FAQ" },
];

export default function DocsPage() {
  return (
    <DocPage
      eyebrow="Documentation"
      title="Using RetrainWise"
      intro="Everything you need to monitor a model, decide whether to update it, train and validate candidates, and keep a clean record of who approved what."
      toc={TOC}
    >
      <DocSection id="start" title="Getting started">
        <ol className="list">
          <li>
            <strong>Sign in with your email.</strong> Enter any email address on the <Link href="/signin">sign-in page</Link>. We send a 6-digit code that works once and expires after 10 minutes. There are no passwords. A new address creates an account.
          </li>
          <li>
            <strong>Complete your profile.</strong> On first sign-in you add your name, job title, company, role and what you plan to monitor. Teammates see your name in approvals and the audit trail.
          </li>
          <li>
            <strong>Set up a workspace.</strong> Name the workspace, choose a data stream and a default cost regime, and optionally start your first monitored model. If you were invited, you join the existing workspace instead.
          </li>
          <li>
            <strong>Work from the dashboard.</strong> After setup, opening RetrainWise always takes you to the Overview. Process batches, evaluate update options, and follow the &ldquo;next step&rdquo; suggestion.
          </li>
        </ol>
      </DocSection>

      <DocSection id="concepts" title="Key concepts">
        <ul>
          <li>
            <strong>Stream.</strong> A dataset replayed in source order, batch by batch. Each batch is predicted before its labels arrive, as in production.
          </li>
          <li>
            <strong>Avoidable staleness.</strong> The part of the error a refreshed model could remove, estimated by comparing the deployed model with a fresh probe model (difference-in-differences).
          </li>
          <li>
            <strong>Decision.</strong> A ranked comparison of keeping the model, a partial (incremental) update and a full retrain, by net expected value under guardrails.
          </li>
          <li>
            <strong>Candidate.</strong> A trained model that has not been promoted. Only an approver can promote it to production.
          </li>
          <li>
            <strong>Simulated cost.</strong> Prices come from an assumed price snapshot and your settings, not a billing API. They are labelled wherever they appear.
          </li>
        </ul>
      </DocSection>

      <DocSection id="data" title="Data & streams">
        <p>
          Choose the synthetic stream (generated locally, with known drift points) or a real dataset (Electricity, Airlines, Covertype). Real datasets are downloaded from their original sources with checksums and a provenance record; synthetic data is never substituted for them. Set the sample size, seed, batch size, label delay and label availability, then start the stream. Starting a new stream closes the previous one; its history stays in the audit trail.
        </p>
      </DocSection>

      <DocSection id="monitoring" title="Monitoring">
        <p>
          Monitoring shows rolling error with a 95% interval, per-batch accuracy, precision, recall and F1, per-feature drift (PSI), the ADWIN and DDM detectors, the probe log and the renewal rule. When inputs drift but error does not, it says so: drift alone is not a reason to retrain.
        </p>
      </DocSection>

      <DocSection id="decisions" title="Decision analysis">
        <pre>
          <code>{`Expected benefit = avoidable error reduction × horizon × value of one error
Total cost       = compute + engineering + validation + deployment risk + probe
Net value        = benefit − cost`}</code>
        </pre>
        <p>
          Press <strong>Evaluate update options</strong> once enough labels have arrived. Candidates are trained on earlier rows and scored on the newest labelled rows. The page shows the arithmetic for each option, every guardrail, the hold-out evidence, a sensitivity table and a what-if explorer that never changes stored data. Operators request an action; approvers approve or reject it.
        </p>
      </DocSection>

      <DocSection id="models" title="Models & training">
        <p>
          <strong>Train model</strong> runs real training on your machine: choose the data (the active stream or a dataset window), target column, validation split, model type (logistic regression, linear SVM, robust linear classifier, random forest), hyperparameters, preprocessing and seed. You confirm the scope before anything starts. Progress and worker logs stream live, and you can cancel before a candidate is registered.
        </p>
        <ul>
          <li>
            <strong>Train</strong> fits the model on chronologically earlier rows.
          </li>
          <li>
            <strong>Validate</strong> scores the candidate and production on withheld, later rows.
          </li>
          <li>
            <strong>Promote</strong> replaces production only after an approver accepts and the checks pass again.
          </li>
        </ul>
        <p>Metrics are shown rounded (for example 87.42%) but stored and exported at full precision. Each version page has CSV and JSON exports.</p>
      </DocSection>

      <DocSection id="lifecycle" title="Lifecycle & rollback">
        <p>
          Model lifecycle lists every version of the stream with its checksum, lineage, training rows and validation result. After a promotion, the new and retired models predict the same rows; the measured gain calibrates future decisions. Approvers can roll back to any archived version; its checksum is verified first.
        </p>
      </DocSection>

      <DocSection id="experiments" title="Experiments">
        <p>
          Replay streams under all six policies with identical labels and price traces, then compare accuracy against total cost per dataset and price regime. The reference results shipped with the project are available too, and the <Link href="/research">research page</Link> summarises them.
        </p>
      </DocSection>

      <DocSection id="agent" title="Agent & audit">
        <p>
          The advisory agent explains a decision from stored evidence through read-only tools. It runs deterministically by default; it can also use an open-source language model running locally through Ollama or an OpenAI-compatible endpoint. It may prepare a request, which goes to approvers like any other. It cannot approve, promote or roll back. Every action, by people or the agent, is recorded in an append-only audit trail that can be filtered and exported.
        </p>
      </DocSection>

      <DocSection id="roles" title="Roles & approvals">
        <ul>
          <li>
            <strong>Viewer</strong> reads monitoring, decisions, approved model history, reports and experiments.
          </li>
          <li>
            <strong>Operator</strong> runs streams, evaluates options, trains candidates, runs benchmarks and requests actions.
          </li>
          <li>
            <strong>Approver</strong> also approves or rejects updates, promotions and rollbacks.
          </li>
          <li>
            <strong>Admin</strong> also manages the team, costs, budgets, guardrails and workspace settings.
          </li>
        </ul>
        <p>A workspace can require that updates are requested by one person and approved by another. The server enforces every rule, including for the agent.</p>
      </DocSection>

      <DocSection id="emails" title="Emails & notifications">
        <p>
          You receive a formatted work report by email after each action: stream started, batches processed, evaluation results, approval requests and outcomes, promotions and rollbacks, training and benchmark completion with exact metrics, dataset downloads, settings and team changes. Approvers can also get approval requests by email. In-app notifications appear under the bell icon. Turn emails on or off on your <strong>Profile</strong> page.
        </p>
      </DocSection>

      <DocSection id="settings" title="Settings">
        <p>
          <strong>Workspace</strong> (name, default cost regime, separate approver rule), <strong>Team</strong> (invite, change roles, remove), <strong>Engine</strong> (economics, guardrails, probe scheduling, monitoring, stream, model and agent settings, with undo after saving) and <strong>Pricing</strong> (the assumed price snapshot). Every value is validated in the browser and again by the engine.
        </p>
      </DocSection>

      <DocSection id="keyboard" title="Keyboard shortcuts">
        <ul>
          <li>
            <code>⌘K</code> / <code>Ctrl K</code>: search and run commands
          </li>
          <li>
            <code>B</code>: process the next batch · <code>E</code>: evaluate update options · <code>R</code>: open the recommendation
          </li>
          <li>
            <code>G</code> then a letter: go to a page (for example <code>G M</code> for Monitoring) · <code>?</code>: all shortcuts
          </li>
        </ul>
      </DocSection>

      <DocSection id="self-host" title="Install & self-host">
        <p>RetrainWise is local-first: the web app, the database and the Python engine run on your machine.</p>
        <pre>
          <code>{`git clone https://github.com/sainikhil-sys/RetrainWise.git
cd RetrainWise
npm install
npm run setup:python   # creates the engine's Python environment
npm run dev            # http://localhost:3000`}</code>
        </pre>
        <p>
          Configure email in <code>.env</code>: either SMTP (for example Gmail with an app password) or Resend with a verified sending domain. Without either, development builds keep emails in a local outbox at <code>/dev/mailbox</code>. The engine needs a long-running server with Python 3.10–3.12, so host it on a VM or container platform rather than a serverless-only host.
        </p>
      </DocSection>

      <DocSection id="faq" title="FAQ">
        <p>
          <strong>Does RetrainWise change production on its own?</strong> No. Updates need a person&apos;s approval. Bounded autonomy exists but is off by default, admin-only and capped.
        </p>
        <p>
          <strong>Are the dollar figures real?</strong> No. They come from assumed prices and are labelled as simulated. Replace them with your own in Settings.
        </p>
        <p>
          <strong>Does it always beat a retraining schedule?</strong> No. When models age quickly and retraining is cheap, a calendar schedule can cost less. See <Link href="/research#losses">where it loses</Link>.
        </p>
        <p>
          <strong>Need help?</strong> <Link href="/contact">Contact us</Link>.
        </p>
      </DocSection>
    </DocPage>
  );
}
