# Commit Changes

Before committing, verify documentation is updated:

## Pre-Commit Checklist

1. **Check what changed**:
   ```bash
   git diff --stat
   git diff --name-only
   ```

2. **Update CHANGELOG.md** if not already done:
   - Add entry under `[Unreleased]` section
   - Include category (Added/Changed/Fixed/Removed)
   - List affected files in parentheses

3. **Update other docs if needed**:
   - `docs/ARCHITECTURE.md` - if system design changed
   - `docs/API.md` - if API routes changed
   - `docs/DATA-MODELS.md` - if types changed
   - `docs/COMPONENTS.md` - if significant component changes
   - `docs/DESIGN-PHILOSOPHY.md` - if UI/UX work revealed new preferences or patterns

4. **Create the commit**:
   - Use descriptive commit message
   - Include 🤖 Generated with Claude Code footer

## Your Task

Review the current changes and:
1. If docs need updating, update them first
2. Then create the commit with proper message
3. Show the commit result

Run `git status` and `git diff --stat` to see what needs to be committed.
