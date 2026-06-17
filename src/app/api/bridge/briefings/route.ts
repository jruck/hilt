import { NextResponse } from "next/server";
import { listBriefingSummaries, makeDailyBriefingId } from "@/lib/bridge/briefing-files";
import { getVaultPath } from "@/lib/bridge/vault";
import {
  getEasternDate,
  getHermesBriefingFailureForDate,
} from "@/lib/bridge/briefing-status";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const briefings = await listBriefingSummaries(vaultPath);

    const today = getEasternDate();
    const hasTodayBriefing = briefings.some((briefing) => briefing.kind === "daily" && briefing.date === today);
    if (!hasTodayBriefing) {
      const failure = await getHermesBriefingFailureForDate(today);
      if (failure) {
        briefings.unshift({
          id: makeDailyBriefingId(today),
          kind: "daily",
          date: today,
          title: `Morning Briefing — ${today}`,
          summary: `Generation failed: ${failure.error}`,
          status: failure.status,
          run: failure,
        });
      }
    }

    return NextResponse.json(briefings);
  } catch (err) {
    console.error("Failed to list briefings:", err);
    return NextResponse.json({ error: "Failed to list briefings" }, { status: 500 });
  }
}
