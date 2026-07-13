import { NextResponse } from "next/server";
import type { Verdict } from "@/lib/loops/types";
import { approveProposal, dismissProposal, readProposal, reviseProposal } from "@/lib/tasks/proposals";
import { isValidTaskId } from "@/lib/tasks/store";
import { AGENT_SECTION_HEADING, mirrorAcceptedTaskIntoWeekly } from "@/lib/tasks/weekly-mirror";
import { errorMessage, isRecord, taskBaseDir } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERDICTS = new Set<Verdict>(["approve", "assign_to_me", "assign_to_agent", "dismiss", "revise"]);

/** Proposal lifecycle for task-native origins such as feedback threads. Loop-origin proposals
 * keep using `/api/loops/verdicts` because that route also updates the loop's decision audit. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidTaskId(id)) return NextResponse.json({ error: `invalid task id: ${id.slice(0, 80)}` }, { status: 400 });
    const input: unknown = await request.json().catch(() => null);
    if (!isRecord(input) || typeof input.verdict !== "string" || !VERDICTS.has(input.verdict as Verdict)) {
      return NextResponse.json({ error: "verdict must be approve, assign_to_me, assign_to_agent, dismiss, or revise" }, { status: 400 });
    }
    const verdict = input.verdict as Verdict;
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (verdict === "revise" && !note) return NextResponse.json({ error: "note is required for revise" }, { status: 400 });

    const vaultPath = await taskBaseDir();
    const proposal = readProposal(vaultPath, id);
    if (!proposal) return NextResponse.json({ error: `proposal not found: ${id}` }, { status: 404 });
    if (proposal.origin?.loop && proposal.origin.item_id) {
      return NextResponse.json({ error: "loop proposal decisions must use the loop verdict route" }, { status: 409 });
    }

    if (verdict === "revise") {
      return NextResponse.json({ task: reviseProposal(vaultPath, id, note), store: "proposals", verdict });
    }
    if (note) reviseProposal(vaultPath, id, `Decision note: ${note}`);
    if (verdict === "dismiss") {
      dismissProposal(vaultPath, id);
      return NextResponse.json({ id, verdict, dismissed: true });
    }

    const status = verdict === "assign_to_agent" ? "accepted-agent" : "accepted-me";
    const accepted = approveProposal(vaultPath, id, { status, via: `proposal-verdict:${verdict}` });
    mirrorAcceptedTaskIntoWeekly(vaultPath, accepted, verdict === "assign_to_agent"
      ? { section: AGENT_SECTION_HEADING, mark: true }
      : { mark: true });
    return NextResponse.json({ task: accepted, store: "tasks", verdict });
  } catch (error) {
    console.error("[tasks/[id]/verdict] error:", error);
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
