import { NextRequest, NextResponse } from "next/server";
import { extractPersonNextRaw, updatePersonNext } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";
import type { PersonCalendarCandidate } from "@/lib/types";
import * as fs from "fs";
import * as path from "path";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();

    const vaultPath = await getVaultPath();
    const filePath = path.join(vaultPath, "people", `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    let fileContent = fs.readFileSync(filePath, "utf-8");

    const preserveContent = body.preserveContent === true;
    if (!preserveContent && typeof body.content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 }
      );
    }
    const calendarCandidate = parseCalendarCandidate(body.calendarCandidate);
    const nextContent = preserveContent ? extractPersonNextRaw(fileContent) : body.content;
    fileContent = updatePersonNext(
      fileContent,
      nextContent,
      calendarCandidate === undefined
        ? { keepCalendarOnEmpty: body.keepCalendarOnEmpty === true }
        : { calendarCandidate, keepCalendarOnEmpty: body.keepCalendarOnEmpty === true },
    );

    // Atomic write
    const tmpPath = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, fileContent, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/people/slug/next] Error:", err);
    return NextResponse.json(
      { error: "Failed to update next section" },
      { status: 500 }
    );
  }
}

function parseCalendarCandidate(value: unknown): PersonCalendarCandidate | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.eventId !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.start !== "string" ||
    typeof raw.end !== "string" ||
    typeof raw.seriesKey !== "string"
  ) {
    return null;
  }
  return {
    eventId: raw.eventId,
    title: raw.title,
    start: raw.start,
    end: raw.end,
    uid: typeof raw.uid === "string" ? raw.uid : null,
    seriesKey: raw.seriesKey,
    method: raw.method === "title" ? "title" : "icaluid",
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
    historicalCount: typeof raw.historicalCount === "number" ? raw.historicalCount : 0,
    lastSeenAt: typeof raw.lastSeenAt === "string" ? raw.lastSeenAt : null,
  };
}
