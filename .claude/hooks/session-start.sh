#!/bin/bash
# Installs RetrainWise dependencies in Claude Code cloud sessions so the app,
# tests, linter and browser walkthrough work immediately.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
python -m pip install --quiet --disable-pip-version-check --root-user-action=ignore \
  -r requirements.txt playwright==1.64.0 pyflakes==4.0.3

# Playwright must use the pre-installed Chromium; never download browsers.
echo 'export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' >> "${CLAUDE_ENV_FILE:-/dev/null}"
