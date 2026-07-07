import { NextRequest, NextResponse } from "next/server";
import { appendFeedback } from "@/lib/loops/stores";
import type { FeedbackRecord, FeedbackTarget, LoopsRegistry, RegistryLoop } from "@/lib/loops/types";
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

function isFeedbackLevel(value: unknown): value is FeedbackTarget["level"] {
  return value === "item" || value === "section" || value === "briefing";
}

function parseAnchor(value: unknown): FeedbackTarget["anchor"] | undefined {
  if (!isRecord(value)) return undefined;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  if (!text) return undefined;
  const section = typeof value.section === "string" && value.section.trim()
    ? value.section.trim()
    : undefined;
  const citation = typeof value.citation === "string" && value.citation.trim()
    ? value.citation.trim()
    : undefined;
  return { ...(section ? { section } : {}), ...(citation ? { citation } : {}), text };
}

function findFeedbackLoop(
  registry: LoopsRegistry,
  loopId: string,
  level: FeedbackTarget["level"],
): RegistryLoop | null {
  const enabledLoop = findEnabledLoop(registry, loopId);
  if (enabledLoop) return enabledLoop;

  // The briefing loop is registry-present but not yet an enabled generator loop; its feedback
  // stream (every level — item, section, whole-briefing) is PERMANENT load-bearing wiring for
  // the single-briefing UI's Feedback button and per-item comments. Do not remove as cruft.
  void level;
  if (loopId === "briefing") {
    return registry.loops.find((loop) => loop.id === loopId && !loop.enabled) ?? null;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const loopId = typeof body.loop === "string" ? body.loop.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const targetBody = isRecord(body.target) ? body.target : null;
    const level = targetBody ? targetBody.level : undefined;

    if (!loopId) return NextResponse.json({ error: "loop is required" }, { status: 400 });
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });
    if (!targetBody || !isFeedbackLevel(level)) {
      return NextResponse.json({ error: "target.level must be one of item, section, briefing" }, { status: 400 });
    }

    const artifactDate = typeof targetBody.artifact_date === "string" && targetBody.artifact_date.trim()
      ? targetBody.artifact_date.trim()
      : undefined;
    const itemId = typeof targetBody.item_id === "string" && targetBody.item_id.trim()
      ? targetBody.item_id.trim()
      : undefined;
    const anchor = parseAnchor(targetBody.anchor);

    if (level === "item" && Boolean(itemId) === Boolean(anchor)) {
      return NextResponse.json({ error: "item feedback requires exactly one of item_id or anchor" }, { status: 400 });
    }
    if (level !== "item" && (itemId || anchor)) {
      return NextResponse.json({ error: "section and briefing feedback must omit item_id and anchor" }, { status: 400 });
    }

    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) {
      return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    }

    const loop = findFeedbackLoop(registry, loopId, level);
    if (!loop) {
      return NextResponse.json({ error: "Enabled loop not found" }, { status: 404 });
    }

    const target: FeedbackTarget = {
      loop: loopId,
      level,
      ...(artifactDate ? { artifact_date: artifactDate } : {}),
      ...(itemId ? { item_id: itemId } : {}),
      ...(anchor ? { anchor } : {}),
    };
    const record: FeedbackRecord = {
      id: makeRecordId("fb"),
      author: "justin",
      created_at: new Date().toISOString(),
      target,
      text,
    };
    appendFeedback(loopStoreHome(vaultPath, loop), record);

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error("[loops/feedback] append failed:", error);
    return NextResponse.json({ error: "Failed to append feedback", detail: errorMessage(error) }, { status: 500 });
  }
}
