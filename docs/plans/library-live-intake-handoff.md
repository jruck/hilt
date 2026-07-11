# Live Library Intake Handoff

Status: completed and verified on 2026-07-10. The foundational implementation was committed in `65663ad`; the final verification hardening is in the current worktree.

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

- `node --import tsx --test src/lib/library/**/*.test.ts`: 148 tests, 145 passed, 0 failed, 3 pre-existing skips.
- `node --import tsx --test server/watchers/library-watcher.test.ts`: 2 passed, 0 failed.
- `npx tsc --noEmit`: passed.
- `LIVE_SMOKE=0 npm run test:library:e2e`: passed the complete isolated desktop/mobile journey.
- `npm run rebuild`: passed, including TypeScript, route generation, and `check:build-artifacts` (with the existing optional `sqlite-vec` and broad NFT trace warnings).
- The retained screenshot run was inspected for media stability, action overlap, processing/blocked clarity, and reduced-motion behavior, then its sentinel workspace was removed.
- The separate live OpenAI smoke reached the public URL but received upstream HTTP 403; this is reported independently and did not replace the deterministic source fixture.
- Live acceptance on 2026-07-10 recovered a real Raindrop save (`Introducing GPT-Live`): after reloading the stale pre-feature ws-server, foreground intake discovered it immediately, the card rendered in Recent, processing reached `ready` in about five seconds, and the next one-minute poll completed cleanly. The headless supervisor now reloads ws-server on rebuild stamps so this deployment gap does not recur.
- The harness deletes temporary home/vault/data/build artifacts, restores `tsconfig.json`, and compares the real Library tree before/after.

## Completion Hardening

- Replaced fixture-prose matching with a reader contract assertion: stable ID, processing detaches, and the placeholder body becomes a rendered digest.
- Fixed deep-scroll restoration so an event anchor waits for the arriving stable ID instead of being consumed by the notice render.
- Preserved watcher `add` semantics when immediate processing writes arrive inside the same debounce window.
- Tested the blocked detail Retry action through requeue and terminal exhaustion.
- Added the active artifact to queue health and UI status.
- Corrected the mobile synthetic pull gesture to span a render frame and made the E2E cleanup resilient to failed response waits.
- Closed the real-live follow-up failures: status-aware candidate promotion prevents repeated foreground polls from creating suffixed copies; the supervised PATH and Claude resolver support `~/.local/bin`; pending reweaves show static status and no provisional worth; successful repair reweaves complete the processing timeline. The 22 generated YouTube copies were backed up to `/tmp/hilt-library-duplicate-recovery-20260710-100914.tar.gz`, removed, and their canonical originals retained with stable IDs.

## Safety Notes

- The E2E refuses to use a vault outside its sentinel temporary directory.
- The final runs verified that the real Library tree did not change.
- Preserve all pre-existing dirty-worktree changes, including the candidate-promotion/series work.
- Untracked `--full-page` and `.gate-shots/` were present before this work and were left untouched.
