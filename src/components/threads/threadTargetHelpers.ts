"use client";

import {
  BookMarked,
  Newspaper,
  Repeat,
  SquareCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { CommentTarget } from "@/lib/comments/types";
import type { ThreadOutcome } from "@/lib/threads/types";
import { libraryItemScope } from "@/lib/library/url";
import { requestTaskOpen } from "@/lib/tasks/deeplink";
import type { ViewPrefix } from "@/lib/url-utils";

type NavigateTo = (mode: ViewPrefix, scope: string) => void;

export function targetIcon(target: CommentTarget): LucideIcon {
  switch (target.kind) {
    case "task":
      return SquareCheck;
    case "loop-item":
      return Repeat;
    case "briefing":
    case "briefing-section":
    case "briefing-anchor":
      return Newspaper;
    case "library":
      return BookMarked;
    case "meeting":
      return Users;
  }
}

export function targetLabel(target: CommentTarget): string {
  switch (target.kind) {
    case "task":
      return "Task";
    case "loop-item":
      return `Loop: ${target.loop}`;
    case "briefing":
      return `Briefing · ${target.date}`;
    case "briefing-section":
      return `Briefing · ${target.date} § ${target.section}`;
    case "briefing-anchor":
      return `Briefing${target.date ? ` · ${target.date}` : ""}`;
    case "library":
      return "Library reference";
    case "meeting": {
      const basename = target.rel.split("/").pop()?.replace(/\.md$/, "") || target.rel;
      return `Meeting · ${basename}`;
    }
  }
}

export function targetOpenHandler(target: CommentTarget, navigateTo: NavigateTo): (() => void) | null {
  switch (target.kind) {
    case "task":
      return () => requestTaskOpen(target.id);
    case "library":
      return () => navigateTo("library", libraryItemScope(target.id));
    case "loop-item":
    case "briefing":
    case "briefing-section":
    case "briefing-anchor":
    case "meeting":
      return null;
  }
}

/** Structural subset shared by Thread and ThreadSummary — presentation helpers stay store-agnostic. */
interface ResolutionFields {
  status: "open" | "resolved";
  updated_at: string;
  resolution?: { action: string; at: string; by: string };
  processed?: { at: string };
}

const RESOLUTION_ACTION_LABELS: Record<string, string> = {
  calibrated: "Calibrated",
  processed: "Answered",
  "proposal-minted": "Proposal minted",
  clustered: "Clustered",
};

const OUTCOME_LABELS: Record<ThreadOutcome["kind"], string> = {
  answered: "Answered",
  changed: "Changed files",
  proposal: "Proposal created",
  "dev-item": "Dev item",
  calibrated: "Used as calibration",
  clustered: "Added to steering",
};

export function outcomeStory(outcome: ThreadOutcome): string {
  const label = OUTCOME_LABELS[outcome.kind];
  if (outcome.kind === "proposal" && outcome.proposal_task_id) return `${label} · ${outcome.proposal_task_id}`;
  if (outcome.kind === "changed" && outcome.files_touched?.length) {
    return `${label} · ${outcome.files_touched.length} ${outcome.files_touched.length === 1 ? "file" : "files"}`;
  }
  return label;
}

/** "Calibrated · meeting-actions" — HOW a resolved thread resolved, and which agent did it.
 * Unknown actions humanize (hyphens/underscores → spaces, sentence case) so new agent verbs
 * never regress to a bare "Resolved". Generic `agent:processor` adds no information — omitted. */
export function resolutionStory(thread: ResolutionFields): string {
  const resolution = thread.resolution;
  if (resolution) {
    const label = RESOLUTION_ACTION_LABELS[resolution.action]
      ?? humanizeAction(resolution.action);
    const agent = resolution.by.startsWith("agent:") ? resolution.by.slice("agent:".length) : "";
    return agent && agent !== "processor" ? `${label} · ${agent}` : label;
  }
  if (thread.processed) return "Answered";
  return "Resolved";
}

function humanizeAction(action: string): string {
  const spaced = action.replace(/[-_]+/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : "Resolved";
}

/** When the resolution landed — resolution stamp first, processed stamp, then updated_at. */
export function resolvedAt(thread: ResolutionFields): string {
  return thread.resolution?.at ?? thread.processed?.at ?? thread.updated_at;
}

const RECENT_RESOLUTION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Threads resolved within the last 24h get the house "new since you looked" blue dot. */
export function resolvedRecently(thread: ResolutionFields, now: number = Date.now()): boolean {
  if (thread.status !== "resolved") return false;
  const time = Date.parse(resolvedAt(thread));
  return Number.isFinite(time) && now - time < RECENT_RESOLUTION_WINDOW_MS;
}
