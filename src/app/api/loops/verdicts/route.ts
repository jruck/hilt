import { NextRequest, NextResponse } from "next/server";
import { appendVerdict } from "@/lib/loops/stores";
import type { Verdict, VerdictRecord } from "@/lib/loops/types";
import { approveProposal, dismissProposal, listProposals, reviseProposal } from "@/lib/tasks/proposals";
import { listTasks, transitionTask } from "@/lib/tasks/store";
import { canTransition } from "@/lib/tasks/status";
import { AGENT_SECTION_HEADING, mirrorAcceptedTaskIntoWeekly } from "@/lib/tasks/weekly-mirror";
import {
  errorMessage,
  findEnabledLoop,
  isRecord,
  loadLoopRegistryContext,
  loopStoreHome,
  makeRecordId,
} from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERDICTS = new Set<Verdict>([
  "approve",
  "dismiss",
  "assign_to_me",
  "assign_to_agent",
  "revise",
]);

function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && VERDICTS.has(value as Verdict);
}

/** Outcome of the synchronous proposal-file effect (v3 unit A6).
 * "missing" = no proposal file exists for this item — normal for pre-A6 items and for loops
 * whose proposal sink is not the vault (shadow sinks live outside `tasks/.proposals/`). */
export type VerdictFileEffect = "applied" | "already-applied" | "missing";

/**
 * Apply the verdict's FILE effect against the vault proposal sink (`tasks/.proposals/`),
 * synchronously — approve must visibly produce the task NOW, not at the loop's next run.
 * The join is the proposal's `origin.item_id` (the ledger id IS the verdict item id), so no
 * client change is needed. Single-writer map: this route owns the proposal FILE lifecycle;
 * the loop's async verdict-apply pass owns the LEDGER (and never re-mints a stamped entry),
 * so the two can't fight. Idempotent: a repeat verdict finds the file already moved/deleted
 * and reports "already-applied" via the accepted-task probe.
 */
function applyProposalFileEffect(
  vaultPath: string,
  loopId: string,
  itemId: string,
  verdict: Verdict,
  note: string | undefined,
): VerdictFileEffect {
  const proposal = listProposals(vaultPath).find(
    (task) => task.origin?.item_id === itemId && task.origin?.loop === loopId,
  );
  if (!proposal) {
    // A prior approve/assign moved the file into tasks/ — the repeat/contradictory-verdict
    // case. (A prior dismiss deleted the file entirely; indistinguishable from never-minted,
    // so it reports "missing" — the ledger remembers either way.)
    const accepted = listTasks(vaultPath).find(
      (task) => task.origin?.item_id === itemId && task.origin?.loop === loopId,
    );
    if (!accepted) return "missing";
    // Latest decision wins (deciding-is-the-only-exit works both ways): a dismiss after an
    // earlier approve DROPS the accepted task — otherwise the loop's ledger pass records
    // dropped while the file stays accepted, a permanent divergence (adversarial finding).
    if (verdict === "dismiss" && accepted.status !== "dropped" && canTransition(accepted.status, "dropped")) {
      transitionTask(vaultPath, accepted.id, "dropped", "verdict:dismiss");
      return "applied";
    }
    // Repeat verdicts re-run the weekly mirror: the already-linked check makes it a no-op
    // normally, and a first-attempt mirror failure self-heals here. Only status-matching tasks
    // mirror (a dropped file must not get a line; an accepted-agent file only mirrors into the
    // agent section, and vice versa). Deliberately NO markTaskFileNew here: a repeat verdict
    // must not re-mark a task whose 🆕 was already stripped by viewing (the read receipt).
    if (
      (verdict === "approve" || verdict === "assign_to_me") &&
      (accepted.status === "accepted-me" || accepted.status === "in-progress")
    ) {
      mirrorAcceptedTaskIntoWeekly(vaultPath, accepted); // self-heal: mark stays off
    } else if (verdict === "assign_to_agent" && accepted.status === "accepted-agent") {
      mirrorAcceptedTaskIntoWeekly(vaultPath, accepted, { section: AGENT_SECTION_HEADING });
    }
    return "already-applied";
  }
  try {
    if (verdict === "approve" || verdict === "assign_to_me") {
      const approved = approveProposal(vaultPath, proposal.id, { status: "accepted-me", via: `verdict:${verdict}` });
      // The mirror marks 🆕 itself (only when a v2 line will exist to carry + strip it) and
      // renders the line from the marked task — file and list agree, amber accent survives.
      mirrorAcceptedTaskIntoWeekly(vaultPath, approved, { mark: true });
    } else if (verdict === "assign_to_agent") {
      const approved = approveProposal(vaultPath, proposal.id, { status: "accepted-agent", via: "verdict:assign_to_agent" });
      // Agent tasks get a home: same 🆕 convention, but the line joins the week's
      // "Ready for agents" section instead of the top of Tasks.
      mirrorAcceptedTaskIntoWeekly(vaultPath, approved, { section: AGENT_SECTION_HEADING, mark: true });
    } else if (verdict === "dismiss") {
      // false = the file vanished between the list and the unlink — someone already applied it.
      if (!dismissProposal(vaultPath, proposal.id)) return "already-applied";
    } else {
      // revise: note is request-validated as required; the file stays proposed, in place.
      reviseProposal(vaultPath, proposal.id, note ?? "");
    }
    return "applied";
  } catch (error) {
    // approveProposal's prechecks throw on exactly the already-applied races (dest exists /
    // src gone). Treat them as such rather than failing a request whose verdict IS recorded.
    const message = errorMessage(error);
    if (/already exists|not found/.test(message)) return "already-applied";
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const loopId = typeof body.loop === "string" ? body.loop.trim() : "";
    const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
    const verdict = body.verdict;
    const note = typeof body.note === "string" ? body.note.trim() : undefined;

    if (!loopId) return NextResponse.json({ error: "loop is required" }, { status: 400 });
    if (!itemId) return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    if (!isVerdict(verdict)) {
      return NextResponse.json(
        { error: "verdict must be one of approve, dismiss, assign_to_me, assign_to_agent, revise" },
        { status: 400 },
      );
    }
    if (verdict === "revise" && !note) {
      return NextResponse.json({ error: "note is required for revise" }, { status: 400 });
    }

    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) {
      return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    }

    const loop = findEnabledLoop(registry, loopId);
    if (!loop) {
      return NextResponse.json({ error: "Enabled loop not found" }, { status: 404 });
    }

    const record: VerdictRecord = {
      id: makeRecordId("v"),
      author: "justin",
      created_at: new Date().toISOString(),
      loop: loopId,
      item_id: itemId,
      verdict,
      ...(note ? { note } : {}),
    };
    // The jsonl append is the unchanged audit trail + the loop's ledger-effect queue; the file
    // effect below is ADDITIVE. Order matters: record first, so a file-effect crash never loses
    // the decision (the loop's next run still applies the ledger effect).
    appendVerdict(loopStoreHome(vaultPath, loop), record);

    let fileEffect: VerdictFileEffect = "missing";
    try {
      fileEffect = applyProposalFileEffect(vaultPath, loopId, itemId, verdict, note);
    } catch (effectError) {
      // The verdict IS recorded — degrade to "missing" (no visible file change) and log,
      // rather than answering 500 for a decision that will still land via the ledger.
      console.error("[loops/verdicts] proposal file effect failed:", effectError);
    }

    return NextResponse.json({ ...record, file_effect: fileEffect }, { status: 201 });
  } catch (error) {
    console.error("[loops/verdicts] append failed:", error);
    return NextResponse.json({ error: "Failed to append verdict", detail: errorMessage(error) }, { status: 500 });
  }
}
