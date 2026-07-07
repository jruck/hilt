/**
 * Task id minting: `t-YYYYMMDD-NNN`, collision-checked across BOTH `tasks/` and
 * `tasks/.proposals/` of the given base dir (an id must stay unique through the
 * approve-rename, so both locations count as taken).
 */
import fs from "fs";
import path from "path";

// Paths computed locally rather than imported from store.ts to avoid a module cycle
// (store imports mintTaskId).
function takenIds(baseDir: string): Set<string> {
  const taken = new Set<string>();
  const tasksDir = path.join(baseDir, "tasks");
  for (const dir of [tasksDir, path.join(tasksDir, ".proposals")]) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".md")) taken.add(name.slice(0, -3));
    }
  }
  return taken;
}

/** Mint the next free task id for the given date (YYYY-MM-DD or Date; defaults to today). */
export function mintTaskId(baseDir: string, date: Date | string = new Date()): string {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : date.slice(0, 10);
  const ymd = iso.replace(/-/g, "");
  const taken = takenIds(baseDir);
  let seq = 1;
  // Padding widens past 999 rather than failing (a 1000-task day is a data bug, not a crash)
  while (taken.has(`t-${ymd}-${String(seq).padStart(3, "0")}`)) seq++;
  return `t-${ymd}-${String(seq).padStart(3, "0")}`;
}
