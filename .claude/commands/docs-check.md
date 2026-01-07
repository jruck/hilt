# Documentation Check

Verify that documentation is in sync with the codebase.

## Check These Files

1. **CHANGELOG.md** - Is there anything under `[Unreleased]}` that should be documented?
   - Read `docs/CHANGELOG.md`
   - Check recent git commits for undocumented changes

2. **ARCHITECTURE.md** - Does it match current code?
   - Verify file counts are still accurate
   - Check if data flow diagrams are current
   - Verify constraints are still valid

3. **API.md** - Are all routes documented?
   - List files in `src/app/api/`
   - Verify each route is in docs

4. **DATA-MODELS.md** - Are types current?
   - Read `src/lib/types.ts`
   - Verify interfaces match documentation

## Your Task

1. Read the documentation files
2. Compare with current code
3. Report any discrepancies
4. Suggest updates if needed

Start by reading `docs/CHANGELOG.md` to see recent changes.
