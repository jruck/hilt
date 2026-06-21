#!/usr/bin/env bash
set -euo pipefail

# Hilt System Agent wrapper (docs/plans/system-agent-mode.md).
# Run by the com.hilt.system-agent LaunchAgent (KeepAlive). Serves ONLY the
# read-only System snapshot routes on 127.0.0.1; exposed to peers via Tailscale
# Serve. Deliberately does NOT start ws-server, daemons, or runners.
#
# PATH discipline matters here: launchd hands agents a minimal environment.
# Mirror the supervisor wrapper (Homebrew before /usr/local, nvm prepend), and
# additionally ensure the `tailscale` binary resolves — machine identity shells
# out to `tailscale status` (CHANGELOG: stale node broke Mercury's spawns).

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SELF_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export HOME="${HOME:-/Users/$(whoami)}"
export DATA_DIR="${DATA_DIR:-$HOME/.hilt/data}"
export HILT_SYSTEM_AGENT_PORT="${HILT_SYSTEM_AGENT_PORT:-3200}"
# Homebrew + standalone CLI + the Tailscale.app bundle so `tailscale` resolves.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/Applications/Tailscale.app/Contents/MacOS:${PATH:-}"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

ulimit -n 65536 2>/dev/null || ulimit -n 4096 2>/dev/null || true

exec ./node_modules/.bin/tsx server/system-agent.ts
