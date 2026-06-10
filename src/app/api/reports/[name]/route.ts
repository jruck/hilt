import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serve rendered HTML reports from ~/.hilt/reports/<name>/index.html — the remote-viewing surface
 * for agent-generated reports (Library v2 implementation report, future steering snapshots). Rides
 * the existing Tailscale Serve mount of the Hilt dev server, so reports are tailnet-reachable at
 * https://<machine>.<tailnet>.ts.net/api/reports/<name> with no extra serve config (file mounts in
 * `tailscale serve` need root; this route doesn't). Name is allowlist-validated — never a path.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(name)) {
    return NextResponse.json({ error: "Invalid report name" }, { status: 400 });
  }
  const filePath = path.join(os.homedir(), ".hilt", "reports", name, "index.html");
  try {
    const html = fs.readFileSync(filePath, "utf-8");
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
}
