export type LandingView = "briefings" | "bridge";

/**
 * Decide which view Hilt should open to at startup when the URL carries no
 * view prefix. Hilt defaults to Briefing; explicit URLs still preserve their
 * requested view.
 */
export async function chooseLandingView(): Promise<LandingView> {
  return "briefings";
}
