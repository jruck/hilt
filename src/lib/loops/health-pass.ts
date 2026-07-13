/**
 * Thread health pass contract: consume pending loop-feedback messages once as calibration guidance,
 * record an outcome without closing the conversation, and return a compact markdown-ready summary.
 */
import { commentTargetToFeedback } from "../threads/feedback-bridge";
import {
  appendToThread,
  listThreads,
  markMessagesHandled,
  pendingThreadMessages,
  recordThreadOutcome,
} from "../threads/store";
import type { Thread } from "../threads/types";
import { loopIdsForHome } from "./stores";

export interface HealthPassSummary {
  consumed: number;
  threads: string[];
  titles: string[];
}

function snippetForThread(thread: Thread): string {
  const message = thread.messages.find((candidate) => (
    candidate.author === "justin" || candidate.author === "claude-sim"
  )) ?? thread.messages[0];
  return (message?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

/** Pending messages after the latest agent reply are a new volley. Older un-stamped messages
 * already followed by an agent response are legacy ambiguity and must not be answered twice. */
function actionablePendingMessages(thread: Thread) {
  const pending = pendingThreadMessages(thread);
  const latestAgentAt = thread.messages
    .filter((message) => message.author.startsWith("agent:"))
    .reduce<string | null>((latest, message) => !latest || message.created_at > latest ? message.created_at : latest, null);
  return latestAgentAt ? pending.filter((message) => message.created_at > latestAgentAt) : pending;
}

/** Loops whose batch run genuinely CONSUMES feedback as calibration: only meeting-actions,
 * whose Phase 0b feeds the feedback text into the next extraction prompt. For those, the pass
 * recording a reply + "calibrated" resolution reflects a real event. Runtime and goals-areas
 * have no extractor to calibrate — auto-resolving their domains' feedback as "calibrated" would
 * bury a genuine open question (e.g. "what is this about, how do we fix?") under a hollow stamp
 * without answering it. Their feedback stays OPEN for the substantive on-demand "Process now"
 * path (the chat runner actually acts on it). Judgment call, 2026-07-08 — logged for gate C. */
const CALIBRATING_LOOPS = new Set(["meeting-actions"]);

export function runThreadHealthPass(opts: {
  loopId: string;
  home: string;
  now: string;
  runAt: string;
}): HealthPassSummary {
  if (!CALIBRATING_LOOPS.has(opts.loopId)) return { consumed: 0, threads: [], titles: [] };
  const loopIds = new Set(loopIdsForHome(opts.home));
  let matches: Thread[];
  try {
    matches = listThreads().filter((thread) => {
      if (thread.status !== "open" || actionablePendingMessages(thread).length === 0) return false;
      const target = commentTargetToFeedback(thread.target);
      return target !== null && loopIds.has(target.loop);
    });
  } catch (error) {
    // Reading the thread store must not abort the run (C3-1) — a store that can't be listed
    // just means no feedback was handled this pass.
    console.error(
      `[health-pass] ${opts.loopId}: thread store unreadable (non-fatal):`,
      error instanceof Error ? error.message.slice(0, 200) : error,
    );
    return { consumed: 0, threads: [], titles: [] };
  }
  const agent = `agent:${opts.loopId}`;
  const text = `Consumed as calibration guidance for the ${opts.loopId} run ${opts.runAt.slice(0, 10)}.`;

  // A thread-store write hiccup must NEVER abort the loop run — this pass fires before the
  // artifact is emitted, and for runtime (the watchdog) / goals-areas a throw here would take
  // the whole launchd job dark for a cosmetic side-effect. Degrade per thread: a failed
  // consume is simply not counted (it stays open and rides the next run). (C3-1.)
  const consumed: Thread[] = [];
  for (const thread of matches) {
    try {
      const pendingIds = actionablePendingMessages(thread).map((message) => message.id);
      appendToThread(thread.id, { author: agent, text, created_at: opts.now });
      const outcome = recordThreadOutcome(thread.id, {
        kind: "calibrated",
        summary: text,
        at: opts.now,
        by: agent,
        message_ids: pendingIds,
      });
      markMessagesHandled(thread.id, pendingIds, { at: opts.now, by: agent, outcome_id: outcome.id });
      consumed.push(thread);
    } catch (error) {
      console.error(
        `[health-pass] ${opts.loopId}: failed to consume thread ${thread.id} (non-fatal):`,
        error instanceof Error ? error.message.slice(0, 200) : error,
      );
    }
  }

  return {
    consumed: consumed.length,
    threads: consumed.map((thread) => thread.id),
    titles: consumed.map(snippetForThread),
  };
}

export function renderFeedbackHandledSection(summary: HealthPassSummary): string {
  if (summary.consumed === 0) return "";
  return [
    "## Feedback handled",
    "",
    ...summary.titles.map((title) => `- "${title}" → calibrated`),
  ].join("\n") + "\n";
}
