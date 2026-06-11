#!/usr/bin/env bash
set -euo pipefail

# Always-on Hilt gateway service (see ~/work/meta/internal-app-gateway-plan.md):
# production app-server (Next + ${basePath}/events upgrade proxy) on :3000 with
# NEXT_PUBLIC_BASE_PATH=/hilt, plus the internal ws-server on 127.0.0.1.
# Supervised by the com.hilt.gateway LaunchAgent; replaces the old
# com.hilt.dev-server agent that ran `npm run dev:all` in dev mode.

cd /Users/jruck/work/engineering/me/hilt

export HOME="${HOME:-/Users/jruck}"
export DATA_DIR="${DATA_DIR:-$HOME/.hilt/data}"
export WS_PORT="${WS_PORT:-3100}"
export HILT_GRANOLA_SYNC_DAEMON="${HILT_GRANOLA_SYNC_DAEMON:-1}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

is_hilt_up() {
  # A Hilt already serving :3000 — gateway (prefixed) or a manual dev session
  # (unprefixed). Either way, wait rather than crash-looping on EADDRINUSE.
  /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:3000/hilt/api/ws-port" >/dev/null 2>&1 ||
    /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:3000/api/ws-port" >/dev/null 2>&1
}

if is_hilt_up; then
  echo "Existing Hilt server detected on port 3000; launchd will wait instead of starting a duplicate."
  while is_hilt_up; do
    /bin/sleep 30
  done
  echo "Existing Hilt server disappeared; launchd is taking over."
fi

# First-boot convenience: build the gateway bundle if it has never been built.
# Rebuilds after code changes stay manual: npm run build:gateway, then
# `launchctl kickstart -k gui/$(id -u)/com.hilt.gateway`.
if [ ! -f ".next-gateway/BUILD_ID" ]; then
  echo "No .next-gateway build found; running npm run build:gateway..."
  /opt/homebrew/bin/npm run build:gateway
fi

exec /opt/homebrew/bin/npm run serve:gateway
