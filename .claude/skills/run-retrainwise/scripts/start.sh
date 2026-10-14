#!/bin/bash
# Launch RetrainWise (next dev) with its state in a scratch data directory (the
# repo's own data/ is untouched) and a local SMTP sink that captures emailed codes.
# Both run in their own process group so stop.sh can end them completely.
# Usage: start.sh [run_dir] [app_port] [smtp_port]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
RUN="${1:-/tmp/retrainwise-run}"; APP_PORT="${2:-3000}"; SMTP_PORT="${3:-2525}"

"$HERE/stop.sh" "$RUN" >/dev/null 2>&1 || true
rm -rf "$RUN" && mkdir -p "$RUN/data"
: > "$RUN/mails.txt"
[ -d "$REPO/node_modules" ] || (cd "$REPO" && npm install --no-audit --no-fund --loglevel=error)

setsid nohup node "$HERE/smtp_sink.mjs" "$SMTP_PORT" "$RUN/mails.txt" > "$RUN/smtp.log" 2>&1 &
echo $! > "$RUN/smtp.pid"
cd "$REPO"
RETRAINWISE_DATA_DIR="$RUN/data" SMTP_HOST=127.0.0.1 SMTP_PORT="$SMTP_PORT" SMTP_SECURITY=none \
SMTP_USER=bot@local.test SMTP_PASSWORD=x SMTP_FROM="RetrainWise <bot@local.test>" NEXT_TELEMETRY_DISABLED=1 \
  setsid nohup npx next dev -p "$APP_PORT" > "$RUN/next.log" 2>&1 &
echo $! > "$RUN/next.pid"

for _ in $(seq 1 90); do
  if curl -s -o /dev/null "http://localhost:$APP_PORT/signin"; then
    echo "RetrainWise up at http://localhost:$APP_PORT (mail captured in $RUN/mails.txt, state in $RUN/data)"
    exit 0
  fi
  sleep 1
done
echo "App did not start; see $RUN/next.log" >&2
tail -20 "$RUN/next.log" >&2
exit 1
