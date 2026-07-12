import fs from "fs";
import path from "path";
import { atomicWriteFile } from "../library/utils";
import { extractTaskIds } from "./canvas";
import {
  collectBriefingDecisionQueue,
  composeBriefingDecisions,
  DECISION_CONTRACT_MARKER,
  type BriefingDecisionQueue,
} from "./decisions";
import { resolveBriefingTarget, type BriefingMode } from "./target-file";

export interface DecisionAppendResult {
  file: string;
  added: number;
}

/** Append newly-created proposal IDs without removing accepted or dismissed IDs already frozen in
 * markdown. Legacy briefings have no marker and are deliberately untouched. */
export function appendDecisionQueueMarkdown(
  markdown: string,
  mode: BriefingMode,
  queue: BriefingDecisionQueue,
): { markdown: string; added: number } {
  if (!markdown.includes(DECISION_CONTRACT_MARKER) || queue.task_ids.length === 0) {
    return { markdown, added: 0 };
  }
  const existing = new Set(extractTaskIds(markdown));
  const added = queue.task_ids.filter((id) => !existing.has(id)).length;
  if (!added) return { markdown, added: 0 };
  return { markdown: composeBriefingDecisions(markdown, mode, queue), added };
}

function currentTargets(vaultPath: string, today: string): Array<{ mode: BriefingMode; file: string }> {
  const targets: Array<{ mode: BriefingMode; file: string }> = [
    { mode: "daily", file: resolveBriefingTarget(vaultPath, "daily", today).absPath },
  ];
  const day = new Date(`${today}T12:00:00.000Z`).getUTCDay();
  if (day === 0 || day === 6) {
    targets.push({ mode: "weekend", file: resolveBriefingTarget(vaultPath, "weekend", today).absPath });
  }
  return targets;
}

export function appendActiveBriefingDecisions(vaultPath: string, today: string): DecisionAppendResult[] {
  const queue = collectBriefingDecisionQueue(vaultPath, today);
  const results: DecisionAppendResult[] = [];
  for (const target of currentTargets(vaultPath, today)) {
    if (!fs.existsSync(target.file)) continue;
    const raw = fs.readFileSync(target.file, "utf-8");
    const updated = appendDecisionQueueMarkdown(raw, target.mode, queue);
    if (!updated.added || updated.markdown === raw) continue;
    atomicWriteFile(target.file, updated.markdown.endsWith("\n") ? updated.markdown : `${updated.markdown}\n`);
    results.push({ file: path.relative(vaultPath, target.file), added: updated.added });
  }
  return results;
}
