import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CALENDAR_SYNC_FRESHNESS_MS, calendarSourcesNeedSync } from "./freshness";
import type { CalendarSource } from "./types";

const NOW = Date.parse("2026-06-03T18:00:00.000Z");

describe("calendar freshness", () => {
  test("does not sync when no configured sources exist", () => {
    assert.equal(calendarSourcesNeedSync([], NOW), false);
    assert.equal(calendarSourcesNeedSync([source({ configured: false, lastSyncAt: null })], NOW), false);
  });

  test("syncs when a configured source has never synced", () => {
    assert.equal(calendarSourcesNeedSync([source({ lastSyncAt: null })], NOW), true);
  });

  test("syncs when the newest configured source is at least five minutes old", () => {
    assert.equal(calendarSourcesNeedSync([
      source({ id: "evercommerce", lastSyncAt: new Date(NOW - CALENDAR_SYNC_FRESHNESS_MS - 1).toISOString() }),
      source({ id: "personal", lastSyncAt: new Date(NOW - CALENDAR_SYNC_FRESHNESS_MS).toISOString() }),
    ], NOW), true);
  });

  test("waits when the newest configured source is fresh", () => {
    assert.equal(calendarSourcesNeedSync([
      source({ id: "evercommerce", lastSyncAt: new Date(NOW - 60 * 60 * 1000).toISOString() }),
      source({ id: "personal", lastSyncAt: new Date(NOW - 60 * 1000).toISOString() }),
    ], NOW), false);
  });

  test("syncs again when a configured source has an error", () => {
    assert.equal(calendarSourcesNeedSync([
      source({ lastSyncAt: new Date(NOW - 30 * 1000).toISOString(), lastError: "ICS fetch failed" }),
    ], NOW), true);
  });
});

function source(overrides: Partial<CalendarSource> = {}): CalendarSource {
  return {
    id: "personal",
    label: "Personal",
    providerHint: "google",
    accountHint: "justin@example.com",
    readOnly: true,
    configured: true,
    urlConfigured: true,
    color: "#dc2626",
    lastSyncAt: new Date(NOW).toISOString(),
    lastError: null,
    lastFetchMs: 100,
    lastEventCount: 1,
    coverage: null,
    ...overrides,
  };
}
