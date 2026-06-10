# Plan 004: Cache the per-call full-vault reload in the library recommendations path

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b0a724f..HEAD -- src/lib/library/recommendations.ts src/lib/library/semantic-relevance.ts src/app/api/library`
> If any of these changed, compare the "Current state" excerpts against the live
> code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 001 (the library test suite is the correctness gate for this change)
- **Category**: perf
- **Planned at**: commit `b0a724f`, 2026-06-10

## Why this matters

Every library scoring entry point re-reads the **entire** library from disk and rebuilds context signals on each call. The sharpest case: `evalAttrsForArtifact` scores a **single** detail-pane item but first loads all ~3000 artifacts (`listLibraryArtifactDetails({ limit: 3000 })`) and recomputes `activeContextSignals` over all of them. Opening a Library detail pane, moving the worth slider, or paging the feed therefore pays a full-vault reload each time, and SWR polling multiplies it. This plan adds a short-TTL, mtime-keyed cache for the expensive shared inputs — the artifact reload and the context signals — so a burst of calls reuses one computation. `buildSemanticContext` already self-caches (see below); the uncached cost is the disk reload and the signals, and that is what this plan targets.

## Current state

- `src/lib/library/recommendations.ts` — three entry points each rebuild the same inputs from scratch:

```ts
export function evaluateLibrary(vaultPath: string, opts: ... = {}): RecommendedArtifact[] {
  const config = loadScoringConfig(vaultPath);
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit: opts.limit ?? 3000, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, artifacts, config);
  const semanticCtx = buildSemanticContext(vaultPath, artifacts);
  return artifacts.filter(...).map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx, config));
}

export function scoreArtifacts(vaultPath: string, artifacts: LibraryArtifactDetail[]): RecommendedArtifact[] {
  const config = loadScoringConfig(vaultPath);
  const all = listLibraryArtifactDetails(vaultPath, { limit: 3000, includeCandidates: true }).artifacts;   // ← full reload
  const signals = activeContextSignals(vaultPath, all, config);                                            // ← full rebuild
  const semanticCtx = buildSemanticContext(vaultPath, all);
  return artifacts.map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx, config));
}

export function evalAttrsForArtifact(vaultPath: string, artifact: LibraryArtifactDetail): LibraryEvalAttrs | null {
  if (artifact.library_mode === "keep") return null;
  const config = loadScoringConfig(vaultPath);
  const all = listLibraryArtifactDetails(vaultPath, { limit: 3000, includeCandidates: true }).artifacts;   // ← full reload to score ONE item
  const signals = activeContextSignals(vaultPath, all, config);
  const semanticCtx = buildSemanticContext(vaultPath, all);
  const scored = scoreArtifact(vaultPath, artifact, signals, semanticCtx, config);
  return { worth: scored.worth, relevance: scored.relevance, substance: scored.substance, freshness: scored.freshness, lifecycle: scored.lifecycle, why: scored.why };
}
```

- `activeContextSignals` is defined at `src/lib/library/recommendations.ts:88` — `function activeContextSignals(vaultPath, artifacts, config): ContextSignal[]`.
- **Existing precedent to model after** — `buildSemanticContext` (`src/lib/library/semantic-relevance.ts:157`) already implements exactly this pattern: a module-level cache keyed by a content key, returning the cached value on hit:

```ts
export function buildSemanticContext(vaultPath, artifacts, dbOverride?) {
  if (!librarySemanticEnabled() && !dbOverride) return EMPTY;
  const cacheKey = dbOverride ? null : semanticContextCacheKey(vaultPath, artifacts);
  if (cacheKey && contextCache?.key === cacheKey) return contextCache.context;
  ...
}
```

Use the same shape for the new cache. Callers of the three entry points (for blast-radius awareness): `src/app/api/library/route.ts:17,70` and `src/app/api/library/review/route.ts:30` (`scoreArtifacts`); `src/app/api/library/[id]/route.ts:24` and `src/app/api/library/[id]/archive/route.ts:20` (`evalAttrsForArtifact`); `src/lib/library/workbench.ts:5` (`evaluateLibrary`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Library suite (correctness gate) | `npm run test:library` | all pass, **same results before and after** |
| Full gate (if 001 done) | `npm test` | all pass |

## Scope

**In scope**:
- `src/lib/library/recommendations.ts` (add an internal cache for the `{ all artifacts, signals, config }` bundle; route the three entry points through it)
- `src/lib/library/recommendations.test.ts` (create, or extend the existing library test file if scoring is tested there — check `src/lib/library/library.test.ts` first)

**Out of scope** (do NOT touch):
- `src/lib/library/semantic-relevance.ts` — `buildSemanticContext` already caches; do not change it.
- `scoreArtifact` (the per-item scoring math) — its output must be **identical**; this plan changes only how inputs are obtained, never the scores.
- The API routes and SWR hooks — no caller signature changes. This is a transparent internal optimization.
- `listLibraryArtifactDetails` itself in `src/lib/library/library.ts`.

## Git workflow

- Branch: `advisor/004-recommendations-reload-cache`
- Commit style: conventional commits. Example: `perf(library): cache full-vault reload across recommendation calls`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add a mtime-keyed, short-TTL cache for the shared inputs

In `src/lib/library/recommendations.ts`, add a module-level cache holding the expensive shared bundle: the full artifact list, the `config`, and the derived `signals`. Key it the same way `buildSemanticContext` keys its cache — derive a key from `vaultPath` plus a cheap fingerprint of library state. Prefer the **most recent artifact `updated_at`/mtime + artifact count** as the fingerprint (a new ingestion or edit changes it), and add a wall-clock TTL guard (e.g. 5s) so the cache cannot serve staler-than-5s data even if the fingerprint is coincidentally equal.

Target shape (model on the `contextCache?.key === cacheKey` pattern):

```ts
type SharedInputs = { artifacts: LibraryArtifactDetail[]; signals: ContextSignal[]; config: LibraryScoringConfig };
let inputsCache: { key: string; at: number; value: SharedInputs } | null = null;

function sharedInputs(vaultPath: string): SharedInputs {
  const config = loadScoringConfig(vaultPath);
  const fingerprint = libraryStateFingerprint(vaultPath); // cheap: count + max(updated_at); see Step 2
  const key = `${vaultPath}::${fingerprint}`;
  const now = nowMs();
  if (inputsCache && inputsCache.key === key && now - inputsCache.at < 5000) return inputsCache.value;
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit: 3000, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, artifacts, config);
  const value = { artifacts, signals, config };
  inputsCache = { key, at: now, value };
  return value;
}
```

Use the existing time source the module already uses if one is present; otherwise `Date.now()` is acceptable in app runtime code (the no-`Date.now()` rule applies only to workflow scripts, not to Hilt source).

### Step 2: Implement a cheap library-state fingerprint

Add `libraryStateFingerprint(vaultPath)` that is **much cheaper** than a full `listLibraryArtifactDetails` load — ideally a directory `readdirSync` + `stat` over the `references/` (and candidates cache) dir computing `count` and `max(mtimeMs)`, or reusing any lightweight listing helper already in `src/lib/library/library.ts`. If no cheap listing exists and the only way to fingerprint is to load everything (defeating the purpose), see STOP conditions.

**Verify (Steps 1–2)**: `npx tsc --noEmit` → exit 0.

### Step 3: Route the three entry points through `sharedInputs`

Replace the per-call `listLibraryArtifactDetails(...) + activeContextSignals(...) + loadScoringConfig(...)` triples in `evaluateLibrary`, `scoreArtifacts`, and `evalAttrsForArtifact` with a single `const { artifacts: all, signals, config } = sharedInputs(vaultPath);`. Keep `buildSemanticContext(vaultPath, all)` exactly where it is (it caches itself). Preserve each function's existing filtering and return shape verbatim.

- For `evaluateLibrary`, honor its `opts.limit` if set: when `opts.limit` differs from the cache's 3000-load assumption, either bypass the cache for that call or slice — **do not silently return a different artifact set than before**. Simplest correct choice: if `opts.limit` is provided and `!== 3000`, skip the cache and load directly (preserve old behavior exactly); only the default-limit path is cached.

**Verify**: `npm run test:library` → all pass with **identical** assertions to before this change (scores unchanged). `npx tsc --noEmit` → exit 0.

### Step 4: Add tests proving (a) scores are unchanged and (b) the cache is used

In the test file:
- **Correctness**: for a fixture vault, assert `scoreArtifacts`/`evalAttrsForArtifact` return the same `worth/relevance/substance/freshness/lifecycle` values as a direct (uncached) computation. The library test suite (`src/lib/library/library.test.ts`, 3091 lines) likely already builds fixtures — reuse its setup.
- **Cache hit**: spy on `listLibraryArtifactDetails` (or the fingerprint loader) and assert that two back-to-back `evalAttrsForArtifact` calls within the TTL trigger the full load **once**, not twice.
- **Invalidation**: simulate a changed fingerprint (touch a reference file / advance the fixture) and assert the next call reloads.

**Verify**: `npx vitest run <test file>` → all pass; `npm test` (if 001 done) green.

## Test plan

- Tests: scores-unchanged equivalence, single-load-on-burst (cache hit), reload-on-fingerprint-change (invalidation).
- Pattern: reuse fixture setup from `src/lib/library/library.test.ts`.
- Verification: `npm run test:library` plus the new cases → all pass.

## Done criteria

ALL must hold:

- [ ] The three entry points obtain artifacts/signals/config via the shared cache; no entry point calls `listLibraryArtifactDetails({limit:3000})` + `activeContextSignals` inline on the default path anymore
- [ ] `npm run test:library` passes with **unchanged** score assertions
- [ ] New tests prove a burst triggers one load and a fingerprint change triggers a reload
- [ ] `npx tsc --noEmit` exits 0; `npm test` (if 001 done) passes
- [ ] `git status` shows only `recommendations.ts` + the test file
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- A cheap fingerprint isn't achievable without loading the whole library (Step 2) — report; a cache keyed on a full load saves nothing and should not be shipped.
- Any score changes in `npm run test:library` after routing through the cache — the optimization altered behavior; stop and report rather than updating snapshots.
- `evaluateLibrary`'s `opts.limit` semantics can't be preserved cleanly with the cache — report; correctness of the returned set beats the cache.
- The fingerprint can't distinguish a post-ingestion state from a pre-ingestion one (stale risk) — report.

## Maintenance notes

- The TTL (5s) trades freshness for cost. If a future feature needs sub-second reflection of a just-written artifact in the feed, lower or bust the cache explicitly after that write rather than shortening the global TTL.
- The secondary O(n) title `nearDuplicate` dedup in `getRecommendations` (`recommendations.ts:345`, `final.some(... nearDuplicate ...)`) re-tokenizes per check; pre-computing token sets is a small follow-up, intentionally **not** in this plan to keep the diff focused on the dominant reload cost.
- If `listLibraryArtifactDetails` later grows internal caching of its own, reconcile the two layers so they don't both cache (and both go stale) independently.
- Reviewer should scrutinize the invalidation path most — a too-sticky cache showing stale scores is the main risk of this change.
