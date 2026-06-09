import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { displayCalendarEventTitle } from "./title";

describe("calendar title display cleanup", () => {
  test("strips leading mail and external prefixes", () => {
    assert.equal(
      displayCalendarEventTitle("FW: [EXT] GQ, PM - Billing Reconciliation Issues"),
      "GQ, PM - Billing Reconciliation Issues"
    );
  });

  test("strips repeated and case-insensitive prefixes", () => {
    assert.equal(displayCalendarEventTitle("Re: FWD: [External] Platform Update"), "Platform Update");
    assert.equal(displayCalendarEventTitle("external: FW: Client review"), "Client review");
  });

  test("keeps meaningful bracketed status prefixes", () => {
    assert.equal(displayCalendarEventTitle("[Declined] Tour with Justin Ruckman"), "[Declined] Tour with Justin Ruckman");
  });

  test("falls back to the original title if cleanup would empty it", () => {
    assert.equal(displayCalendarEventTitle("FW: [EXT]"), "FW: [EXT]");
  });
});
