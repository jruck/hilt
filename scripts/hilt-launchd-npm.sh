#!/usr/bin/env bash
set -euo pipefail

# Shared launchd npm wrapper for Hilt calendar jobs.
# Mirrors hilt-supervisor.sh PATH discipline so scheduled Library/Semantic jobs
# use the same nvm Node runtime as the supervised server, not a stray Homebrew
# or /usr/local Node with an incompatible native-module ABI.

if [ "$#" -lt 1 ]; then
    echo "usage: hilt-launchd-npm.sh <npm-script> [args...]" >&2
    exit 64
fi

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SELF_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export HOME="${HOME:-/Users/$(whoami)}"
export DATA_DIR="${DATA_DIR:-$HOME/.hilt/data}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi

# Headless Claude auth for scheduled jobs. Interactive Claude Code stores its OAuth in the macOS
# Keychain, which a launchd job's process cannot reliably reach/refresh — so headless `claude -p`
# (reweave, editor-pass/recommendations) 401s overnight (observed on Mercury 2026-06-20; Hestia was
# immune because it used file-based creds). Export the long-lived CLAUDE_CODE_OAUTH_TOKEN minted by
# `claude setup-token` (stored in .env.local) so every scheduled job and its child `claude` inherit it.
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -f "$PROJECT_DIR/.env.local" ]; then
    token_line="$(grep -E '^CLAUDE_CODE_OAUTH_TOKEN=' "$PROJECT_DIR/.env.local" | tail -1 || true)"
    if [ -n "$token_line" ]; then
        CLAUDE_CODE_OAUTH_TOKEN="${token_line#CLAUDE_CODE_OAUTH_TOKEN=}"
        CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN%\"}"; CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN#\"}"
        export CLAUDE_CODE_OAUTH_TOKEN
    fi
fi

SCRIPT="$1"
shift

if [ "$#" -gt 0 ]; then
    exec npm run "$SCRIPT" -- "$@"
fi

exec npm run "$SCRIPT"
