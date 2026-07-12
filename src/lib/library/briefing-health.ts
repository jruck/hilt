export interface LibraryBriefingHealthInput {
  scorecard: Record<string, unknown> | null;
  proposalCount: number;
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Stable one- or two-sentence briefing copy derived from the report, never improvised by the briefing model. */
export function libraryBriefingHealthSummary({ scorecard, proposalCount }: LibraryBriefingHealthInput): string {
  if (!scorecard) return "The daily Library scorecard failed to run; processing and recommendation quality need review.";
  const weave = numberOf(scorecard.m6_weave_completeness);
  const agreement = numberOf(scorecard.m1_judge_score_agreement);
  const unhealthyWeave = weave !== null && weave < 0.97;
  const opening = unhealthyWeave
    ? `Library processing needs attention: weave completeness is ${percent(weave)} against a 97% target.`
    : `Library processing is healthy${proposalCount ? `; ${proposalCount} steering proposal${proposalCount === 1 ? "" : "s"} await${proposalCount === 1 ? "s" : ""} review` : "; no steering proposals await review"}.`;
  const metrics: string[] = [];
  if (!unhealthyWeave && weave !== null) metrics.push(`Weave completeness is ${percent(weave)}`);
  if (agreement !== null && agreement < 0.8) metrics.push(`judge-score agreement remains ${percent(agreement)} against an 80% target`);
  return metrics.length ? `${opening} ${metrics.join(", while ")}.` : opening;
}
