import { NextResponse } from "next/server";
import { isSafePreviewFilename } from "@/lib/local-apps/preview";
import { getLocalAppsResponse } from "@/lib/local-apps/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const REMOTE_PREVIEW_TIMEOUT_MS = 4_000;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get("machine") || "";
  const filename = url.searchParams.get("filename") || "";

  if (!machineId || !isSafePreviewFilename(filename)) {
    return NextResponse.json({ error: "Invalid remote preview request" }, { status: 400 });
  }

  const snapshot = await getLocalAppsResponse({ includePeers: true });
  if (!snapshot.enabled) {
    return NextResponse.json(snapshot, { status: 403 });
  }

  const machine = snapshot.machines?.find((candidate) => candidate.id === machineId);
  if (!machine?.source_url) {
    return NextResponse.json({ error: "Remote preview source not found" }, { status: 404 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_PREVIEW_TIMEOUT_MS);

  try {
    const remoteUrl = `${machine.source_url}/api/local-apps/previews/${encodeURIComponent(filename)}`;
    const response = await fetch(remoteUrl, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return NextResponse.json({ error: "Remote preview not found" }, { status: response.status });
    }

    return new NextResponse(Buffer.from(await response.arrayBuffer()), {
      headers: {
        "Content-Type": response.headers.get("content-type") || "image/png",
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch {
    return NextResponse.json({ error: "Remote preview fetch failed" }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
