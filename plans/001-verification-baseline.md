# Plan 001: One-command verification baseline (`npm test`) + a characterization test pattern

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b0a724f..HEAD -- package.json src/app/api/docs/file/route.ts`
> If `package.json` changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `b0a724f`, 2026-06-10

## Why this matters

Hilt has ~20 targeted `test:*` scripts but **no single command** that answers "is the codebase healthy?" — and no CI. Every other plan in this batch touches write paths or hot code; they are far safer to land behind one aggregated gate. This plan adds `npm test` (all unit suites + typecheck) and establishes a characterization-test pattern on the docs path-scope guard, which Plan 003 will rely on as a regression net. Nothing here changes runtime behavior.

## Current state

- `package.json` — has many `test:*` scripts mixing `tsx --test` (node:test) and `vitest run`, but no `test` script. The unit suites (no network, no running app) are:
  - `test:map`, `test:bridge`, `test:calendar`, `test:granola`, `test:graph`, `test:semantic`, `test:weather`, `test:system`, `test:local-apps`, `test:library`
  - The `*:e2e`, `*:sync-live`, `*:perf`, `*:parity` scripts are **not** unit suites (they need a running app/network) — exclude them.
- Typecheck command (verified during recon): `npx tsc --noEmit` exits 0 today.
- Lint command: `npm run lint` (eslint).
- Test runner config: `vitest.config.ts` exists (jsdom env, `@` alias → `./src`). Vitest is the more capable runner and is already a devDependency.
- The docs save route validates paths with a helper before writing:
  - `src/app/api/docs/file/route.ts:228` — `if (!isPathWithinScope(filePath, scope)) { ... 403 }`. Find where `isPathWithinScope` is defined/imported (top of that file) — it is the unit under test in Step 3.

Convention: existing unit tests live next to source as `*.test.ts` and run under either `tsx --test` or `vitest`. New tests in this plan use **vitest** (`describe`/`it`/`expect`), matching `src/lib/bridge/people-parser.test.ts`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| One unit suite | `npm run test:library` | all pass |
| New aggregate | `npm test` | all suites pass, then tsc exits 0 |
| Single new test | `npx vitest run <path>` | new tests pass |
| Lint | `npm run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `package.json` (add `test` and `test:unit` scripts only — do not change existing scripts)
- `src/app/api/docs/file/__scope-guard.test.ts` (create) — or co-locate per Step 3

**Out of scope** (do NOT touch):
- Any existing `test:*` script definition — leave them exactly as-is.
- Any source file under `src/` other than adding the one new test file. This plan adds no behavior changes.
- `.github/workflows/` — CI is intentionally deferred (see Maintenance notes); this is a local-first single-developer repo and adding CI is a separate decision.

## Git workflow

- Branch: `advisor/001-verification-baseline`
- Commit style: conventional commits (repo uses `feat:`/`fix:`/`chore:`/`docs:`). Example from `git log`: `chore(tooling): prepare graph and library release plumbing`. Use `test:` or `chore(test):`.
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add the aggregate test scripts

In `package.json` `scripts`, add (do not remove or reorder existing entries):

```json
"test:unit": "npm run test:map && npm run test:bridge && npm run test:calendar && npm run test:granola && npm run test:graph && npm run test:semantic && npm run test:weather && npm run test:system && npm run test:local-apps && npm run test:library",
"test": "npm run test:unit && npx tsc --noEmit"
```

Rationale for `&&` chaining over a parallel runner: deterministic, and the first failing suite stops the run with a clear signal. Keep the exact suite list above — it is the set of non-e2e/non-live unit suites.

**Verify**: `npm test` → every suite passes and the command exits 0 (tsc runs last with no output). If any suite was already failing on `b0a724f` before your change, see STOP conditions.

### Step 2: Confirm the gate catches a real break (sanity check, then revert)

Temporarily introduce a type error to prove the gate works: in any one `src/lib/**/*.ts` file, add a line `const __x: number = "nope";` at module top. Run `npm test`.

**Verify**: `npm test` now FAILS at the `tsc --noEmit` stage. Then **remove the line** and re-run `npm test` → passes again. Do not commit the temporary error.

### Step 3: Add a characterization test for the docs path-scope guard

The docs save route's security guard `isPathWithinScope(filePath, scope)` (used at `src/app/api/docs/file/route.ts:228`) is currently untested and is the guard Plan 003 builds on. Locate its definition (it is imported or defined in that route file or a sibling under `src/lib/docs/`). 

- If it is **exported and pure** (string in, boolean out): write a vitest test file importing it, covering: (a) a path inside the scope → `true`; (b) the scope dir itself; (c) a traversal escape like `${scope}/../secrets.md` → `false`; (d) a sibling-prefix trap like `${scope}-evil/x.md` → `false` (a naive `startsWith` would wrongly allow this — assert it does not).
- Model the test structure after `src/lib/bridge/people-parser.test.ts` (vitest `describe`/`it`/`expect`).
- Add it to the `test:unit` chain only if it is not already picked up by an existing `test:*` glob; otherwise place it where `test:library`/`test:bridge` will run it. If unsure, run it explicitly to confirm: `npx vitest run <your test path>`.

If `isPathWithinScope` is **not exported** or is not a pure function (e.g. it does filesystem I/O internally), do not refactor it in this plan — see STOP conditions.

**Verify**: `npx vitest run <your test path>` → all new cases pass (expect ≥4 assertions), and `npm test` still passes overall.

## Test plan

- New file: a vitest suite for `isPathWithinScope` with the four cases listed in Step 3 (inside-scope, scope-root, traversal-escape, sibling-prefix-trap).
- Pattern to follow: `src/lib/bridge/people-parser.test.ts`.
- Verification: `npm test` → all suites pass including the new one.

## Done criteria

ALL must hold:

- [ ] `package.json` has `test` and `test:unit` scripts; no existing script was modified
- [ ] `npm test` exits 0 (all unit suites pass, then `tsc --noEmit` clean)
- [ ] A vitest suite for `isPathWithinScope` exists with ≥4 cases and passes (or Step 3 was skipped per a STOP condition and that is reported)
- [ ] `git status` shows only `package.json` and the one new test file changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- A unit `test:*` suite already fails on a clean `b0a724f` checkout before any change — report which suite; the baseline is red and that is its own finding.
- `isPathWithinScope` is not exported or not pure (Step 3) — report this; do not refactor the route to make it testable in this plan (that belongs with Plan 003).
- `npm test`'s tsc stage reports pre-existing errors unrelated to your change — report them; do not fix unrelated type errors here.

## Maintenance notes

- **Deferred on purpose**: a GitHub Actions workflow. Hilt runs local-first on a single Mac Mini; whether to add CI is the operator's call. If desired later, a minimal `.github/workflows/test.yml` running `npm ci && npm test` on push is the natural follow-up — only meaningful once the repo is pushed to a GitHub remote.
- When new `src/lib/<area>/*.test.ts` suites are added with their own `test:<area>` script, append them to the `test:unit` chain so the aggregate stays complete. A suite that exists but isn't in the chain is invisible to `npm test`.
- Reviewer should confirm no e2e/live/perf script crept into `test:unit` (those need a running app/network and would make `npm test` flaky).
