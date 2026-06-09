# Hilt Sync Conflict Drill

Use this drill only when intentionally validating conflict visibility in Hilt's `System > Sync` tab.

The drill creates a temporary probe file under `/Users/jruck/work/meta`, forces divergent edits on Mercury and Xochipilli while one Syncthing side is paused, then confirms Hilt reports the resulting `*.sync-conflict-*` file. Do not run this as part of ordinary automated tests.

## Preconditions

- Mercury and Xochipilli Hilt are reachable at:
  - `http://mercury-v.tailc0acaa.ts.net:3000`
  - `http://xochipilli.tailc0acaa.ts.net:3000`
- Syncthing is running on both machines.
- `npm run test:system:sync-live` passes before starting.
- The synced folder is `work-meta` at `/Users/jruck/work/meta`.

## Drill

1. Confirm healthy sync:

   ```bash
   cd /Users/jruck/work/engineering/me/hilt
   npm run test:system:sync-live
   ```

2. On Mercury, create the probe file:

   ```bash
   printf 'base\n' > /Users/jruck/work/meta/.hilt-sync-conflict-probe.md
   ```

3. Wait until `npm run test:system:sync-live` passes again.

4. Pause `work-meta` on Xochipilli from the Syncthing UI or CLI. Keep Mercury running.

5. Edit the same file differently on both machines:

   ```bash
   printf 'mercury edit\n' > /Users/jruck/work/meta/.hilt-sync-conflict-probe.md
   ssh xo "printf 'xochipilli edit\n' > /Users/jruck/work/meta/.hilt-sync-conflict-probe.md"
   ```

6. Resume `work-meta` on Xochipilli.

7. Check Hilt's conflict API from either machine:

   ```bash
   curl -fsS 'http://mercury-v.tailc0acaa.ts.net:3000/api/system/sync/conflicts?folder=work-meta&force=true'
   curl -fsS 'http://xochipilli.tailc0acaa.ts.net:3000/api/system/sync/conflicts?folder=work-meta&force=true'
   ```

8. Confirm the Sync tab shows a nonzero conflict count and lists a `.sync-conflict-` file related to `.hilt-sync-conflict-probe.md`.

## Cleanup

Remove the probe and conflict copies from one machine, then let Syncthing propagate the deletion:

```bash
find /Users/jruck/work/meta -maxdepth 1 -name '.hilt-sync-conflict-probe*' -print -delete
npm run test:system:sync-live
```

The live smoke test should return to:

```json
{
  "machine_count": 2,
  "healthy_count": 2,
  "conflict_count": 0,
  "needed_files": 0,
  "pull_errors": 0
}
```
