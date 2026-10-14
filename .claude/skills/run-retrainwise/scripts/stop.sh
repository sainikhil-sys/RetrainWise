#!/bin/bash
# Stop the app and SMTP sink started by start.sh. Usage: stop.sh [run_dir]
RUN="${1:-/tmp/retrainwise-run}"
for name in streamlit smtp; do
  if [ -f "$RUN/$name.pid" ]; then
    kill "$(cat "$RUN/$name.pid")" 2>/dev/null || true
    rm -f "$RUN/$name.pid"
  fi
done
echo "stopped"
