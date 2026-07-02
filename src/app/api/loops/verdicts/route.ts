import { NextRequest, NextResponse } from "next/server";
import { appendVerdict } from "@/lib/loops/stores";
import type { Verdict, VerdictRecord } from "@/lib/loops/types";
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
    appendVerdict(loopStoreHome(vaultPath, loop), record);

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("[loops/verdicts] append failed:", error);
    return NextResponse.json({ error: "Failed to append verdict", detail: errorMessage(error) }, { status: 500 });
  }
}
