/**
 * Seeds a Granola meeting-note row linked to the demo "Client review" calendar fixture event.
 *
 * This makes the calendar event popover show the "Notes" action in demo/screenshot mode, the
 * reciprocal of the `Calendar` chip that the demo meeting note already carries via frontmatter.
 *
 * Runs against the demo data dir (DATA_DIR). It syncs the calendar fixtures itself so the event
 * ids exist, then resolves the real synced id for "Client review" and links a Granola row to it.
 */
import path from "node:path";
import { syncCalendarSources } from "../src/lib/calendar/sync";
import { queryCalendarEvents } from "../src/lib/calendar/db";
import { ensureGranolaSyncSchema, getGranolaSyncDb } from "../src/lib/granola/db";

process.env.HILT_CALENDAR_FIXTURE_MODE ||= "1";
process.env.HILT_WEATHER_FIXTURE_MODE ||= "1";

const NOTE_REL_PATH = "docs/demo/meetings/2026-05-29/art-vandelay.md";
const TARGET_TITLE = "client review";
const GRANOLA_ID = "client-review-demo";

async function main() {
  await syncCalendarSources();

  const events = queryCalendarEvents({
    start: new Date("2026-05-01T00:00:00Z"),
    end: new Date("2026-06-30T23:59:59Z"),
  });
  const target = events.find((event) => event.title.trim().toLowerCase() === TARGET_TITLE);
  if (!target) {
    throw new Error(
      `Could not find a "Client review" fixture event to link (${events.length} events in window).`,
    );
  }

  ensureGranolaSyncSchema();
  const now = new Date().toISOString();
  const notePath = path.resolve(process.cwd(), NOTE_REL_PATH);
  getGranolaSyncDb()
    .prepare(
      `
      INSERT INTO granola_documents (
        id, title, created_at, updated_at, granola_url, note_path,
        hilt_calendar_event_id, hilt_calendar_match_method, hilt_calendar_match_confidence,
        raw_json, transcript_pending, last_seen_at, last_synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        hilt_calendar_event_id = excluded.hilt_calendar_event_id,
        hilt_calendar_match_method = excluded.hilt_calendar_match_method,
        hilt_calendar_match_confidence = excluded.hilt_calendar_match_confidence,
        note_path = excluded.note_path,
        last_seen_at = excluded.last_seen_at
    `,
    )
    .run(
      GRANOLA_ID,
      "Client Review",
      "2026-05-29T14:00:00.000Z",
      "2026-05-29T14:00:00.000Z",
      "https://notes.granola.ai/d/client-review-demo",
      notePath,
      target.id,
      "icaluid",
      1,
      "{}",
      now,
      now,
    );

  console.log(`Linked Granola note "${GRANOLA_ID}" -> calendar event "${target.id}" (${target.title}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
