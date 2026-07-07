/**
 * Ignore predicate for the BridgeWatcher's chokidar instance.
 *
 * Replaces the old blanket dot-regex (`/(^|[/\\])\../`), which would have hidden
 * `tasks/.proposals/` — where proposal task files live from birth (v3 task object).
 * Semantics: any dot-prefixed path segment is ignored (editor droppings, `.git`,
 * `.DS_Store`, `.obsidian`, …) EXCEPT the `.proposals` directory directly under a
 * `tasks` segment. Dotfiles INSIDE `.proposals/` (e.g. `.DS_Store`) are still ignored
 * — the exception admits the directory segment, not dot-named children.
 * `node_modules` stays ignored.
 *
 * Pure function (no fs, no state) so it is unit-testable; see watch-ignore.test.ts.
 */
export function isIgnoredBridgePath(filePath: string): boolean {
  const segments = filePath.split(/[/\\]/);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "node_modules") return true;
    if (segment.startsWith(".") && segment !== "." && segment !== "..") {
      if (segment === ".proposals" && segments[i - 1] === "tasks") continue;
      return true;
    }
  }
  return false;
}
