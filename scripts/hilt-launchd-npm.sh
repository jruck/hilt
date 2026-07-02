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
# $HOME/.local/bin MUST lead: it holds the official Claude Code installer's `claude` symlink
# (always the current version). Without it, launchd jobs resolve /usr/local/bin/claude — a fossil
# npm-era v1.0.38 that silently ran the briefing for days and instantly rejects modern flags
# (`--append-system-prompt-file`), which broke every nightly reweave item in ~2s with a swallowed
# "unknown option" (diagnosed 2026-07-02; the 03:35 attempts-file mtime was the tell).
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
if [ -d "$HOME/.nvm/versions/node" ]; then
    NODE_DIR=$(ls -1 "$HOME/.nvm/versions/node" | tail -1)
    if [ -n "$NODE_DIR" ]; then
        export PATH="$HOME/.nvm/versions/node/$NODE_DIR/bin:$PATH"
    fi
fi
# Belt-and-suspenders (Codex review 2026-07-02): the nvm prepend above can reintroduce a stale npm
# `claude` ahead of ~/.local/bin on machines that have one. resolveClaudeBin() honors CLAUDE_PATH
# first — pin it to the installer symlink explicitly so PATH ordering can never select the wrong CLI.
if [ -z "${CLAUDE_PATH:-}" ] && [ -x "$HOME/.local/bin/claude" ]; then
    export CLAUDE_PATH="$HOME/.local/bin/claude"
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

# Provider API keys for the `summarize` CLI (the L1 digest). summarize reads keys from the ENVIRONMENT,
# not from its own ~/.summarize/config.json "env" block — so without this the scheduled ingest can't
# summarize and items land as raw dumps. Export every key from that config's env block (values live in
# the machine-local config, not in this script); don't override anything already set.
if [ -f "$HOME/.summarize/config.json" ] && command -v python3 >/dev/null 2>&1; then
    while IFS='=' read -r _sk _sv; do
        if [ -n "$_sk" ] && [ -z "${!_sk:-}" ]; then export "$_sk=$_sv"; fi
    done < <(python3 -c 'import json, sys
try:
    for k, v in json.load(open(sys.argv[1])).get("env", {}).items():
        if isinstance(v, str) and v:
            print(f"{k}={v}")
except Exception:
    pass' "$HOME/.summarize/config.json")
fi

SCRIPT="$1"
shift

if [ "$#" -gt 0 ]; then
    exec npm run "$SCRIPT" -- "$@"
fi

exec npm run "$SCRIPT"
