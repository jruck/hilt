import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Commit + push a single briefing file to the bridge vault. Hilt's other scheduled jobs DON'T commit
 * (they rely on an external sync), which is exactly what stranded briefings on Hestia after the
 * rename — so the native briefing job owns its own commit+push. Idempotent: if the file is unchanged
 * (e.g. a weekend Sunday run decides no refresh is warranted), it commits nothing. Never throws —
 * a push failure is logged; the file is still written locally.
 */
export async function commitBriefing(vaultPath: string, relPath: string, message: string): Promise<{
  committed: boolean;
  pushed: boolean;
  note?: string;
}> {
  const git = (args: string[], timeout = 30_000) => execFileAsync("git", ["-C", vaultPath, ...args], { timeout });
  try {
    await git(["add", "--", relPath]);
    // Nothing staged → nothing to do (idempotent no-op for an unchanged weekend file).
    try {
      await git(["diff", "--cached", "--quiet", "--", relPath]);
      return { committed: false, pushed: false, note: "no change" };
    } catch {
      // non-zero exit = there ARE staged changes; proceed to commit.
    }
    await git(["commit", "-m", message]);
    try {
      await git(["push"], 60_000);
      return { committed: true, pushed: true };
    } catch (error) {
      const e = error as Error & { stderr?: string };
      return { committed: true, pushed: false, note: `push failed: ${(e.stderr || e.message || "").slice(0, 200)}` };
    }
  } catch (error) {
    const e = error as Error & { stderr?: string };
    return { committed: false, pushed: false, note: `commit failed: ${(e.stderr || e.message || "").slice(0, 200)}` };
  }
}
