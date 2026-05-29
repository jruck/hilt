# Hilt Calendar V1 Implementation Plan

## Summary

Build a first-class Hilt Calendar view backed by a local Hilt-owned event database. V1 is ICS-only and read-only: consume private subscription feeds for personal Google, Priceless Google, and EverCommerce Outlook; render them as a unified calendar with Schedule-X; and expose enough event metadata for meeting notes, people context, join links, and future task attachment.

This version intentionally avoids OAuth, Nylas, Microsoft Graph, Google Calendar API, RSVP, and event creation. Those remain future provider adapters if the read-only calendar proves valuable enough to justify deeper integration.

## Key Changes

- Add dependencies: `@schedule-x/react`, `@schedule-x/calendar`, `@schedule-x/events-service`, `@schedule-x/theme-default`, `temporal-polyfill`, and `ical.js`.
- Add a top-level `calendar` view to Hilt routing/nav and render a new `CalendarView`.
- Add local SQLite calendar storage under `DATA_DIR` for ICS sources, calendars, events, participants, sync state, source health, raw ICS payload metadata, and hidden duplicate provenance.
- Add an `ics` sync adapter that fetches private feed URLs from `.env.local`, parses event data, and writes normalized events into Hilt-owned storage.
- Sync window defaults to 180 days past and 365 days future for UI queries, while retaining source metadata needed for recurrence and dedupe.
- Deduplicate feeds by stable calendar UID when available, otherwise by normalized title/start/end; preserve all source provenance but show one visible event.
- Use Hilt's existing WebSocket event channel to notify the UI after local sync changes.

## Credentials And Bootstrap

The following ignored local env keys are required:

- `HILT_CALENDAR_ICS_PERSONAL_URL`
- `HILT_CALENDAR_ICS_PRICELESS_URL`
- `HILT_CALENDAR_ICS_EVERCOMMERCE_URL`
- `HILT_CALENDAR_ICS_US_HOLIDAYS_URL` (optional override; defaults to a public US holidays ICS feed and filters to public holidays)
- Optional:
  - `HILT_CALENDAR_SYNC_PAST_DAYS=180`
  - `HILT_CALENDAR_SYNC_FUTURE_DAYS=365`
  - `HILT_WEATHER_POSTAL_CODE=30310`
  - `HILT_WEATHER_LOCATION_LABEL=Atlanta, GA`
  - `HILT_WEATHER_LATITUDE=33.7269`
  - `HILT_WEATHER_LONGITUDE=-84.4289`
  - `HILT_WEATHER_TIMEZONE=America/New_York`

Bootstrap flow:

- Add a setup/status API that checks the three feed URLs without exposing them.
- Add a feed capability audit that reports event counts and field coverage: summaries, descriptions, locations, organizers, attendees, recurrence, canceled/private markers, and likely Teams/Meet/Zoom links.
- First acceptance gate: all three feeds fetch successfully, parse into events, and produce a capability report without leaking raw event content or feed URLs.

Verified initial feed capability on May 29, 2026:

- EverCommerce Outlook: fetches successfully; includes many descriptions, locations, recurring events, and Teams/Zoom/Meet links; does not expose attendees or organizer.
- Priceless Google: fetches successfully; includes descriptions, locations, organizers, attendees, recurrence, and meeting links.
- Personal Google: fetches successfully; includes descriptions, locations, organizers, attendees, recurrence, and meeting links.

## Interfaces

Add these server APIs:

- `GET /api/calendar/setup/status`
- `GET /api/calendar/sources`
- `POST /api/calendar/sync`
- `GET /api/calendar/health`
- `PATCH /api/calendar/calendars/:id`
- `GET /api/calendar/events?start=...&end=...&sourceIds=...&calendarIds=...`
- `GET /api/calendar/events/:id`
- `GET /api/weather/forecast?start=YYYY-MM-DD&end=YYYY-MM-DD`

Expose normalized client types:

- `CalendarSource`: source ID, label, provider hint, account hint, read-only capability, last sync, last error, masked URL status.
- `CalendarDefinition`: display name, color, selected state, source ID, read-only state.
- `CalendarEvent`: stable Hilt ID, source IDs, title, time range, all-day flag, description, location, extracted join links, attendees when available, organizer when available, recurrence metadata, visibility, source health.
- `CalendarHealth`: per-source sync status, last success, last error, stale/blocked indicators, and field coverage summary.

RSVP behavior:

- Not implemented in V1.
- UI must clearly present the calendar as read-only.
- Event drawer may include "Open in provider" only when a source URL is available from the feed.

## UI

- Add Calendar to primary navigation with a distinct icon and keyboard shortcut after Briefing.
- Use Schedule-X for day, week, month grid, and agenda/list-style modes.
- Hilt owns the surrounding UI: toolbar, today/back/next controls, mode switcher, calendar/source sidebar, sync status, and event detail drawer.
- Calendar sidebar supports source grouping, calendar toggles, source health, and manual sync.
- Event drawer shows title, time, calendar, source, description, location, extracted join links, organizer/attendees when available, recurrence hints, and read-only status.
- Calendar colors come from feed metadata when available, otherwise deterministic Hilt colors by source/calendar.
- Day and week headers show compact forecast chips with condition icon, high/low, and a weather.gov click-through; the default forecast location is Atlanta ZIP 30310.
- Mobile first version must render the same modes, but may prioritize compact toolbar and drawer behavior over dense desktop controls.

## Test Plan

Add `npm run test:calendar` for Node/unit/API tests and a Playwright-backed `npm run test:calendar:e2e` for browser flow.

Automated tests:

- Setup/status tests:
  - Missing ICS env values report unavailable without exposing values.
  - Valid feed env values report configured sources with masked URLs.
  - Failed fetches produce precise source health errors.
- Storage and sync tests:
  - Schema creation is idempotent and uses an isolated temp `DATA_DIR`.
  - ICS parser handles timed events, all-day events, recurring events, recurrence exceptions, time zones, descriptions, HTML descriptions, locations, URLs, organizer, attendees, canceled events, and malformed feeds.
  - Meeting link extraction finds Teams, Google Meet, Zoom, and generic conferencing links from description/location/URL fields.
  - Sync is idempotent across repeated runs.
  - 6-month-past/1-year-future query filtering is enforced.
  - Duplicate detection preserves provenance but returns one visible event.
- API tests:
  - Event range queries return only selected visible calendars.
  - Calendar toggle updates persist.
  - Event detail endpoint includes normalized metadata and extracted join links.
  - Health endpoint includes per-source capability coverage and stale/error state.
- UI tests:
  - Calendar nav route loads.
  - Day, week, month, and agenda/list modes render fixture events.
  - Calendar toggles hide/show events.
  - Event drawer opens and displays join link, description, source, and read-only state.
  - Manual sync updates UI after a mocked backend change.
  - Desktop and mobile viewport smoke tests pass without overlapping controls.

Final verification:

- Run `npm run lint`, `npm run build`, `npm run test:calendar`, and `npm run test:calendar:e2e`.
- With real ICS feeds, sync the default window and compare the next 7 days against Google/Outlook/Fantastical for obvious missing or duplicated meetings.

## Assumptions

- V1 is read-only and ICS-only.
- Private feed URLs live only in ignored local env and are never returned by APIs or rendered in UI.
- EverCommerce attendee/organizer data is not available from the current Outlook ICS feed; people linkage for that feed must rely on title/body/link heuristics until a richer provider adapter exists.
- Nylas, Google Calendar API, Microsoft Graph, RSVP, and scheduling are future adapters/features, not prerequisites for the first build.
- Build future task/person linkage on top of stable Hilt event IDs, but do not ship task attachment UI in this first calendar pass.

## References

- [RFC 5545 iCalendar](https://www.rfc-editor.org/rfc/rfc5545)
- [Microsoft calendar sharing](https://support.microsoft.com/en-us/office/calendar-sharing-in-microsoft-365-b576ecc3-0945-4d75-85f1-5efafb8a37b4)
- [Microsoft publishing Internet calendars](https://support.microsoft.com/en-us/office/introduction-to-publishing-internet-calendars-a25e68d6-695a-41c6-a701-103d44ba151d)
- [Google secret iCal address](https://support.google.com/calendar/answer/37648)
- [Schedule-X React](https://schedule-x.dev/docs/frameworks/react)
- [Schedule-X plugins](https://schedule-x.dev/docs/calendar/plugins)
