# Plan 003: Atomic writes for the docs-save route and the JSON state stores

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b0a724f..HEAD -- src/app/api/docs/file/route.ts src/lib/db.ts src/lib/library/utils.ts`
> If any of these changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: Plan 001 (uses `npm test` as the gate; if 001 is not done, run the individual commands listed below instead)
- **Category**: bug
- **Planned at**: commit `b0a724f`, 2026-06-10

## Why this matters

Several write paths use `fs.writeFileSync(targetFile, content)` directly: a crash, full disk, or permission error mid-write leaves a **truncated/corrupted** file. This hits the docs-save route (user's own markdown — the product's source of truth) and the JSON state stores (inbox, preferences, sources config). The repo already has the safe pattern: `atomicWriteFile()` writes to a temp file then `renameSync`s into place (an atomic operation on the same filesystem), and the people-notes route already uses it. This plan applies that existing helper to the unprotected sites. It directly upholds CLAUDE.md constraint #2 ("markdown remains source of truth — must round-trip through files").

## Current state

- `src/lib/library/utils.ts:67` — the existing, exported atomic-write helper to reuse (do not re-implement it):

```ts
export function atomicWriteFile(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}
```

- `src/app/api/docs/file/route.ts` — the docs `PUT` handler writes the user's file non-atomically:

```ts
    // Write the file
    fs.writeFileSync(filePath, content, "utf-8");   // ← line ~245, the unprotected write
```

(The handler above this validates `isPathWithinScope(filePath, scope)` and the extension allowlist — keep those checks; only the write line changes.)

- `src/lib/db.ts` — three JSON-store writers, all non-atomic:

```ts
function writeInboxFile(items: InboxItem[]) {
  ensureDataDir();
  fs.writeFileSync(INBOX_FILE, JSON.stringify(items, null, 2));       // ← ~line 42
}
function writePreferencesFile(prefs: UserPreferences) {
  ensureDataDir();
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2)); // ← ~line 160
}
function writeSourcesFile(sources: Source[]) {
  ensureDataDir();
  fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2));   // ← ~line 406
}
```

- Exemplar already using the atomic pattern (for reference, do not modify): `src/app/api/bridge/people/[slug]/notes/route.ts:39-41` — temp write then `renameSync`.

Convention: import shared helpers via the `@/` alias (`@` → `./src`, per `vitest.config.ts` / `tsconfig.json`). So the import is `import { atomicWriteFile } from "@/lib/library/utils";`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Library suite | `npm run test:library` | all pass |
| Full gate (if 001 done) | `npm test` | all pass |
| Find remaining raw writes in scope | `grep -n "writeFileSync" src/lib/db.ts src/app/api/docs/file/route.ts` | only inside helpers you intend, none on the target lines |

## Scope

**In scope** (the only files you should modify/create):
- `src/app/api/docs/file/route.ts` (swap the one write line)
- `src/lib/db.ts` (swap the three writer bodies)
- `src/lib/db.test.ts` (create — round-trip + atomicity-shape tests for the JSON writers)

**Out of scope** (do NOT touch):
- `src/lib/library/utils.ts` — reuse `atomicWriteFile` as-is; do not modify or move it.
- The existing `atomicWriteFile` callers (granola, etc.) — leave them.
- The path-scope and extension-allowlist checks in the docs route — keep them exactly as they are.
- Any other `fs.writeFileSync` site elsewhere in the repo (there are many legitimate ones, e.g. caches, the ws-port file). This plan covers only the docs-save route and the three `db.ts` JSON stores.

## Git workflow

- Branch: `advisor/003-atomic-writes`
- Commit style: conventional commits. Example: `fix(docs): write files atomically to prevent truncation on crash`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Make the docs-save route write atomically

In `src/app/api/docs/file/route.ts`:
- Add `import { atomicWriteFile } from "@/lib/library/utils";` to the imports.
- Replace `fs.writeFileSync(filePath, content, "utf-8");` (the "Write the file" line) with `atomicWriteFile(filePath, content);`.
- Leave the subsequent `fs.statSync(filePath)` mod-time read and the response shape unchanged.

**Verify**:
- `grep -n "atomicWriteFile" src/app/api/docs/file/route.ts` → import + call present.
- `grep -n "writeFileSync(filePath" src/app/api/docs/file/route.ts` → no matches.
- `npx tsc --noEmit` → exit 0.

### Step 2: Make the three `db.ts` JSON writers atomic

In `src/lib/db.ts`:
- Add `import { atomicWriteFile } from "@/lib/library/utils";` (top of file).
- In each of `writeInboxFile`, `writePreferencesFile`, `writeSourcesFile`, keep the `ensureDataDir()` call and replace the `fs.writeFileSync(<FILE>, JSON.stringify(...))` line with `atomicWriteFile(<FILE>, JSON.stringify(<value>, null, 2));`. Preserve the exact `JSON.stringify(..., null, 2)` formatting (two-space indent) so existing files round-trip identically.

**Verify**:
- `grep -n "atomicWriteFile" src/lib/db.ts` → three call sites + import.
- `grep -n "writeFileSync(INBOX_FILE\|writeFileSync(PREFERENCES_FILE\|writeFileSync(SOURCES_FILE" src/lib/db.ts` → no matches.
- `npx tsc --noEmit` → exit 0.

> Note: if `atomicWriteFile`'s `ensureDir(path.dirname(...))` makes the explicit `ensureDataDir()` redundant, **still keep `ensureDataDir()`** — it may create other expected structure; removing it is out of scope.

### Step 3: Add round-trip tests for the JSON stores

Create `src/lib/db.test.ts` (vitest). Point the data dir at a temp directory (the stores resolve their paths from a data dir / `DATA_DIR` env — inspect the top of `src/lib/db.ts` to see how `INBOX_FILE` etc. are derived, and set the env/temp dir accordingly **before** importing the module, or use the module's own setters if present). Cover:
- Create → read inbox item round-trips (write then read returns the same item).
- Update and delete inbox item behave correctly.
- After a write, the target file contains valid JSON (parse succeeds) and **no leftover `*.tmp.*` file** remains in the data dir (proves the rename completed and didn't leave temp debris).

Model vitest syntax after `src/lib/bridge/people-parser.test.ts`. Ensure the new test is reachable by `npm run test:library`'s runner or add it to the `test:unit` chain from Plan 001 if it is not already globbed; confirm by running it explicitly.

**Verify**: `npx vitest run src/lib/db.test.ts` → all pass. `npm test` (if 001 landed) → still green.

## Test plan

- New file `src/lib/db.test.ts`: inbox create/read/update/delete round-trips, valid-JSON-after-write, and no-leftover-temp-file assertions.
- Pattern: vitest per `src/lib/bridge/people-parser.test.ts`; isolate to a temp data dir.
- Verification: `npx vitest run src/lib/db.test.ts` → all pass.

## Done criteria

ALL must hold:

- [ ] Docs route and all three `db.ts` writers call `atomicWriteFile`; no raw `writeFileSync` remains on those four target lines
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run src/lib/db.test.ts` passes; `npm test` (if 001 done) passes
- [ ] Existing inbox/preferences/sources JSON files written by the new code are byte-identical in shape to before (two-space-indented JSON) — confirmed by a round-trip read
- [ ] `git status` shows only the three in-scope source files + the new test
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- Any "Current state" excerpt does not match the live code — drift.
- `atomicWriteFile` is no longer exported from `src/lib/library/utils.ts` or its signature changed — report; do not re-implement a competing helper.
- The `db.ts` stores derive their file paths in a way that makes a temp-dir test impossible without modifying source — report; do not refactor the module's path resolution to make the test work.
- Switching to `renameSync` fails on the target because the data dir and temp file would be on different filesystems (cross-device rename) — unlikely for these local paths, but if observed, report it (the helper assumes same-FS temp).

## Maintenance notes

- There are now two atomic-write entry points in the tree (`atomicWriteFile` in `library/utils.ts`, plus inline temp+rename in the people-notes route and `bridge/vault.ts`). Consolidating all writers onto the one helper — and moving it to a neutral `src/lib/fs-utils.ts` — is a worthwhile **deferred** cleanup, intentionally left out of this plan to keep the diff small and low-risk.
- Any *new* code that persists user data or JSON state should use `atomicWriteFile`, not raw `writeFileSync`. Reviewer should watch for new `writeFileSync` on durable files in future PRs.
- This does not address concurrent writers racing on the same file (two processes writing the same vault file). That is a separate, larger concern not triggered by the current single-writer-per-file usage.
