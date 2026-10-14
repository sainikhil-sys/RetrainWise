---
name: run-retrainwise
description: Launch the RetrainWise Next.js app and drive it in a browser (sign up with an emailed code, start the demo, process batches, evaluate, approve, run a benchmark, explain, reset password). Use when asked to run, start, demo or screenshot the app, or to confirm a change works in the real app.
---

# Run RetrainWise

The app is a Next.js server (`npm run dev`). Every page requires a verified account, so running it means signing
up and entering a 6-digit code that arrives by email. These scripts run a local SMTP server that captures that
email, so the app's real nodemailer delivery path runs without a mail provider or credentials.

Dependencies are installed by `.claude/hooks/session-start.sh` in cloud sessions; elsewhere run `npm install`.

## 1. Start

```bash
.claude/skills/run-retrainwise/scripts/start.sh
```

- Runs `next dev` on <http://localhost:3000> with `RETRAINWISE_DATA_DIR=/tmp/retrainwise-run/data`, so the repo's
  own `data/` folder is untouched. Each start wipes that scratch state.
- Captured mail: `/tmp/retrainwise-run/mails.txt`. Logs: `/tmp/retrainwise-run/next.log`, `smtp.log`.
- Optional arguments: `start.sh <run_dir> <app_port> <smtp_port>`.
- The first request to each page compiles it, so the first visit can take a few seconds.

## 2. Drive

```bash
node .claude/skills/run-retrainwise/scripts/drive.mjs
```

Signs up a fresh `user<timestamp>@example.com`, reads the code from `mails.txt`, verifies, starts the offline demo,
processes 9 batches, opens Monitoring, evaluates on Decision analysis, approves the recommended action on Model
lifecycle, runs a two-policy benchmark job, generates a deterministic explanation, then signs out, resets the
password with a second emailed code and signs in again. It prints one line per step and saves screenshots to
`/tmp/retrainwise-run/shots/` (`failure.png` on the first failed step). **Open the screenshots and look at them**;
a blank page means the app failed to render. Extend `drive.mjs` with steps for the pages your change touches.

Playwright (`playwright-core`, a dev dependency) uses the pre-installed Chromium at `/opt/pw-browsers/chromium`
(override with `CHROMIUM_PATH`). Never run `playwright install`.

## 3. Stop

```bash
.claude/skills/run-retrainwise/scripts/stop.sh
```

Both processes run in their own process group and are stopped completely. Do not use `pkill -f` with a pattern
that also appears in your own command line.

## Real email

To test against a real provider, put SMTP settings in `.env` (see `.env.example`) and check them first:

```bash
npm run mail:check
npm run mail:test -- you@example.com
```

## Checks before pushing

```bash
npm run typecheck
npm test
npm run build
```
