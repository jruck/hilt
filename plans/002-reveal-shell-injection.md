# Plan 002: Remove shell-injection RCE in `/api/reveal` (use `execFile`, not `exec`)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b0a724f..HEAD -- src/app/api/reveal/route.ts`
> If the file changed since this plan was written, compare the "Current state"
> excerpt against the live code before proceeding; on a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (do Plan 001 first if you want `npm test` as a gate, but 002 does not require it)
- **Category**: security
- **Planned at**: commit `b0a724f`, 2026-06-10

## Why this matters

`POST /api/reveal` takes a `path` from the request body and interpolates it straight into a shell command: `exec(\`open -R "${path}"\`)`. Any caller who can reach this route can execute arbitrary shell commands as the app user — a `path` value such as `"; <command> #` breaks out of the quotes. Hilt's dev server binds `0.0.0.0` (`package.json` `dev` script) and is served over a tailnet, so this is reachable beyond the local process. The fix is a one-line swap to `execFile`, which passes arguments as an argv array the shell never parses. This closes the sharpest issue in the audit with near-zero risk.

## Current state

- `src/app/api/reveal/route.ts` — the entire file (it is short):

```ts
import { NextResponse } from "next/server";
import { exec } from "child_process";

export async function POST(request: Request) {
  try {
    const { path } = await request.json();

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    // Use macOS 'open' command to reveal in Finder
    // -R flag reveals (selects) the file in Finder
    exec(`open -R "${path}"`, (error) => {
      if (error) {
        console.error("Failed to reveal in Finder:", error);
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revealing file:", error);
    return NextResponse.json(
      { error: "Failed to reveal file" },
      { status: 500 }
    );
  }
}
```

The vulnerable construct is line 14: `exec(\`open -R "${path}"\`, ...)`. The string `path` is attacker-controlled.

Convention: Node's `child_process.execFile(file, args[], cb)` runs the binary directly with an argument vector — no shell, so shell metacharacters in `path` are inert. This is the standard safe replacement for `exec` with interpolated input.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Lint the file | `npm run lint` | exit 0 |
| Confirm no `exec(` interpolation remains | `grep -n "exec(\`" src/app/api/reveal/route.ts` | no matches |

## Scope

**In scope** (the only file you should modify):
- `src/app/api/reveal/route.ts`

**Out of scope** (do NOT touch, even though they look related):
- `src/app/api/folders/route.ts` — also uses `child_process` (a `osascript` picker and a path-existence check). Its `osascript` call uses a *static* script (not user-interpolated) and is handled separately; do not change it here.
- Any other `child_process`/`exec` site in the repo. This plan is scoped to the `reveal` RCE only.
- Do NOT add path-allowlisting or scope validation here — that is a broader hardening decision deliberately deferred. This plan only removes the shell-injection vector while preserving identical behavior.

## Git workflow

- Branch: `advisor/002-reveal-shell-injection`
- Commit style: conventional commits. Example: `fix(security): use execFile in reveal route to prevent shell injection`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Swap `exec` for `execFile`

Replace the import and the call so the path is passed as an argv element:

- Change the import from `import { exec } from "child_process";` to `import { execFile } from "child_process";`
- Replace the `exec(\`open -R "${path}"\`, (error) => { ... })` call with:

```ts
execFile("open", ["-R", path], (error) => {
  if (error) {
    console.error("Failed to reveal in Finder:", error);
  }
});
```

Everything else (the `typeof path !== "string"` guard, the JSON responses, the try/catch) stays exactly as-is.

**Verify**:
- `grep -n "execFile" src/app/api/reveal/route.ts` → shows the import and the call.
- `grep -n "exec(\`" src/app/api/reveal/route.ts` → no matches.
- `npx tsc --noEmit` → exit 0.
- `npm run lint` → exit 0.

### Step 2: Manual behavior confirmation (macOS only; optional but recommended)

If a dev server is already running on this machine, confirm the happy path still works for a real file:

```bash
PORT=${PORT:-3000}
curl -s -X POST "http://localhost:$PORT/api/reveal" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"$HOME\"}"
```

**Verify**: response is `{"success":true}` and Finder reveals the home folder. Do NOT start a new long-running server solely for this; if none is running, skip and rely on the test in Step 3.

### Step 3: Add a regression test proving metacharacters are not executed

Create `src/app/api/reveal/route.test.ts` (vitest). Mock `child_process` so no real process runs, import the route's `POST`, send a malicious `path`, and assert the spawned call received the path as a **single argv element** (not a shell string):

- Use `vi.mock("child_process", () => ({ execFile: vi.fn((_f, _args, cb) => cb?.(null)) }))`.
- Build a `Request` with body `{ path: '"; touch /tmp/pwned #' }`.
- Call `POST(request)`; assert the mocked `execFile` was called with `"open"`, an args array whose last element **equals** the raw malicious string (proving it was passed as data, not interpolated), and that no shell string form was used.
- Add a second case: `path` missing → response status 400.

Model the file structure (imports, `describe`/`it`/`expect`, async handler invocation) after any existing route-adjacent vitest test; if none exists, follow `src/lib/bridge/people-parser.test.ts` for vitest syntax.

**Verify**: `npx vitest run src/app/api/reveal/route.test.ts` → all cases pass. If Plan 001 landed, `npm test` still passes.

## Test plan

- New file `src/app/api/reveal/route.test.ts` with cases: (1) malicious metacharacter path is passed as a single argv element to `execFile` (regression for the injection); (2) missing/non-string path → 400.
- Pattern: vitest with `vi.mock("child_process")`; syntax per `src/lib/bridge/people-parser.test.ts`.
- Verification: `npx vitest run src/app/api/reveal/route.test.ts` → all pass.

## Done criteria

ALL must hold:

- [ ] `src/app/api/reveal/route.ts` imports and uses `execFile("open", ["-R", path], ...)`
- [ ] `grep -n "exec(\`" src/app/api/reveal/route.ts` → no matches
- [ ] `npx tsc --noEmit` exits 0 and `npm run lint` exits 0
- [ ] `npx vitest run src/app/api/reveal/route.test.ts` passes (≥2 cases incl. the injection regression)
- [ ] `git status` shows only `route.ts` and the new test file changed
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The current `route.ts` does not match the "Current state" excerpt (it has already been changed) — drift.
- The route turns out to do more than reveal-in-Finder (e.g. it now also opens/edits files) — the behavior surface changed and the test needs rethinking.
- You find yourself wanting to add path-allowlisting to make a test pass — that is out of scope; report it as a follow-up instead.

## Maintenance notes

- The deeper issue this is one instance of: state-changing/file-touching routes have no origin/host guard while the server binds `0.0.0.0` for tailnet serving. A broader "reject non-tailnet origins" guard was deliberately deferred (it must not break legitimate tailnet/phone access). If that hardening is taken up later, this route should be covered by it too — but the `execFile` fix here stands on its own regardless.
- Reviewer should confirm `path` is never reintroduced into a template string for any shell call, and that the args array form is preserved.
