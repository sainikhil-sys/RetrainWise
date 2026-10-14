#!/bin/bash
# Stop the app and SMTP sink started by start.sh. Usage: stop.sh [run_dir]
RUN="${1:-/tmp/retrainwise-run}"
for name in next smtp; do
  if [ -f "$RUN/$name.pid" ]; then
    pid="$(cat "$RUN/$name.pid")"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    rm -f "$RUN/$name.pid"
  fi
done
echo "stopped"
