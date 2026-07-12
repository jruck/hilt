import assert from "node:assert/strict";
import test from "node:test";
import { libraryBriefingHealthSummary } from "./briefing-health";

test("briefing health prioritizes proposals and one useful quality read", () => {
  assert.equal(
    libraryBriefingHealthSummary({ scorecard: { m6_weave_completeness: 0.98, m1_judge_score_agreement: 0.625 }, proposalCount: 1 }),
    "Library processing is healthy; 1 steering proposal awaits review. Weave completeness is 98%, while judge-score agreement remains 63% against an 80% target.",
  );
});

test("briefing health makes failed and incomplete reports explicit", () => {
  assert.match(libraryBriefingHealthSummary({ scorecard: null, proposalCount: 0 }), /failed to run/);
  assert.match(libraryBriefingHealthSummary({ scorecard: { m6_weave_completeness: 0.9 }, proposalCount: 0 }), /needs attention/);
});
