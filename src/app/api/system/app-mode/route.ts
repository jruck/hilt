import { NextResponse } from "next/server";
import {
  isHeartbeatFresh,
  readSupervisorHeartbeat,
  writeAppModeIntent,
} from "../../../../../server/server-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Request a dev/prod mode switch for THIS server (supervisor protocol —
 * docs/plans/supervisor-v1.md). The route never touches processes: it
 * validates that a fresh supervisor heartbeat exists, then writes the intent
 * file the supervisor on this machine watches. Callers poll
 * GET /api/system/app-server until `mode` flips, then reload themselves
 * (a dev↔prod swap changes the client bundle).
 *
 * Deliberately reachable from the tailnet (unlike /navigate, loopback-only):
 * single-user tailnet, non-destructive, auto-reverting. See ARCHITECTURE §7.
 */
export async function POST(request: Request) {
  let mode: unknown;
  try {
    ({ mode } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (mode !== "dev" && mode !== "prod") {
    return NextResponse.json({ error: 'Invalid mode. Must be "dev" or "prod".' }, { status: 400 });
  }

  const heartbeat = readSupervisorHeartbeat();
  if (!isHeartbeatFresh(heartbeat)) {
    return NextResponse.json(
      { error: "This server has no live supervisor — the mode can only be switched where one manages it." },
      { status: 409 }
    );
  }

  writeAppModeIntent(mode, "api");
  return NextResponse.json({ ok: true, accepted: mode }, { status: 202 });
}
