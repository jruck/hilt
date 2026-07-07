/**
 * Weekly recycle → v2 minting (v3 unit A5). The recycle route builds the v2 skeleton ITSELF:
 * `list_format: 2` is injected into the new file's frontmatter POST-interpolation (the template
 * is never trusted to carry v2 anchors — its body is preamble/Notes only), and every carried
 * task becomes a task FILE + a rendered v2 line.
 *
 * Carry fidelity is the contract (the first v2 recycle converts Justin's daily driver):
 * - v1 task line → createTask (title / [due::] → frontmatter due / title links → frontmatter
 *   projects / indent-stripped details → body, trailing blank run trimmed) + renderWeeklyV2Line.
 * - v2 task line (a later v2→v2 recycle) → the EXISTING task file is relinked, never re-minted
 *   (one identity for a unit of work); hand-added sub-bullets ride along verbatim.
 * - UNRESOLVABLE content — a task whose conversion fails (e.g. whitespace-only title), a v2
 *   line whose file is missing, or stray non-task lines between tasks — is carried VERBATIM,
 *   never skipped, never reformatted (it renders via the v2 missing/linkless degradation path).
 * - `###` group structure is preserved exactly the way the v1 recycle preserves it (heading
 *   emitted when a carried task's group changes).
 */
import { renderWeeklyV2Line } from "../tasks/weekly-v2";
import type { TaskFile } from "../tasks/types";
import type { BridgeTask } from "../types";

export const LIST_FORMAT_LINE = "list_format: 2";

/**
 * Inject `list_format: 2` into the frontmatter of interpolated template content, immediately
 * after the `week:` line. Template anchors are NOT trusted: an existing `list_format:` line is
 * overwritten, a missing `week:` line falls back to the end of the frontmatter block, and a
 * file with no frontmatter at all gets a minimal block prepended.
 */
export function injectListFormat2(content: string): string {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return `---\n${LIST_FORMAT_LINE}\n---\n\n${content}`;
  }
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      close = i;
      break;
    }
  }
  if (close === -1) {
    return `---\n${LIST_FORMAT_LINE}\n---\n\n${content}`;
  }
  for (let i = 1; i < close; i++) {
    if (/^list_format\s*:/.test(lines[i])) {
      lines[i] = LIST_FORMAT_LINE;
      return lines.join("\n");
    }
  }
  for (let i = 1; i < close; i++) {
    if (/^week\s*:/.test(lines[i])) {
      lines.splice(i + 1, 0, LIST_FORMAT_LINE);
      return lines.join("\n");
    }
  }
  lines.splice(close, 0, LIST_FORMAT_LINE);
  return lines.join("\n");
}

/** Input for minting one carried task file (the caller binds baseDir/status/origin). */
export interface CarriedTaskInput {
  title: string;
  due?: string;
  projects?: string[];
  body?: string;
}

export interface V2CarryResult {
  /** The lines to write under the new file's `## Tasks` section. */
  lines: string[];
  /** Task files minted from v1 lines. */
  created: number;
  /** Existing task files relinked from v2 lines (v2→v2 recycle). */
  relinked: number;
  /** Lines carried verbatim because they could not be confidently converted. */
  verbatim: number;
}

/** Trailing blank lines are inter-task spacing in the outgoing file, not task content. */
function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === "") end--;
  return lines.slice(0, end);
}

/**
 * Build the carried-tasks block for the new v2 weekly file by WALKING the outgoing file's
 * task-section lines (not just the parsed tasks): parsed tasks are converted/relinked, group
 * headings are re-emitted on group change (v1 recycle parity), and any line the v1 parser
 * dropped (stray non-task content between tasks, including strays interleaved INSIDE a task's
 * block) is carried verbatim — never skipped.
 *
 * `create` mints one task file (throws → the whole task block is carried verbatim);
 * `readTaskAtPath` resolves an existing task file for v2 relinks (null → verbatim).
 */
export function buildV2CarrySection(
  outgoingContent: string,
  tasks: BridgeTask[],
  carrySet: Set<string>,
  create: (input: CarriedTaskInput) => TaskFile,
  readTaskAtPath: (taskPath: string) => TaskFile | null,
): V2CarryResult {
  const result: V2CarryResult = { lines: [], created: 0, relinked: 0, verbatim: 0 };
  const byStart = new Map<number, BridgeTask>();
  for (const t of tasks) {
    if (t.startLine !== undefined) byStart.set(t.startLine - 1, t); // startLine is 1-based
  }
  if (byStart.size === 0) return result;

  const lines = outgoingContent.split("\n");

  // Walk range: from just under `## Tasks` when the heading exists directly above the first
  // task (only ###/blank/stray lines between), through the last task block, extended to the
  // next `## ` section heading (stray content after the last task still carries).
  let walkStart = Math.min(...byStart.keys());
  for (let i = walkStart - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "## Tasks") {
      walkStart = i + 1;
      break;
    }
    if (trimmed.startsWith("## ")) break;
  }
  let walkEnd = 0;
  for (const [start, t] of byStart) walkEnd = Math.max(walkEnd, start + t.rawLines.length);
  for (let i = walkEnd; i < lines.length; i++) {
    if (lines[i].trim().startsWith("## ")) break;
    walkEnd = i + 1;
  }

  let lastGroup: string | null = null;
  const emitGroupHeading = (t: BridgeTask) => {
    if (t.group && t.group !== lastGroup) {
      if (result.lines.length > 0) result.lines.push("");
      result.lines.push(`### ${t.group}`);
    }
    lastGroup = t.group;
  };

  const emitVerbatim = (block: string[]) => {
    const trimmed = trimTrailingBlanks(block);
    result.lines.push(...trimmed);
    result.verbatim += trimmed.length;
  };

  let i = walkStart;
  while (i < walkEnd) {
    const task = byStart.get(i);
    if (task) {
      // Consume the task's block by MATCHING rawLines in order — the parser drops stray
      // non-indented lines from rawLines while keeping later indented lines, so a block's
      // rawLines are ordered but not necessarily consecutive in the file.
      const strays: string[] = [];
      let j = i;
      let k = 0;
      while (k < task.rawLines.length && j < walkEnd) {
        if (j !== i && byStart.has(j)) break; // safety: never consume into the next task
        if (lines[j] === task.rawLines[k]) k++;
        else strays.push(lines[j]);
        j++;
      }

      if (carrySet.has(task.id)) {
        emitGroupHeading(task);
        if (task.taskPath) {
          // v2 source line: relink the existing file (identity preserved across weeks).
          const existing = readTaskAtPath(task.taskPath);
          if (existing) {
            result.lines.push(renderWeeklyV2Line(existing, task.taskPath));
            result.relinked++;
            // Hand-added sub-bullets on the list ride along verbatim.
            const rest = trimTrailingBlanks(task.rawLines.slice(1));
            result.lines.push(...rest);
          } else {
            emitVerbatim(task.rawLines);
          }
        } else {
          try {
            const body = trimTrailingBlanks(task.details).join("\n");
            const file = create({
              title: task.title,
              due: task.dueDate ?? undefined,
              projects: task.projectPaths.length > 0 ? [...task.projectPaths] : undefined,
              body: body.length > 0 ? body : undefined,
            });
            result.lines.push(renderWeeklyV2Line(file, `tasks/${file.id}.md`));
            result.created++;
          } catch {
            emitVerbatim(task.rawLines);
          }
        }
      }
      // Strays interleaved inside the block carry regardless of the task's carry choice.
      if (strays.length > 0) emitVerbatim(strays);
      i = j;
      continue;
    }

    const line = lines[i];
    if (line.trim() === "" || /^###\s+/.test(line)) {
      // Blanks are spacing; ### headings are re-emitted via group tracking above.
      i++;
      continue;
    }
    // Stray non-task content between tasks: carried verbatim, never skipped.
    emitVerbatim([line]);
    i++;
  }

  return result;
}
