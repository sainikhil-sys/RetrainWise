#!/bin/bash
# Launch RetrainWise from a copy of the working tree (so the committed
# retrainwise.db is never modified) with a local SMTP sink for emailed codes.
# Usage: start.sh [run_dir] [app_port] [smtp_port]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
RUN="${1:-/tmp/retrainwise-run}"; APP_PORT="${2:-8501}"; SMTP_PORT="${3:-2525}"

"$HERE/stop.sh" "$RUN" >/dev/null 2>&1 || true
rm -rf "$RUN/app" && mkdir -p "$RUN/app"
(cd "$REPO" && tar --exclude=.git --exclude=__pycache__ --exclude=.env -cf - .) | tar -xf - -C "$RUN/app"
: > "$RUN/mails.txt"

nohup python "$HERE/smtp_sink.py" "$SMTP_PORT" "$RUN/mails.txt" > "$RUN/smtp.log" 2>&1 &
echo $! > "$RUN/smtp.pid"
cd "$RUN/app"
SMTP_HOST=127.0.0.1 SMTP_PORT="$SMTP_PORT" SMTP_SECURITY=none SMTP_USER=bot@local.test SMTP_PASSWORD=x \
SMTP_FROM="RetrainWise <bot@local.test>" \
  nohup streamlit run app.py --server.headless true --server.port "$APP_PORT" > "$RUN/streamlit.log" 2>&1 &
echo $! > "$RUN/streamlit.pid"

for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$APP_PORT/_stcore/health" >/dev/null; then
    echo "RetrainWise up at http://localhost:$APP_PORT (mail captured in $RUN/mails.txt)"
    exit 0
  fi
  sleep 1
done
echo "App did not become healthy; see $RUN/streamlit.log" >&2
tail -20 "$RUN/streamlit.log" >&2
exit 1
