import { NextResponse } from "next/server";
import { localSystemMachineResponse } from "@/lib/system/peers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await localSystemMachineResponse());
  } catch (error) {
    return NextResponse.json(
      { app: "hilt-system", enabled: false, reason: error instanceof Error ? error.message : "Failed to read system identity" },
      { status: 500 },
    );
  }
}
