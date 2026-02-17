import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getVaultPath } from "@/lib/bridge/vault";

const STATE_FILE = ".briefing-state.json";

interface ReadState {
  lastRead: string | null;
}

async function getStatePath(): Promise<string> {
  const vaultPath = await getVaultPath();
  return path.join(vaultPath, "briefings", STATE_FILE);
}

async function readState(): Promise<ReadState> {
  try {
    const statePath = await getStatePath();
    const raw = await fs.readFile(statePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { lastRead: null };
  }
}

export async function GET() {
  try {
    const state = await readState();
    return NextResponse.json(state);
  } catch (err) {
    console.error("Failed to read briefing state:", err);
    return NextResponse.json({ error: "Failed to read state" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { lastRead } = body;

    if (!lastRead || typeof lastRead !== "string") {
      return NextResponse.json({ error: "lastRead (string) required" }, { status: 400 });
    }

    const statePath = await getStatePath();
    const state: ReadState = { lastRead };
    await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf-8");

    return NextResponse.json(state);
  } catch (err) {
    console.error("Failed to write briefing state:", err);
    return NextResponse.json({ error: "Failed to write state" }, { status: 500 });
  }
}
