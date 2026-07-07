/**
 * Weekly recycle — mints the NEXT week's list. As of v3 unit A5 the minted list is v2
 * (task-file-backed): the route injects `list_format: 2` itself post-interpolation (template
 * anchors are never trusted — the template body is preamble/Notes only) and converts every
 * carried task into a task file + rendered v2 line via buildV2CarrySection (unresolvable
 * content carries verbatim, never skipped). The OUTGOING file is untouched except for the
 * accomplishments write the recycle has always done.
 *
 * Orphan sweep (`carryUnlisted`): an ACTIVE task file with no line in the outgoing list is
 * invisible everywhere except its origin meeting — and because the carry walks LINES, it would
 * never ride into future weeks. The client sends those file ids explicitly; each valid one gets
 * a v2 line rendered from its FILE (a relink/line-render, never a re-mint). Invalid/stale ids
 * are skipped with a warn and reported — an orphan never fails the recycle.
 */
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseWeeklyFile, updateAccomplishments } from "@/lib/bridge/weekly-parser";
import { getVaultPath, listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";
import { buildV2CarrySection, injectListFormat2 } from "@/lib/bridge/recycle-v2";
import { AGENT_SECTION_HEADING, insertWeeklyV2LineInSection } from "@/lib/bridge/weekly-v2-view";
import { createTask, isValidTaskId, listTasks, readTask } from "@/lib/tasks/store";
import { parseTaskFile } from "@/lib/tasks/task-file";
import { renderWeeklyV2Line } from "@/lib/tasks/weekly-v2";
import type { TaskFile } from "@/lib/tasks/types";

/** Orphan-carry eligibility: the statuses that mean "this task is still live work". Done and
 * dropped files stay behind by definition; proposals live in `.proposals/` and never orphan. */
const ACTIVE_ORPHAN_STATUSES = new Set(["accepted-me", "accepted-agent", "in-progress"]);

/**
 * Data-preservation rule (v3 plan): snapshot lists/now/ to $DATA_DIR/backups/<date>-recycle-v2/
 * before the recycle writes anything. Best-effort — a failed snapshot logs and never blocks the
 * recycle. Existing snapshot files are never overwritten (the FIRST copy of the day — the
 * pre-recycle state — is the one worth keeping).
 */
function snapshotListsNow(vaultPath: string): void {
  try {
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    const dest = path.join(dataDir, "backups", `${new Date().toISOString().slice(0, 10)}-recycle-v2`);
    fs.mkdirSync(dest, { recursive: true });
    const src = path.join(vaultPath, "lists", "now");
    if (!fs.existsSync(src)) return;
    for (const name of fs.readdirSync(src)) {
      if (!name.endsWith(".md")) continue;
      try {
        fs.copyFileSync(path.join(src, name), path.join(dest, name), fs.constants.COPYFILE_EXCL);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
    console.log(`[bridge/recycle] snapshot of lists/now/ written to ${dest}`);
  } catch (err) {
    console.warn("[bridge/recycle] lists/now snapshot failed (continuing):", err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { carry, newWeek, notes, accomplishments, carryUnlisted } = await request.json();

    if (!Array.isArray(carry) || typeof newWeek !== "string") {
      return NextResponse.json(
        { error: "carry must be an array and newWeek must be a string" },
        { status: 400 }
      );
    }

    // Read current weekly file
    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    // Rerun guard: recycling into an existing week is destructive (the rerun would treat the
    // NEW list as current — v1/v2 checkbox-regex asymmetry then mints garbage files and drops
    // lines; adversarial finding, 2026-07-07). One recycle per week; retry only after the
    // target write genuinely failed (in which case the file doesn't exist).
    if (files.includes(`${newWeek}.md`)) {
      return NextResponse.json(
        { error: `Week ${newWeek} already exists — it was already recycled` },
        { status: 409 },
      );
    }

    const currentFilename = mdFiles[0];
    const currentContent = await readVaultFile(`lists/now/${currentFilename}`);
    const parsed = parseWeeklyFile(currentContent, currentFilename);
    const vaultPath = await getVaultPath();

    // Snapshot BEFORE any write (outgoing accomplishments, task files, new list).
    snapshotListsNow(vaultPath);

    // Read template
    let template: string;
    try {
      template = await readVaultFile("meta/templates/weekly-list.md");
    } catch {
      // Fallback template
      template = `---\ntype: weekly-list\nweek: {{date:YYYY-MM-DD}}\n---\n\n# Week of {{date:YYYY-MM-DD}}\n\n## Notes\n\n## Tasks\n`;
    }

    // Interpolate date, then stamp the new list as v2 (post-interpolation — never a template anchor)
    const newContent = injectListFormat2(template.replace(/\{\{date:YYYY-MM-DD\}\}/g, newWeek));

    // Convert carried tasks: task files (accepted-me, origin = the outgoing list) + v2 lines;
    // unresolvable content carries verbatim.
    const carrySet = new Set<string>(carry);
    // Retry-after-partial-failure guard (adversarial finding, 2026-07-07): if a previous
    // attempt minted task files but died before the new-list write, a retry re-mints the whole
    // carried set — a full duplicate task store. Reuse an existing accepted-me file minted
    // from THIS outgoing list with the same title instead of creating another.
    const originList = `lists/now/${currentFilename}`;
    const priorMints = new Map<string, TaskFile>();
    for (const t of listTasks(vaultPath)) {
      if (t.status === "accepted-me" && t.origin?.list === originList && !priorMints.has(t.title)) {
        priorMints.set(t.title, t);
      }
    }
    const carried = buildV2CarrySection(
      currentContent,
      parsed.tasks,
      carrySet,
      (input) =>
        priorMints.get(input.title) ??
        createTask(vaultPath, {
          ...input,
          status: "accepted-me",
          origin: { list: originList },
        }),
      (taskPath) => {
        // Vault-relative only — absolute paths and ".." never resolve (hydrate.ts contract).
        if (path.isAbsolute(taskPath) || taskPath.split(/[\\/]/).includes("..")) return null;
        try {
          return parseTaskFile(fs.readFileSync(path.join(vaultPath, taskPath), "utf-8"));
        } catch {
          return null;
        }
      },
    );

    // Orphan sweep: carryUnlisted holds task FILE ids the client found active-but-unlisted.
    // Server-side validation is defense-in-depth (the client computed the same set); every
    // valid orphan is a RELINK — its line renders from the existing file, nothing is minted.
    // Invalid/stale ids skip with a warn and are reported; they never fail the recycle.
    const unlistedMeLines: string[] = [];
    const unlistedAgentLines: string[] = [];
    const skippedUnlisted: { id: string; reason: string }[] = [];
    if (Array.isArray(carryUnlisted)) {
      const seen = new Set<string>();
      for (const raw of carryUnlisted) {
        const id = typeof raw === "string" ? raw : String(raw);
        const skip = (reason: string) => {
          console.warn(`[bridge/recycle] skipping unlisted carry ${JSON.stringify(id).slice(0, 80)}: ${reason}`);
          skippedUnlisted.push({ id: id.slice(0, 80), reason });
        };
        if (!isValidTaskId(id)) {
          // Ids arrive from the request body — a permissive id is a path-traversal vector.
          skip("invalid task id");
          continue;
        }
        if (seen.has(id)) continue; // duplicate within the request — first occurrence wins
        seen.add(id);
        const task = readTask(vaultPath, id); // tasks/ only — .proposals/ files never orphan
        if (!task) {
          skip("no task file in tasks/");
          continue;
        }
        if (!ACTIVE_ORPHAN_STATUSES.has(task.status)) {
          skip(`status "${task.status}" is not active`);
          continue;
        }
        const link = `](tasks/${id}.md)`;
        if (currentContent.includes(link)) {
          skip("already linked in the outgoing list — not an orphan");
          continue;
        }
        if (carried.lines.some((l) => l.includes(link))) {
          // e.g. the retry path just relinked a prior mint of this same file.
          skip("already carried by the normal carry set");
          continue;
        }
        const line = renderWeeklyV2Line(task, `tasks/${id}.md`);
        if (task.status === "accepted-agent") unlistedAgentLines.push(line);
        else unlistedMeLines.push(line);
      }
    }

    let finalContent = newContent;
    // Orphaned me/in-progress tasks land in the TOP-LEVEL region of the carried block —
    // BEFORE the first `###` group heading. Appending after the whole block absorbed them
    // into the trailing carried group, worst case `### Ready for agents` (a me-task presented
    // as agent work; adversarial finding, 2026-07-07).
    const firstGroupIdx = carried.lines.findIndex((l) => l.startsWith("### "));
    const tasksBlock = firstGroupIdx === -1
      ? [...carried.lines, ...unlistedMeLines]
      : [...carried.lines.slice(0, firstGroupIdx), ...unlistedMeLines, ...carried.lines.slice(firstGroupIdx)];
    if (tasksBlock.length > 0) {
      const block = tasksBlock.join("\n") + "\n";
      // Do NOT trust the template to provide the anchor — append the section when missing.
      finalContent = finalContent.includes("## Tasks\n")
        ? finalContent.replace("## Tasks\n", "## Tasks\n" + block)
        : finalContent.trimEnd() + "\n\n## Tasks\n" + block;
    }

    // Agent orphans get the same home the verdict mirror gives accepted-agent tasks: the
    // "Ready for agents" section, created at the bottom of the Tasks region when missing.
    // Each insert splices at the section top, so reverse iteration preserves request order.
    for (const line of [...unlistedAgentLines].reverse()) {
      finalContent = insertWeeklyV2LineInSection(finalContent, line, AGENT_SECTION_HEADING);
    }

    // Insert carried notes if provided
    if (typeof notes === "string" && notes.trim()) {
      finalContent = finalContent.includes("## Notes\n")
        ? finalContent.replace("## Notes\n", "## Notes\n" + notes.trim() + "\n")
        : finalContent.trimEnd() + "\n\n## Notes\n" + notes.trim() + "\n";
    }

    // Save accomplishments to the outgoing (current) week file
    if (typeof accomplishments === "string" && accomplishments.trim()) {
      const updatedCurrent = updateAccomplishments(currentContent, accomplishments.trim());
      await writeVaultFileAtomic(`lists/now/${currentFilename}`, updatedCurrent);
    }

    const newFilename = `${newWeek}.md`;
    await writeVaultFileAtomic(`lists/now/${newFilename}`, finalContent);

    return NextResponse.json({
      filename: newFilename,
      listFormat: 2,
      tasksCreated: carried.created,
      tasksRelinked: carried.relinked,
      verbatimLines: carried.verbatim,
      carriedUnlisted: unlistedMeLines.length + unlistedAgentLines.length,
      skippedUnlisted,
    });
  } catch (err) {
    console.error("[bridge/recycle] Error:", err);
    return NextResponse.json({ error: "Failed to create new week" }, { status: 500 });
  }
}
