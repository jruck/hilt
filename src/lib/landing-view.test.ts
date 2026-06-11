import { describe, it, expect } from "vitest";
import { chooseLandingView } from "./landing-view";

describe("chooseLandingView", () => {
  it("lands on Briefing by default", async () => {
    expect(await chooseLandingView()).toBe("briefings");
  });
});
