# Plan 006: Make Briefing the default landing surface, with a safe fallback to Bridge

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b0a724f..HEAD -- src/components/Board.tsx README.md`
> If either changed, compare the "Current state" excerpt against the live code
> before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `b0a724f`, 2026-06-10

## Why this matters

The operator has decided Briefing is now ready to be Hilt's landing surface. Today the app hardcodes Bridge as the startup view, and the README documents this as temporary ("Hilt still opens Bridge by default until Briefing is strong enough to be the landing surface"). This plan flips the default to Briefing **with a guard**: if there are no briefings yet (fresh vault, or the nightly generation hasn't run), it falls back to Bridge so the user never lands on a blank page. The README is updated to match.

## Current state

- `src/components/Board.tsx` — the startup redirect runs once in a post-mount effect (around lines 187–193):

```tsx
  // Hydrate after mount
  useEffect(() => {
    // Always open to Bridge when no view prefix in URL (e.g., Electron app startup)
    if (!urlViewMode) {
      replaceViewMode("bridge");
    }

    setHudVisible(localStorage.getItem(HUD_VISIBILITY_STORAGE_KEY) === "true");

    const frame = window.requestAnimationFrame(() => setIsHydrated(true));
    return () => window.cancelAnimationFrame(frame);
  }, [replaceViewMode, urlViewMode]);
```

- `replaceViewMode(mode)` comes from `useScope()` (`src/contexts/ScopeContext.tsx:77`); valid modes include `"bridge"` and `"briefings"` (see the `viewMode` derivation at `Board.tsx:141-148`).
- `GET /api/bridge/briefings` (`src/app/api/bridge/briefings/route.ts:20`) returns a JSON array of briefing summaries, **newest first**, and returns `[]` when the `briefings/` directory does not exist. A non-empty array means at least one briefing exists to show.
- README copy to update — `README.md` around line 66: "Hilt still opens Bridge by default until Briefing is strong enough to be the landing surface."

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| New helper test | `npx vitest run src/lib/landing-view.test.ts` | all pass |
| Full gate (if 001 done) | `npm test` | all pass |

## Scope

**In scope**:
- `src/lib/landing-view.ts` (create — a small, pure-ish helper that decides the landing view)
- `src/components/Board.tsx` (use the helper in the startup effect)
- `src/lib/landing-view.test.ts` (create)
- `README.md` (update the landing-surface sentence)

**Out of scope** (do NOT touch):
- `BriefingsView` / `BridgeView` rendering — no view-component changes.
- `src/app/api/bridge/briefings/route.ts` — consume it as-is; do not change its response.
- Read-state, briefing generation, or any briefing write path — this plan only changes which view loads first.
- Any URL that already contains a view prefix — deep links and bookmarks must keep working unchanged; only the **no-prefix** startup case is affected.

## Git workflow

- Branch: `advisor/006-briefing-landing-surface`
- Commit style: conventional commits. Example: `feat(briefings): default to Briefing landing surface with Bridge fallback`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Add a landing-view decision helper

Create `src/lib/landing-view.ts` with a function that asks the briefings API whether any briefing exists and returns the view to land on, defaulting safely:

```ts
export type LandingView = "briefings" | "bridge";

// Land on Briefing when at least one briefing exists; otherwise Bridge.
// Any failure falls back to Bridge so startup never lands on a blank page.
export async function chooseLandingView(
  fetchImpl: typeof fetch = fetch,
): Promise<LandingView> {
  try {
    const res = await fetchImpl("/api/bridge/briefings");
    if (!res.ok) return "bridge";
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? "briefings" : "bridge";
  } catch {
    return "bridge";
  }
}
```

The injectable `fetchImpl` parameter exists so the unit test can pass a mock; production calls `chooseLandingView()`.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 2: Use the helper in Board's startup effect

In `src/components/Board.tsx`, import `chooseLandingView` and replace the synchronous `replaceViewMode("bridge")` in the no-prefix branch with an async resolution. Keep the rest of the effect (HUD visibility, hydration `requestAnimationFrame`) intact and synchronous — only the view choice becomes async:

```tsx
  useEffect(() => {
    if (!urlViewMode) {
      let cancelled = false;
      chooseLandingView().then((view) => {
        if (!cancelled) replaceViewMode(view);
      });
      // (the cleanup below also clears this via `cancelled`)
      // fall through to set up hydration regardless
    }
    setHudVisible(localStorage.getItem(HUD_VISIBILITY_STORAGE_KEY) === "true");
    const frame = window.requestAnimationFrame(() => setIsHydrated(true));
    return () => { window.cancelAnimationFrame(frame); };
  }, [replaceViewMode, urlViewMode]);
```

Adjust to the file's existing structure (you may hoist a `cancelled` flag to cover the async setState-after-unmount case cleanly). Update the stale comment "Always open to Bridge when no view prefix in URL" to reflect the new behavior ("Open to Briefing when briefings exist, else Bridge").

**Verify**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

### Step 3: Test the helper

Create `src/lib/landing-view.test.ts` (vitest), passing a mock `fetchImpl`:
- Non-empty briefings array → returns `"briefings"`.
- Empty array `[]` → returns `"bridge"`.
- `res.ok === false` (e.g. 500) → returns `"bridge"`.
- `fetchImpl` throws → returns `"bridge"`.

Follow vitest syntax per `src/lib/bridge/people-parser.test.ts`. Ensure the test is picked up by `test:unit` (add it to the chain from Plan 001 if not already globbed) — confirm by running it explicitly.

**Verify**: `npx vitest run src/lib/landing-view.test.ts` → all four cases pass.

### Step 4: Update the README

In `README.md`, replace the sentence "Hilt still opens Bridge by default until Briefing is strong enough to be the landing surface." with copy describing the new default, e.g.: "Hilt opens to **Briefing** by default, falling back to Bridge when no briefings exist yet." Keep the surrounding navigation paragraph accurate (the routes list is unchanged).

**Verify**: `grep -n "opens to" README.md` → shows the updated sentence; `grep -n "until Briefing is strong enough" README.md` → no match.

## Test plan

- New file `src/lib/landing-view.test.ts`: four cases (has-briefings, empty, non-ok, throws) → correct landing view.
- Pattern: vitest per `src/lib/bridge/people-parser.test.ts`, dependency-injecting `fetchImpl`.
- Verification: `npx vitest run src/lib/landing-view.test.ts` → all pass.

## Done criteria

ALL must hold:

- [ ] Fresh startup with ≥1 briefing lands on Briefing; with zero briefings lands on Bridge
- [ ] Deep links with an explicit view prefix are unaffected (the change is gated on `!urlViewMode`)
- [ ] `src/lib/landing-view.test.ts` passes (4 cases); `npx tsc --noEmit` and `npm run lint` exit 0; `npm test` (if 001 done) passes
- [ ] README no longer says "until Briefing is strong enough"; new copy describes the Briefing default
- [ ] `git status` shows only the four in-scope files
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The Board startup effect no longer matches the "Current state" excerpt (it has been refactored) — drift; re-locate the no-prefix landing branch and confirm before editing.
- `replaceViewMode` does not accept `"briefings"` as a valid `ViewPrefix` (type error) — report; do not widen the type here.
- Making the effect async causes a visible flash (Bridge briefly, then Briefing) bad enough to look broken — report; an alternative is to render a neutral splash until `chooseLandingView` resolves, which is a small follow-up rather than an improvisation.

## Maintenance notes

- "At least one briefing exists" is a deliberately simple readiness signal. If you later want "land on Briefing only when **today's** briefing is ready," that needs the vault's timezone (the briefings API already imports `getEasternDate`/`getHermesBriefingFailureForDate` from `@/lib/bridge/briefing-status`) — extend `chooseLandingView` to check today's dated entry and its `status`, and test the timezone boundary.
- A user preference for the landing surface (Bridge / Briefing / Library) would generalize this; out of scope here but a natural extension if more than one person uses the app.
- Reviewer should confirm deep links and the back/forward navigation still work — the gate on `!urlViewMode` is what protects them.
