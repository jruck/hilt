import { NextRequest, NextResponse } from "next/server";
import { comparePlainDates, getWeatherForecast, isPlainDate } from "@/lib/weather/forecast";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const start = search.get("start");
  const end = search.get("end");

  if (!isPlainDate(start) || !isPlainDate(end) || comparePlainDates(start, end) > 0) {
    return NextResponse.json({ error: "Invalid start/end range" }, { status: 400 });
  }

  try {
    return NextResponse.json(await getWeatherForecast(start, end));
  } catch (error) {
    console.error("[weather] forecast failed", error);
    return NextResponse.json({ error: "Weather forecast unavailable" }, { status: 502 });
  }
}
