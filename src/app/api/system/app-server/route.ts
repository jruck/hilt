import { NextResponse } from "next/server";
import { getAppServerInfo } from "@/lib/system/app-server-info";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getAppServerInfo());
}
