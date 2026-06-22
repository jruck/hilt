#!/usr/bin/env bash
set -euo pipefail

# Hilt headless supervisor wrapper (docs/plans/supervisor-v1.md).
# Run by the com.hilt.supervisor LaunchAgent (KeepAlive); owns the machine's
# Hilt serving stack and the dev/prod mode-switch intents.
#
# PATH discipline matters here: launchd hands agents a minimal environment,
# which is exactly how a stale /usr/local/bin/node broke Mercury's Electron
# spawns (CHANGELOG 2026-06-10). Mirror the .app launcher: Homebrew before
# /usr/local, and an nvm prepend that wins when nvm is present.

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SELF_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export HOME="${HOME:-/Users/$(whoami)}"
export DATA_DIR="${DATA_DIR:-$HOME/.hilt/data}"
export WS_PORT="${WS_PORT:-3100}"
# The ws-server owns background sync daemons. The superseded launchd dev
# wrapper enabled Granola here; keep that contract when the supervisor owns
# ws-server so meeting notes continue syncing after reboot/cutover.
export HILT_GRANOLA_SYNC_DAEMON="${HILT_GRANOLA_SYNC_DAEMON:-1}"
# The supervised server is the always-on store-of-record for performance telemetry:
# it runs the metrics collector and treats Hestia as the closet-sensor owner.
export HILT_METRICS_COLLECTOR="${HILT_METRICS_COLLECTOR:-1}"
export HILT_METRICS_CLOSET_MACHINE="${HILT_METRICS_CLOSET_MACHINE:-hestia}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

exec ./node_modules/.bin/tsx server/supervisor.ts
