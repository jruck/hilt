/**
 * URL-based view mode routing helpers.
 *
 * URL structure: /<viewPrefix>/<scopePath>
 * e.g. /docs/Users/me/work/projects
 *      /bridge
 *      /stack/Users/me/work/projects
 */

export const VIEW_PREFIXES = ["bridge", "docs", "stack", "briefings"] as const;
export type ViewPrefix = (typeof VIEW_PREFIXES)[number];

export function isViewPrefix(s: string): s is ViewPrefix {
  return (VIEW_PREFIXES as readonly string[]).includes(s);
}

/**
 * Parse URL path segments into a view mode and scope path.
 * Returns viewMode: null when the URL has no recognized prefix (legacy URL).
 */
export function parseViewUrl(segments: string[]): { viewMode: ViewPrefix | null; scope: string } {
  const first = segments[0];
  if (first && isViewPrefix(first)) {
    const scope = segments.length > 1 ? `/${segments.slice(1).join("/")}` : "";
    return { viewMode: first, scope };
  }
  return { viewMode: null, scope: segments.length > 0 ? `/${segments.join("/")}` : "" };
}

/**
 * Build a URL string from a view prefix and scope path.
 */
export function buildViewUrl(viewMode: string, scope: string): string {
  return scope ? `/${viewMode}${scope}` : `/${viewMode}`;
}
