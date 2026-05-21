import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { isSafePreviewFilename } from "@/lib/local-apps/preview";
import { isLocalAppsEnabled, isPreviewCaptureEnabled, previewDir } from "@/lib/local-apps/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  if (!isSafePreviewFilename(filename)) {
    return NextResponse.json({ error: "Invalid preview filename" }, { status: 400 });
  }
  if (!isLocalAppsEnabled() || !isPreviewCaptureEnabled()) {
    return NextResponse.json({ error: "Local Apps previews are disabled" }, { status: 403 });
  }

  try {
    const bytes = await fs.readFile(path.join(previewDir(), filename));
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch {
    return NextResponse.json({ error: "Preview not found" }, { status: 404 });
  }
}
