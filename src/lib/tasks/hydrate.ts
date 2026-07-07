/**
 * Join a parsed v2 weekly line with its task file. Per-line degradation is the contract:
 * a missing/unreadable task file returns the raw line with `missing: true` — NEVER throws,
 * NEVER drops the line (the weekly list must render whole even when files are damaged).
 */
import fs from "fs";
import path from "path";
import { parseTaskFile } from "./task-file";
import type { HydratedWeeklyV2Line, WeeklyV2Line } from "./types";

/** Task paths are vault-relative by spec — absolute paths and ".." traversal are treated as
 * missing (raw-line degradation), never resolved (a weekly line must not read outside the vault). */
function isVaultRelative(taskPath: string): boolean {
  if (path.isAbsolute(taskPath)) return false;
  return !taskPath.split(/[\\/]/).includes("..");
}

export function hydrateWeeklyV2Line(baseDir: string, line: WeeklyV2Line): HydratedWeeklyV2Line {
  if (!line.taskPath || !isVaultRelative(line.taskPath)) return { line, missing: true };
  try {
    const filePath = path.join(baseDir, line.taskPath);
    const task = parseTaskFile(fs.readFileSync(filePath, "utf-8"));
    return { line, task, missing: false };
  } catch {
    return { line, missing: true };
  }
}

export function hydrateWeeklyV2Lines(baseDir: string, lines: WeeklyV2Line[]): HydratedWeeklyV2Line[] {
  return lines.map((line) => hydrateWeeklyV2Line(baseDir, line));
}
