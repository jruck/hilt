import { spawn } from "child_process";
import { NextResponse } from "next/server";
import {
  getEasternDate,
  getHermesBriefingFailureForDate,
  resolveHermesBinary,
} from "@/lib/bridge/briefing-status";

export async function POST(request: Request) {
  try {
    let date = getEasternDate();
    try {
      const body = await request.json();
      if (typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        date = body.date;
      }
    } catch {
      // Empty body is fine; retry today's failed briefing by default.
    }

    const failure = await getHermesBriefingFailureForDate(date);
    if (!failure) {
      return NextResponse.json({ error: "No failed briefing run found for this date" }, { status: 404 });
    }

    const hermesBin = resolveHermesBinary();
    if (!hermesBin) {
      return NextResponse.json({ error: "Hermes binary not found" }, { status: 500 });
    }

    const child = spawn(hermesBin, ["cron", "run", "--accept-hooks", failure.jobId], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();

    return NextResponse.json({
      ok: true,
      status: "queued",
      date,
      jobId: failure.jobId,
      message: "Retry queued for the next Hermes scheduler tick.",
    });
  } catch (err) {
    console.error("Failed to retry briefing:", err);
    return NextResponse.json({ error: "Failed to queue briefing retry" }, { status: 500 });
  }
}
