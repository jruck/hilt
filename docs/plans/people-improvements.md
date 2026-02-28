# People Improvements

Roadmap for People tab features beyond Phase 5.

## Completed

- **Phase 1**: Read-only people list + detail
- **Phase 2**: Meeting card feed with tabbed artifacts
- **Phase 3**: Editing + rendering (tiptap for summaries/transcripts/next)
- **Phase 4**: Three-column email inbox layout
- **Phase 5**: "Next" as meeting entry + date hierarchy flip

## Planned

### Google Calendar Sync

Surface upcoming meetings from Google Calendar in the person's meeting feed. When you click a person, you see not just past meetings but what's coming up — giving context before a meeting starts.

- OAuth flow for GCal access (or read from a local sync/export)
- Match calendar events to people by attendee name/email
- Show upcoming meetings in the feed with a distinct visual treatment (future vs past)
- Handle recurring meetings (1:1s, standups)

### Auto-Matching Calendar Events to People

Calendar events have attendees; people files have names. Bridge the gap:

- Tokenize attendee names/emails and match against people slugs
- Handle aliases (e.g., "Robert" in calendar, "Bob" in people file)
- Surface unmatched attendees as suggestions for new people entries
- Store confirmed mappings so matching improves over time

### Meeting Creation Workflow

Create meetings from within the person view rather than relying on external tools:

- "New meeting" action from person view that creates a dated entry
- Pre-populate with Next content (similar to commit, but for right now)
- Optional: create a calendar event simultaneously

### Granola + GCal Reconciliation

Granola records meetings independently from the calendar. Reconcile the two sources:

- Match Granola recordings to calendar events by time window + attendees
- Deduplicate: don't show the same meeting twice from different sources
- Prefer Granola summary/transcript when available, fall back to calendar metadata
- Handle edge cases: ad-hoc meetings (Granola but no calendar), canceled meetings (calendar but no Granola)
