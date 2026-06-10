export type LandingView = "briefings" | "bridge";

/**
 * Decide which view Hilt should open to at startup when the URL carries no
 * view prefix. Lands on Briefing when at least one briefing exists; otherwise
 * Bridge. Any failure falls back to Bridge so startup never lands on a blank
 * Briefing page.
 *
 * `fetchImpl` is injectable for testing; production calls `chooseLandingView()`.
 */
export async function chooseLandingView(
  fetchImpl: typeof fetch = fetch,
): Promise<LandingView> {
  try {
    const res = await fetchImpl("/api/bridge/briefings");
    if (!res.ok) return "bridge";
    const list = await res.json();
    return Array.isArray(list) && list.length > 0 ? "briefings" : "bridge";
  } catch {
    return "bridge";
  }
}
