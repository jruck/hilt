import { execFile } from "child_process";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { parseBriefingId } from "@/lib/bridge/briefing-files";
import { getVaultPath } from "@/lib/bridge/vault";
import {
  getBriefingFailureForDate,
  getEasternDate,
} from "@/lib/bridge/briefing-status";

const execFileAsync = promisify(execFile);

interface GeneratorApiResult {
  status: "ok" | "invalid" | "rate_limited";
  validation?: unknown;
}

function parseGeneratorResult(stdout: string): GeneratorApiResult | null {
  const trimmed = stdout.trim();
  for (let i = trimmed.lastIndexOf("{"); i >= 0; i = trimmed.lastIndexOf("{", i - 1)) {
    try {
      const parsed = JSON.parse(trimmed.slice(i)) as { status?: unknown; validation?: unknown };
      if (parsed.status === "ok" || parsed.status === "invalid" || parsed.status === "rate_limited") {
        return {
          status: parsed.status,
          ...(parsed.validation ? { validation: parsed.validation } : {}),
        };
      }
    } catch {
      // Keep walking backward until the root JSON object at the stdout tail is found.
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    let date = getEasternDate();
    try {
      const body = await request.json();
      if (typeof body?.id === "string") {
        const parsed = parseBriefingId(body.id);
        if (!parsed || parsed.kind !== "daily") {
          return NextResponse.json({ error: "Only daily briefing failures can be retried here" }, { status: 400 });
        }
        date = parsed.date;
      }
      if (typeof body?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
        date = body.date;
      }
    } catch {
      // Empty body is fine; retry today's failed briefing by default.
    }

    const vaultPath = await getVaultPath();
    const failure = await getBriefingFailureForDate(date, { vaultPath });
    if (!failure) {
      return NextResponse.json({ error: "No failed briefing run found for this date" }, { status: 404 });
    }

    const repoRoot = process.env.BRIEFING_HILT_REPO_PATH || process.cwd();
    const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
    const args = ["scripts/briefing-generate.ts", "--mode", "daily", "--date", date];
    let stdout = "";
    try {
      const result = await execFileAsync(tsxBin, args, {
        cwd: repoRoot,
        env: { ...process.env, DATA_DIR: process.env.DATA_DIR || path.join(repoRoot, "data") },
        timeout: 10 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 16,
      });
      stdout = result.stdout;
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      stdout = e.stdout || "";
      const parsed = parseGeneratorResult(stdout);
      if (parsed) return NextResponse.json(parsed);
      console.error("Briefing retry generator failed:", e.stderr || e.message || error);
      return NextResponse.json({ error: "Briefing generator failed" }, { status: 500 });
    }

    const parsed = parseGeneratorResult(stdout);
    if (!parsed) {
      return NextResponse.json({ error: "Briefing generator returned no status" }, { status: 500 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    console.error("Failed to retry briefing:", err);
    return NextResponse.json({ error: "Failed to run briefing retry" }, { status: 500 });
  }
}
