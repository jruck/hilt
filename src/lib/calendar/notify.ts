import * as fs from "fs";
import * as path from "path";
import { getCalendarMarkerPath } from "./config";

export function touchCalendarChanged(data: Record<string, unknown> = {}): void {
  const marker = getCalendarMarkerPath();
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, JSON.stringify({ ...data, ts: Date.now() }), "utf-8");
}
