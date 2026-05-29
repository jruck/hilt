# Calendar V1 Kickoff Goal Prompt

```text
Implement Hilt Calendar V1 end to end, using this file as the authoritative spec:

/Users/jruck/work/engineering/me/hilt/docs/plans/calendar-v1-implementation-plan.md

Read the plan fully, inspect the current repo before editing, and follow existing Hilt patterns. Build the complete read-only ICS calendar experience described there: local calendar storage/sync, APIs, Calendar navigation/view integration, Schedule-X UI, source/calendar toggles, health/status, event drawer, meeting-link extraction, and the automated tests/scripts required by the plan.

Use the three private ICS URLs already configured in ignored `.env.local`. Verify the feeds structurally, but never print, commit, return from APIs, or render the feed URLs or raw private event content. Treat the implementation plan's scope boundaries as binding; do not expand V1 beyond that plan.

Verification is part of the goal, not a follow-up. Add the required automated coverage, then run and pass:
- `npm run lint`
- `npm run build`
- `npm run test:calendar`
- `npm run test:calendar:e2e`

Start the local dev server and perform browser verification with fixture/private-safe data. Verify desktop at 1440x1000 and 1280x800, and mobile at 390x844 and 430x932. Confirm all calendar modes work, the calendar is nonblank and correctly framed, toggles and event drawer work, manual sync updates the UI, console errors are absent, text/controls do not overlap, and the experience looks polished in desktop and mobile layouts.

Before declaring completion, audit every requirement in the implementation plan against concrete evidence from code, tests, command output, browser checks, and secret-safe real-feed verification. Keep working until the plan is fully implemented and verified. In the final response, summarize changes, list verification results, mention known ICS data limitations, and do not reveal private feed URLs or raw event content.
```
