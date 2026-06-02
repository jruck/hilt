#!/usr/bin/env bash
set -euo pipefail

cd /Users/jruck/work/engineering/me/hilt

export HOME="${HOME:-/Users/jruck}"
export DATA_DIR="${DATA_DIR:-$HOME/.hilt/data}"
export WS_PORT="${WS_PORT:-3100}"
export HILT_GRANOLA_SYNC_DAEMON="${HILT_GRANOLA_SYNC_DAEMON:-1}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

is_hilt_up() {
  /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:3000/api/ws-port" >/dev/null 2>&1
}

if is_hilt_up; then
  echo "Existing Hilt server detected on port 3000; launchd will wait instead of starting a duplicate."
  while is_hilt_up; do
    /bin/sleep 30
  done
  echo "Existing Hilt server disappeared; launchd is taking over."
fi

exec /opt/homebrew/bin/npm run dev:all
