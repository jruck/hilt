import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getVaultPath } from "@/lib/bridge/vault";

const PREFS_FILE = ".hilt-preferences.json";

async function getPrefsPath(): Promise<string> {
  const vaultPath = await getVaultPath();
  return path.join(vaultPath, PREFS_FILE);
}

async function readPrefs(): Promise<Record<string, unknown>> {
  try {
    const prefsPath = await getPrefsPath();
    const raw = await fs.readFile(prefsPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const prefs = await readPrefs();
    return NextResponse.json(prefs);
  } catch (err) {
    console.error("Failed to read preferences:", err);
    return NextResponse.json({ error: "Failed to read preferences" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, value } = body;

    if (!key || typeof key !== "string") {
      return NextResponse.json({ error: "key (string) required" }, { status: 400 });
    }

    const prefsPath = await getPrefsPath();
    const prefs = await readPrefs();
    prefs[key] = value;
    await fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2) + "\n", "utf-8");

    return NextResponse.json(prefs);
  } catch (err) {
    console.error("Failed to write preferences:", err);
    return NextResponse.json({ error: "Failed to write preferences" }, { status: 500 });
  }
}
