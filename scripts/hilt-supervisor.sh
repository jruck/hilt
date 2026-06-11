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
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

exec ./node_modules/.bin/tsx server/supervisor.ts
