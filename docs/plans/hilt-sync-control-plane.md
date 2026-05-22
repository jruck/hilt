# Hilt Sync Control Plane With Syncthing Pilot

## Summary

Use Syncthing as the actual sync engine and make Hilt the observable control plane. V1 syncs only `/Users/jruck/work/meta` between Xochipilli and Mercury V. Xochipilli remains the operational source of truth, but the folder runs as safe bidirectional sync so Mercury can still work offline and later reconcile.

Do not sync `/Users/jruck/work/bridge` with Syncthing in v1 because Obsidian Sync already owns that tree. Hilt should observe externally-managed folders later, not double-write them.

## Key Changes

- Install Syncthing on both Macs via Homebrew and run it as a user-level launchd service.
- Keep Syncthing GUI/API bound to `127.0.0.1:8384`; do not expose the Syncthing API over the tailnet.
- Configure Syncthing device connections tailnet-only for v1:
  - Xochipilli address: `tcp://xochipilli.tailc0acaa.ts.net:22000`
  - Mercury V address: `tcp://mercury-v.tailc0acaa.ts.net:22000`
  - Disable global discovery/relays/NAT traversal unless bootstrap testing proves a fallback is needed.
- Create one v1 Syncthing folder:
  - Folder ID: `work-meta`
  - Path: `/Users/jruck/work/meta`
  - Type: `sendreceive` on both devices
  - Versioning: staggered, 90-day max age, enabled on both devices
  - Versioning caveat: Syncthing versions files when a remote change replaces/deletes the local copy, so tests must verify the receiving side's version archive.
  - Conflict policy: set `maxConflicts = -1`; never auto-prune conflict copies; surface `*.sync-conflict-*` in Hilt
- Replace active `meta-sync` usage with Syncthing after bootstrap. Keep `meta-sync check` as a manual audit/repair fallback.
- Add a synced ignore include file at `/Users/jruck/work/meta/.hilt-syncthing-ignore`, then local `.stignore` files on both Macs containing `#include .hilt-syncthing-ignore`. Ignore generated/heavy/internal paths:
  - `.DS_Store`
  - `**/node_modules`
  - `**/.next`
  - `**/dist`
  - `**/target`
  - `**/.git`
  - `**/.sync-backups`
  - Use Syncthing's `(?d)` prefix for disposable generated paths if empty directory cleanup becomes noisy.

## Hilt Interfaces

- Add a `System > Sync` tab to Hilt, using the existing System peer-discovery model.
- Add `sync` to the System URL/model surface:
  - Extend `SystemMode` from `sessions | apps | stack` to `sessions | apps | stack | sync`.
  - Route `/system/sync` to the Sync tab instead of falling back to Sessions.
  - Keep `Sync` inside System's secondary segmented control; do not add a top-level global nav item.
- Add a Hilt-local `sync` module with a Syncthing adapter that reads only the local Syncthing REST API. Hilt must not mutate Syncthing config in v1.
- Add API routes:
  - `GET /api/system/sync?scope=local`
  - `GET /api/system/sync?scope=network`
  - `GET /api/system/sync/conflicts?folder=work-meta`
- Add `sync` to `/api/system/machine` feature flags so peer discovery can report which machines expose sync status.
- Hilt sync snapshots should show:
  - machine, provider, daemon status, API reachability
  - folder ID/path/type/state
  - in-sync files/bytes, needed files/bytes, pull errors
  - connected peer status
  - versioning status
  - ignore file hash/parity
  - conflict files and last state change
- Snapshot implementation notes:
  - Cache Syncthing REST reads behind a short server-side TTL and single-flight refresh; `/rest/db/status` is useful but expensive enough that UI polling should not call it continuously.
  - Use explicit manual refresh plus a slow visible-tab polling cadence. Preserve the last good snapshot while refreshing and surface refresh errors as status metadata.
  - Prefer REST endpoints that expose structured state: config/folder metadata, folder status, folder errors, connections, system status, and database browse/glob for conflicts.
- Store Syncthing API access locally only:
  - `HILT_SYNC_ENABLED=true`
  - `HILT_SYNC_PROVIDER=syncthing`
  - `HILT_SYNC_SYNCTHING_URL=http://127.0.0.1:8384`
  - `HILT_SYNC_SYNCTHING_API_KEY_FILE=/Users/jruck/.hilt/sync/syncthing-api-key`

## Bootstrap Sequence

- Preflight both machines before enabling live sync:
  - confirm SSH/Tailscale reachability
  - run `meta-sync check`
  - compare `/Users/jruck/work/meta` drift with dry-run `rsync`
  - confirm current 2.7 GB meta size is mostly ignored/generated content
- Confirm Syncthing's sync connection is using the Tailscale DNS/IP path, not relay/global-discovery fallback.
- Treat Xochipilli as authoritative for initial reconciliation.
- Before Syncthing starts applying changes, preserve any Mercury-only drift under `/Users/jruck/work/meta/.sync-backups/<timestamp>/`.
- Align Mercury to Xochipilli, install ignore rules, enable Syncthing, then verify both devices report `idle` and `in sync`.
- Document the new ownership rule in `/Users/jruck/work/meta/README.md`: Syncthing owns live sync; `meta-sync` is manual fallback only.

## Test Plan

- Unit-test the Hilt Syncthing adapter with mocked REST responses for healthy, syncing, out-of-sync, disconnected, pull-error, and conflict states.
- Unit-test snapshot caching/single-flight behavior so a visible polling UI cannot stampede Syncthing's expensive status endpoint.
- Unit-test System routing so `/system/sync` selects the Sync mode and `Sync` persists through the existing System mode localStorage path.
- Browser-test `System > Sync` in Hilt over the tailnet and confirm both machines appear.
- Live sync tests:
  - create a small probe file on Xochipilli and confirm it appears on Mercury
  - create a small probe file on Mercury and confirm it appears on Xochipilli
  - create ignored probe files under `node_modules`, `.git`, and `dist` and confirm they do not sync
  - pause one side, edit the same probe file differently on both machines, resume, and confirm Hilt reports the conflict file
  - delete/replace a probe file remotely and confirm Syncthing versioning captures the prior version on the receiving side
- Acceptance criteria:
  - Hilt shows sync health without opening Syncthing directly
  - no invisible job exists without a visible Hilt status
  - `/Users/jruck/work/meta` stays aligned across both Macs
  - conflicts are visible and never silently overwritten
  - Hilt never exposes the Syncthing API key or direct Syncthing API route over the tailnet; peer status flows only through Hilt's local snapshot API.

## Assumptions

- Syncthing is the v1 engine.
- `/Users/jruck/work/meta` is the only v1 managed folder.
- Bridge/Obsidian folders remain under Obsidian Sync for now.
- Git repositories remain Git-owned; Syncthing should not sync nested `.git` internals.
- Sources informing the plan:
  - Syncthing REST API: https://docs.syncthing.net/dev/rest.html
  - Syncthing folder status: https://docs.syncthing.net/rest/db-status-get.html
  - Syncthing conflicts: https://docs.syncthing.net/users/syncing?version=v1.23.1
  - Syncthing versioning: https://docs.syncthing.net/users/versioning?version=v2.0.0
  - Syncthing configuration (`maxConflicts`): https://docs.syncthing.net/v2.0.0/users/config
  - Syncthing folder types: https://docs.syncthing.net/v1.27.2/users/foldertypes.html
  - Syncthing ignore rules: https://docs.syncthing.net/users/ignoring.html
  - Syncthing macOS autostart: https://docs.syncthing.net/users/autostart
