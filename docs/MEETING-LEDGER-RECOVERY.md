# Meeting Ledger Operations and Recovery

The meeting ledger is canonical operational state at:

```text
${DATA_DIR}/meeting-ledgers/<vault-key>/meeting-ledger.sqlite
```

Proposal and accepted-task Markdown remain canonical user objects. The loop verdict JSONL remains the external decision audit. The SQLite ledger owns commitment identity, evidence, applied decision state, meeting summaries, processed-meeting coordination, extraction runs, and immutable events.

## Normal checks

Use the same `DATA_DIR` and `BRIDGE_VAULT_PATH` as the supervised app:

```bash
npm run meeting-ledger -- audit
curl -s http://localhost:3000/api/loops/meeting-ledger/health
```

`audit` must report matching supported/schema versions, `quick_check: ok`, `integrity_check: ok`, no `write_blocked` reason, and a SQLite storage marker after cutover. Health should also report a recent verified backup, extraction/event sequence, and `extraction_queue.depth: 0` with no failed jobs after a clean drain.

## Restart-safe extraction queue

`meeting_extraction_jobs` is canonical intent for both the Granola post-meeting trigger and the
7:30 PM sweep. A `running` row has a renewable owner/expiry lease. ws-server reconciles immediately
on startup and every 15 seconds: expired work is reclaimed, then canonical output is checked before
another worker is launched. Completion requires the meeting's processed stamp and valid reciprocal
proposal/task links. Failed verification moves the row to `retry_wait` with bounded exponential
backoff; five failed claims become a visible terminal `failed` row.

Do not clear the legacy `$DATA_DIR/loops/meeting-trigger-state.json` to repair missed work. Its
`fired_at` value is compatibility telemetry and no longer controls retries. Inspect
`GET /api/loops/meeting-ledger/health` or query `meeting_extraction_jobs`; after correcting an
upstream fault, a terminal job can be explicitly reset through `enqueueExtractionJob({ forceFailed:
true })` from an operational repair script. Live proposal writes deliberately fail when the current
`DATA_DIR` does not resolve the canonical SQLite marker and file.

## Migration and activation

The commands share the nightly/Granola writer lock. `migrate` builds a shadow projection without changing runtime reads. `activate` performs the final delta import, full parity/integrity check, immutable legacy snapshot, verified backup, then flips the marker atomically.

```bash
npm run meeting-ledger -- dry-run
npm run meeting-ledger -- migrate
npm run meeting-ledger -- audit
npm run meeting-ledger -- activate
npm run meeting-ledger -- audit
```

Never activate after a failed parity check. Do not delete or modify the original `ledger.json`, `meeting-summaries.json`, or `processed-meetings.json` during the migration window.

## Backups and exports

Every successful mutating SQLite run performs a full integrity check, writes an atomic verified `backups/latest.sqlite`, rotates 14 daily and 12 monthly snapshots, and writes a readable JSON export. A failed integrity check or backup latches future writes off.

```bash
npm run meeting-ledger -- backup
npm run meeting-ledger -- export
```

The manual `backup` command runs full integrity first and is the only ordinary operation that clears a latched write block. Do not clear it until the underlying disk, permissions, or corruption problem is understood.

To restore a verified database copy while writers are stopped:

```bash
npm run meeting-ledger -- restore --from /absolute/path/to/backup.sqlite
npm run meeting-ledger -- audit
```

Restore verifies the source before atomically replacing the target. Hilt never creates a blank database when the canonical marker points to a missing or corrupt file.

## Rollback to legacy JSON

Rollback exports all post-cutover SQLite state into the legacy JSON shape, verifies parity, and only then flips the marker back. Stop the supervised meeting worker first; the command also takes the shared ledger lock.

```bash
npm run meeting-ledger -- rollback
npm run meeting-ledger -- audit
```

After rollback, restart supervision and run one no-op/nightly check. Keep the SQLite database and backups until the legacy path has processed another meeting and all proposal/task joins have been audited.

## Failure behavior

- `quick_check` runs before every write transaction.
- A corrupt database, unsupported migration version, failed backup, or missing canonical file blocks writes and surfaces through health.
- A killed process before a meeting transaction commits leaves no entry changes or processed stamp; retry is safe.
- A killed process after commit leaves a complete meeting transaction. Its `extraction_runs` row may remain active, which is diagnostic rather than data loss.
- Proposal mint reconciliation searches stable `origin.loop` plus `origin.item_id` before creating a file, so a crash between file creation and task-ID stamping reuses the existing proposal instead of duplicating it.

Do not remove the original migration snapshot, the current SQLite database, or all backup generations in one operation. Prefer recoverable deletion for obsolete diagnostics after a separately verified backup exists.
