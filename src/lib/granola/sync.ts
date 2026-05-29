import * as fs from "fs";
import * as path from "path";
import { touchCalendarChanged } from "../calendar/notify";
import {
  getGranolaCompareOutputDir,
  getGranolaDaemonStatePath,
  getGranolaDefaultDaysBack,
  getGranolaRemoteHost,
  granolaDaemonEnabled,
  getGranolaVaultPath,
} from "./config";
import { compareMarkdownPair, writeGranolaCompareReport } from "./compare";
import { findHiltCalendarMatch } from "./calendar-links";
import {
  getGranolaSyncDbStatus,
  getLastGranolaSeenAt,
  recordGranolaSyncRun,
  upsertGranolaDocument,
} from "./db";
import { assertObsidianGranolaSyncDisabled, getObsidianHandoffStatus } from "./handoff";
import {
  buildNoteMarkdown,
  buildTranscriptMarkdown,
  calendarAugmentationFields,
  computeMeetingPaths,
  copyCandidateMarkdown,
  discoverExistingMeetingFiles,
  writeAugmentedMarkdown,
  writeMarkdownIfChanged,
} from "./markdown";
import { fetchGranolaDocumentsFromRemote } from "./remote";
import type { GranolaSyncRunInput, GranolaSyncRunReport, GranolaSyncStatus } from "./types";

let activeRun: Promise<GranolaSyncRunReport> | null = null;

export async function getGranolaSyncStatus(): Promise<GranolaSyncStatus> {
  const handoff = await getObsidianHandoffStatus();
  return getGranolaSyncDbStatus({
    configured: true,
    daemonEnabled: granolaDaemonEnabled() || hasActiveDaemonHeartbeat(),
    remoteHost: getGranolaRemoteHost(),
    handoff,
  });
}

export async function runGranolaSync(input: GranolaSyncRunInput): Promise<GranolaSyncRunReport> {
  if (activeRun) return activeRun;
  activeRun = runGranolaSyncInner(input).finally(() => {
    activeRun = null;
  });
  return activeRun;
}

async function runGranolaSyncInner(input: GranolaSyncRunInput): Promise<GranolaSyncRunReport> {
  const startedAt = new Date().toISOString();
  const dryRun = input.dryRun ?? input.mode === "compare";
  const report: GranolaSyncRunReport = {
    mode: input.mode,
    dryRun,
    startedAt,
    finishedAt: startedAt,
    fetched: 0,
    considered: 0,
    createdNotes: 0,
    createdTranscripts: 0,
    augmentedNotes: 0,
    augmentedTranscripts: 0,
    skipped: 0,
    linkedCalendarEvents: 0,
    blocked: false,
    errors: [],
    compareReportPath: null,
  };

  try {
    if (!dryRun && !input.skipHandoffCheck) {
      await assertObsidianGranolaSyncDisabled();
    }

    const vaultPath = getGranolaVaultPath();
    const existing = discoverExistingMeetingFiles(vaultPath);
    const docs = await fetchGranolaDocumentsFromRemote({
      daysBack: input.mode === "backfill" || input.mode === "augment-existing" ? input.daysBack ?? 0 : input.daysBack ?? incrementalDaysBack(),
      limit: input.limit,
      includeTranscripts: input.includeTranscripts !== false,
    });
    report.fetched = docs.length;

    if (input.mode === "compare") {
      const outputDir = input.outputDir || getGranolaCompareOutputDir();
      const compareItems = [];
      for (const doc of docs) {
        const match = findHiltCalendarMatch(doc);
        const paths = computeMeetingPaths(vaultPath, doc);
        const noteMarkdown = buildNoteMarkdown(doc, paths, match);
        if (!noteMarkdown) {
          report.skipped++;
          continue;
        }
        report.considered++;
        const candidatePath = copyCandidateMarkdown(outputDir, paths.noteRelativePath, noteMarkdown);
        compareItems.push(compareMarkdownPair({
          granolaId: doc.id,
          title: doc.title,
          existingPath: existing.notesByGranolaId.get(doc.id) ?? null,
          candidatePath,
          candidateContent: noteMarkdown,
        }));
        const transcriptMarkdown = buildTranscriptMarkdown(doc, paths, match);
        if (transcriptMarkdown) {
          const transcriptCandidatePath = copyCandidateMarkdown(outputDir, paths.transcriptRelativePath, transcriptMarkdown);
          compareItems.push(compareMarkdownPair({
            granolaId: doc.id,
            title: `${doc.title} - Transcript`,
            existingPath: existing.transcriptsByGranolaId.get(doc.id) ?? null,
            candidatePath: transcriptCandidatePath,
            candidateContent: transcriptMarkdown,
          }));
        }
      }
      const compareReport = writeGranolaCompareReport({ outputDir, docs, items: compareItems });
      report.compareReportPath = compareReport.markdownPath;
      report.finishedAt = new Date().toISOString();
      recordGranolaSyncRun(report);
      return report;
    }

    for (const doc of docs) {
      report.considered++;
      const match = findHiltCalendarMatch(doc);
      if (match.hiltCalendarEventId) report.linkedCalendarEvents++;
      const computedPaths = computeMeetingPaths(vaultPath, doc);
      const notePath = existing.notesByGranolaId.get(doc.id) ?? computedPaths.notePath;
      const transcriptPath = existing.transcriptsByGranolaId.get(doc.id) ?? computedPaths.transcriptPath;
      const noteRelativePath = path.relative(vaultPath, notePath);
      const transcriptRelativePath = path.relative(vaultPath, transcriptPath);
      const paths = { ...computedPaths, notePath, transcriptPath, noteRelativePath, transcriptRelativePath };
      const fields = calendarAugmentationFields(doc, match);

      const existingNote = fs.existsSync(notePath);
      const existingTranscript = fs.existsSync(transcriptPath);
      const shouldCreate = input.mode === "incremental" || input.mode === "backfill";
      const shouldAugment = input.mode === "augment-existing" || input.mode === "incremental" || input.mode === "backfill";

      if (existingNote && shouldAugment) {
        if (writeAugmentedMarkdown(notePath, { ...fields, transcript: doc.transcript.length ? `[[${transcriptRelativePath}]]` : undefined }, dryRun)) report.augmentedNotes++;
      } else if (!existingNote && shouldCreate) {
        const noteMarkdown = buildNoteMarkdown(doc, paths, match);
        if (noteMarkdown && writeMarkdownIfChanged(notePath, noteMarkdown, dryRun)) report.createdNotes++;
        else report.skipped++;
      } else {
        report.skipped++;
      }

      if (doc.transcript.length) {
        if (existingTranscript && shouldAugment) {
          if (writeAugmentedMarkdown(transcriptPath, { ...fields, note: `[[${noteRelativePath}]]` }, dryRun)) report.augmentedTranscripts++;
        } else if (!existingTranscript && shouldCreate) {
          const transcriptMarkdown = buildTranscriptMarkdown(doc, paths, match);
          if (transcriptMarkdown && writeMarkdownIfChanged(transcriptPath, transcriptMarkdown, dryRun)) report.createdTranscripts++;
        }
      }

      if (!dryRun) {
        const noteAvailable = fs.existsSync(notePath);
        const transcriptAvailable = fs.existsSync(transcriptPath);
        upsertGranolaDocument({
          doc,
          notePath: noteAvailable ? notePath : null,
          transcriptPath: transcriptAvailable ? transcriptPath : null,
          calendarMatch: match,
          syncedAt: new Date().toISOString(),
        });
      }
    }

    if (!dryRun && report.linkedCalendarEvents > 0) {
      touchCalendarChanged({ kind: "granola-sync" });
    }
    report.finishedAt = new Date().toISOString();
    recordGranolaSyncRun(report);
    return report;
  } catch (error) {
    report.finishedAt = new Date().toISOString();
    report.errors.push(error instanceof Error ? error.message : String(error));
    report.blocked = report.errors.some((message) => message.includes("Obsidian Granola Sync"));
    recordGranolaSyncRun(report, report.blocked ? "blocked" : "error");
    return report;
  }
}

function incrementalDaysBack(): number {
  const lastSeenAt = getLastGranolaSeenAt();
  if (!lastSeenAt) return getGranolaDefaultDaysBack();
  const parsed = Date.parse(lastSeenAt);
  if (!Number.isFinite(parsed)) return getGranolaDefaultDaysBack();
  const elapsedDays = Math.ceil((Date.now() - parsed) / (24 * 60 * 60 * 1000));
  return Math.max(2, elapsedDays + 2);
}

function hasActiveDaemonHeartbeat(): boolean {
  try {
    const raw = fs.readFileSync(getGranolaDaemonStatePath(), "utf-8");
    const state = JSON.parse(raw) as { enabled?: unknown; updatedAt?: unknown; pid?: unknown };
    if (state.enabled !== true || typeof state.updatedAt !== "string") return false;
    if (typeof state.pid === "number") {
      try {
        process.kill(state.pid, 0);
      } catch {
        return false;
      }
    }
    return Date.now() - Date.parse(state.updatedAt) < 5 * 60_000;
  } catch {
    return false;
  }
}
