/**
 * Task id shape — PURE (no fs/path imports) so client components can validate ids too.
 * Every id the lib mints matches this; anything else is rejected before it reaches a
 * path.join. Ids arrive from URLs (API routes) and loop payloads, so a permissive id is
 * a path-traversal vector (`../../evil` — confirmed exploit in the A2 adversarial review).
 */
export const TASK_ID_RE = /^t-\d{8}-\d{3,}$/;

export function isValidTaskId(id: string): boolean {
  return TASK_ID_RE.test(id);
}
