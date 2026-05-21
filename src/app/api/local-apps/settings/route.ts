import { NextResponse } from "next/server";
import { settingsMetadataSchema } from "@/lib/local-apps/contracts";
import { isLocalAppsEnabled, settingsMetadata } from "@/lib/local-apps/settings";
import { disabledResponse } from "@/lib/local-apps/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!isLocalAppsEnabled()) {
    return NextResponse.json(disabledResponse(), { status: 403 });
  }

  try {
    return NextResponse.json(settingsMetadataSchema.parse(settingsMetadata()));
  } catch (error) {
    console.error("[local-apps/settings] Error:", error);
    return NextResponse.json({ error: "Failed to read Local Apps settings" }, { status: 500 });
  }
}

