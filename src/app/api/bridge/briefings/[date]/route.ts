import { NextRequest, NextResponse } from "next/server";
import { makeDailyBriefingId, parseBriefingId, readBriefingById } from "@/lib/bridge/briefing-files";
import { getVaultPath } from "@/lib/bridge/vault";
import { getHermesBriefingFailureForDate } from "@/lib/bridge/briefing-status";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date: rawId } = await params;
    const parsed = parseBriefingId(rawId);

    if (!parsed) {
      return NextResponse.json({ error: "Invalid briefing id" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    try {
      const briefing = await readBriefingById(vaultPath, parsed.id);
      if (briefing) return NextResponse.json(briefing);
    } catch {
      if (parsed.kind !== "daily") {
        return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
      }
      const failure = await getHermesBriefingFailureForDate(parsed.date);
      if (failure) {
        return NextResponse.json({
          id: makeDailyBriefingId(parsed.date),
          kind: "daily",
          date: parsed.date,
          title: `Morning Briefing — ${parsed.date}`,
          summary: `Generation failed: ${failure.error}`,
          content: "",
          status: failure.status,
          run: failure,
        });
      }
      return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
  } catch (err) {
    console.error("Failed to read briefing:", err);
    return NextResponse.json({ error: "Failed to read briefing" }, { status: 500 });
  }
}
