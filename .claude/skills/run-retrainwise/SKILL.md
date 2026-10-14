---
name: run-retrainwise
description: Launch the RetrainWise Streamlit app and drive it in a browser (sign up, emailed verification code, Overview, Model lifecycle, password reset). Use when asked to run, start, demo or screenshot the app, or to confirm a change works in the real app.
---

# Run RetrainWise

The app is `streamlit run app.py`. It requires a verified account, so running it means
signing up and entering a 6-digit code that arrives by email. These scripts run a local
SMTP server that captures that email, so the app's real `smtplib` delivery path runs
without any mail provider or credentials.

Dependencies are installed by `.claude/hooks/session-start.sh` in cloud sessions. Elsewhere:
`pip install -r requirements.txt playwright==1.64.0`.

## 1. Start

```bash
.claude/skills/run-retrainwise/scripts/start.sh
```

- Copies the working tree (without `.git` or `.env`) to `/tmp/retrainwise-run/app` and runs it
  there, so the committed `retrainwise.db` (demo state) is never modified. Uncommitted edits
  are included; re-run `start.sh` after changing code.
- App: <http://localhost:8501>. Captured mail: `/tmp/retrainwise-run/mails.txt`.
- Logs: `/tmp/retrainwise-run/streamlit.log`, `/tmp/retrainwise-run/smtp.log`.
- Optional arguments: `start.sh <run_dir> <app_port> <smtp_port>`.

## 2. Drive

```bash
python .claude/skills/run-retrainwise/scripts/drive.py
```

Signs up a fresh `user<timestamp>@example.com`, reads the code from `mails.txt`, verifies,
opens Overview and Model lifecycle, signs out, resets the password with a second emailed code
and signs in again. Screenshots go to `/tmp/retrainwise-run/shots/`. **Open the screenshots
and look at them**; a blank frame means the app failed to render. Extend `drive.py` with
clicks on the pages your change touches.

Playwright uses the pre-installed Chromium at `/opt/pw-browsers/chromium` (override with
`CHROMIUM_PATH`). Never run `playwright install`.

## 3. Stop

```bash
.claude/skills/run-retrainwise/scripts/stop.sh
```

## Real email

To test against a real provider instead of the sink, put SMTP settings in `.env` (see
`.env.example`) and check them first:

```bash
python auth.py --check
python auth.py --test-email you@example.com
```

then run `streamlit run app.py` from the repo root. Note this writes user accounts into the
repo's `retrainwise.db`; do not commit that change.

## Troubleshooting

- "No code was emailed": the sign-up screen shows the SMTP error; also check `smtp.log`.
- Port already in use: `stop.sh`, or pass different ports to `start.sh`.
- Tests: `python -m unittest test_project -v` (the `AuthTests` class covers sign-in flows).
