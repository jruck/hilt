import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeDescriptionForDisplay, prepareCalendarDescription } from "./description";

describe("calendar description display", () => {
  test("keeps human Google text and hides appended Zoom boilerplate", () => {
    const description = prepareCalendarDescription(`Weekly stakeholder meeting to advance the CML Immersive Media CMS.<br><br>--------------------<br><br>Join Zoom Meeting<br><a href="https://us06web.zoom.us/j/83531192498">https://us06web.zoom.us/j/83531192498</a><br><br>Meeting ID: 835 3119 2498<br>Passcode: 603059<br><br>---<br><br>One tap mobile<br>+16465588656,,83531192498# US`);

    assert.equal(description.visible, "Weekly stakeholder meeting to advance the CML Immersive Media CMS.");
    assert.match(description.full ?? "", /Join Zoom Meeting/);
    assert.match(description.hidden ?? "", /Meeting ID: 835 3119 2498/);
  });

  test("keeps a real Teams agenda before the generated meeting block", () => {
    const description = prepareCalendarDescription(`Meeting Purpose
Create early visibility into what's coming so every release has a real launch and GTM plan before it ships.

What we'll cover each month
- What's coming in the next 30 / 60 / 90 days

________________________________________________________________________________
Microsoft Teams meeting
Join: https://teams.microsoft.com/meet/26249915088324
Meeting ID: 262 499 150 883 24
Passcode: 29Fw9xZ3`);

    assert.match(description.visible ?? "", /Meeting Purpose/);
    assert.match(description.visible ?? "", /What we'll cover/);
    assert.doesNotMatch(description.visible ?? "", /Microsoft Teams meeting/);
    assert.match(description.hidden ?? "", /Microsoft Teams meeting/);
  });

  test("hides provider-only Teams details", () => {
    const description = prepareCalendarDescription(`________________________________________________________________________________
Microsoft Teams Need help?<https://aka.ms/JoinTeamsMeeting?omkt=en-US>
Join the meeting now<https://teams.microsoft.com/l/meetup-join/example>
Meeting ID: 213 565 712 757
Passcode: Sm7pu5`);

    assert.equal(description.visible, null);
    assert.match(description.hidden ?? "", /Join the meeting now/);
    assert.match(description.full ?? "", /Meeting ID/);
  });

  test("does not hide ordinary descriptions without provider details", () => {
    const description = prepareCalendarDescription("Bring launch notes and review final risks.");

    assert.equal(description.visible, "Bring launch notes and review final risks.");
    assert.equal(description.hidden, null);
  });

  test("normalizes lightweight HTML for display", () => {
    assert.equal(
      normalizeDescriptionForDisplay('Agenda<br><a href="https://example.com/doc">https://example.com/doc</a>'),
      "Agenda\nhttps://example.com/doc",
    );
  });
});
