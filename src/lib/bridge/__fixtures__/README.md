# Weekly-list fixtures (v3 unit A3)

## weekly-v1/ — golden byte locks

Byte-exact copies of REAL historical weekly lists, copied (read-only) from
`~/work/bridge/lists/now/` on 2026-07-07:

- `2026-01-27.md` — small legacy file: `## Tasks` wrapper, `## Notes`, 2-space detail
  indents, wiki links, media embed. Hand-edited era (not serializer-canonical).
- `2026-03-02.md` — new-format file with NO `## Tasks` wrapper (exercises the fallback
  section scan), `## Accomplishments`, and 8 `###` group headings.
- `2026-03-16.md` — large file: `## Tasks` wrapper, 4 groups, `[due:: …]` fields,
  tab-indented details, accomplishments prose, project title-links.

`golden-manifest.json` holds sha-256 hashes of every mutator's output on each golden,
generated against the pre-A3 (v1-only) parser. `weekly-goldens.test.ts` recomputes and
compares — any byte drift in v1 behavior fails. Regenerate ONLY for a deliberate v1
behavior change: `UPDATE_WEEKLY_GOLDENS=1 npx tsx --test src/lib/bridge/weekly-goldens.test.ts`.

## weekly-v2/ — hand-authored v2 vault

A `list_format: 2` weekly list plus matching task files, covering: linked+due line,
done line, line whose task file is intentionally MISSING (`t-20260706-003.md` does not
exist — degradation case), a linkless plain line, and a grouped line with a detail line.
Tests copy this tree into a temp dir before exercising writes.
