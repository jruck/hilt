# Live Library Intake Handoff

Status: paused safely on 2026-07-09. The implementation is work in progress and is not committed.

## Implemented

- Stable `artifact_uid`, `source_title`, and structured `processing` metadata.
- Placeholder-first intake with a durable per-vault queue under `DATA_DIR`.
- Checkpointed metadata, capture/transcription, digest, and reweave progress.
- A serial on-demand queue worker with restart recovery, blocked states, and retry support.
- Fast source intake and processing retry API routes.
- Adaptive intake polling in the WebSocket server: immediate Library activation, 60-second foreground polling, and 5-minute background polling.
- Dedicated saved-reference, candidate, and queue watchers with debounced Library WebSocket events.
- Live SWR updates with a five-second fallback only while WebSocket delivery is disconnected.
- Toolbar and mobile refresh through fast intake without a page reload.
- Processing states in feed cards, list rows, and the detail pane, including stable layout, retry actions, active-item pinning, and reduced-motion behavior.
- Read-state and recommendation exclusions while an item is processing.
- Legacy ingestion compatibility through placeholder intake followed by an awaited queue drain.
- Intake daemon and processing queue fields in operational health.

## Verification

- `node --import tsx --test src/lib/library/**/*.test.ts`: 147 tests, 144 passed, 0 failed, 3 pre-existing skips.
- `node --import tsx --test server/watchers/library-watcher.test.ts`: 2 passed, 0 failed.
- `npx tsc --noEmit` passed at the final handoff check.
- The isolated E2E harness deletes its temporary home, vault, data directory, and Next.js build in `finally`, restores `tsconfig.json`, and verifies the real Library tree is unchanged.
- No `.next-library-live-e2e-*` or `/tmp/hilt-library-live-e2e-*` artifacts remain.

`npm run test:library` cannot create the `tsx` IPC socket in the current sandbox (`listen EPERM`), so the equivalent Node loader command above was used successfully.

## Exact Resume Point

The deterministic Playwright run now proves that placeholders appear and the queue worker takes the ready fixture through processing. It stops at one brittle reader-content assertion:

```text
scripts/library-live-intake-e2e.ts:135
getByText(/stronger coding|instruction following/i)
```

The ready item had already detached its processing state and only the intentionally blocked fixture remained in the queue. Replace that content-specific assertion with a robust in-place reader update check: retain the stable artifact ID, observe processing disappear, and assert non-placeholder digest/content. Then continue the existing E2E assertions instead of debugging the worker again.

After that:

1. Run `LIVE_SMOKE=0 node --import tsx scripts/library-live-intake-e2e.ts`.
2. Run the isolated reachable OpenAI blog smoke test.
3. Finish the Architecture, Data Models, API, Design Philosophy, and Changelog documentation.
4. Rerun TypeScript and Library/server tests.
5. Run `npm run rebuild` so the production daily-driver app receives the changes.

## Safety Notes

- The E2E refuses to use a vault outside its sentinel temporary directory.
- The latest run verified that the real Library tree did not change.
- Preserve all pre-existing dirty-worktree changes, including the candidate-promotion/series work.
- Untracked `--full-page` and `.gate-shots/` were present before this work and were left untouched.
