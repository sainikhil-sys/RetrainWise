#!/bin/bash
# Installs RetrainWise's Node dependencies in Claude Code cloud sessions so the
# app, tests, typecheck and browser walkthrough work immediately.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"
npm install --no-audit --no-fund --loglevel=error
