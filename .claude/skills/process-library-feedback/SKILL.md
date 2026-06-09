---
name: process-library-feedback
description: Process the user's accumulated Reference Library eval feedback — read every item with unprocessed feedback, diagnose why the eval mis-scored it, cluster the critiques into root-cause patterns, propose fixes (logic vs data, quick vs semantic), and after approval implement + re-score + report the delta. Use when the user says "process library feedback", "act on my library feedback", or similar.
---

# Process Library Feedback

The user reviews items in Hilt's Reference Library and leaves **comments** in each item's metadata panel.
Comments are persisted to Hilt's **`DATA_DIR/library-feedback/<vaultKey>.json`** store (NOT the vault
markdown — feedback is commentary to the eval engine, not article content), keyed by artifact id, as a
list of `{ id, text, created_at, updated_at?, processed_at? }`. This skill turns that accumulated feedback
into calibrated eval improvements. It is the human-in-the-loop tuning loop for the worth eval.

**The eval model** (`docs/plans/reference-library-roadmap.md`): every study item gets
`worth = relevance × substance × freshness`. Disposition (`study`/`keep`) is orthogonal. Lifecycle
(`active`/`to_archive`/`archived`) is the surfacing state; `to_archive` is a non-destructive review flag.

## Protocol (follow in order)

### 1. Gather unprocessed feedback
Read every item that has comments with no `processed_at` (the GET returns `items[].comments` +
`unprocessed` count):
```bash
# Prefer the API if the dev server is up (find the port like the hilt skill's hilt_api_port):
curl -sf "http://localhost:3000/api/library/feedback" | jq '.items'
# Fallback (no server needed) — note DATA_DIR must match the live app (/Users/jruck/.hilt/data):
DATA_DIR=/Users/jruck/.hilt/data npx tsx -e "import('./src/lib/library/library').then(m=>console.log(JSON.stringify(m.listLibraryFeedback(process.env.BRIDGE_VAULT_PATH||'/Users/jruck/work/bridge'),null,2)))"
```
If there is nothing unprocessed, say so and stop. Each item carries one or more comments; treat each
comment as a distinct critique.

### 2. Diagnose each — pull the breakdown, don't guess
For each item, fetch its eval breakdown + pipeline status (`GET /api/library/{id}` → `eval_attrs` +
`raw_frontmatter`) and read the feedback. Identify **which axis misfired**: relevance (and *why* —
zero first-party connections? topical miss?), substance, disposition, or a data gap.
**For a batch (≳4 items), run a Workflow** to diagnose items in parallel (one agent per item:
read item + feedback + breakdown → return `{id, axis, root_cause, logic_or_data}`), then proceed.

### 3. Cluster into root-cause PATTERNS (not items)
Group the diagnoses. Fix patterns, never single items (avoid overfitting). Typical clusters:
- *on-domain but unanchored* → relevance under-counts topical fit (often needs the semantic layer)
- *judged thin but actually dense* (or vice-versa) → substance grade wrong
- *mis-disposed* (study↔keep) → taxonomy signal
- *never judged / abstained* → **data gap**, fix by reprocessing, not by changing weights

### 4. Propose — classify each fix
For each pattern, propose a change and tag it:
- **logic** (weight/threshold/new structural signal in `library-eval.ts` / `recommendations.ts` /
  `taxonomy.ts`) — cheap, re-scores instantly — **vs data** (re-grade substance / reweave connections).
- **quick heuristic now vs needs the semantic layer** — be honest when a pattern is only truly fixable
  with topical relevance (Step 6); note it rather than bolting on a fragile hack.
- State the **expected blast radius** (what else the change moves).
**Present the proposal and STOP for approval. Do not implement unilaterally.**

### 5. Implement + re-score (after approval)
Make the changes. Then refresh the numbers:
- Logic changes: regenerate the report — `npx tsx scripts/library-eval-report.ts` (instant, structural).
- Substance fix: `npx tsx scripts/library-grade-substance.ts --sample 24` (gate), then `--write`.
- Connection/data gap: targeted reweave (expensive, Claude quota — confirm scope first).
Run `npx tsc --noEmit` + `npm run test:library` before declaring done.

### 6. Report the DELTA, including regressions
Show not just "the flagged items are fixed" but **what newly entered/left `to_archive`** and how the
worth distribution shifted. A fix that rescues 5 and drags 30 good items down is a bad fix — revert it.

### 7. Stamp processed + record the label
Mark the actioned comments processed (per comment; omit `commentIds` to mark all of an item's comments):
```bash
curl -sf -X POST "http://localhost:3000/api/library/feedback" -H "Content-Type: application/json" -d '{"refs":[{"id":"<artifactId>","commentIds":["<commentId>"]}]}'
```
Append each critique to `docs/eval-labels.md` (`id · title · user verdict · reason · pattern · round`).
This is both the **progress metric** (error rate: of N labeled "shouldn't archive", how many still are)
and a **regression guard** for future rounds. Then add a CHANGELOG entry for the logic changes.

## Notes
- The eval is structural/dynamic — logic re-scores are free and instant; only substance/reweave cost.
- Never auto-archive or move files as part of this; `to_archive` is a flag, archiving stays manual.
- Keep the canonical plan (`docs/plans/reference-library-roadmap.md`) in sync if a fix changes the model.
