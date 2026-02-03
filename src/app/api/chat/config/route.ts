import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

interface OpenClawConfig {
  gateway?: {
    auth?: {
      token?: string;
    };
  };
}

async function readTokenFromConfig(): Promise<string | null> {
  try {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    const raw = await readFile(configPath, "utf-8");
    const config: OpenClawConfig = JSON.parse(raw);
    return config.gateway?.auth?.token ?? null;
  } catch {
    return null;
  }
}

export async function GET() {
  const url =
    process.env.OPENCLAW_GATEWAY_URL ?? "ws://localhost:18789/ws";

  const token =
    process.env.OPENCLAW_GATEWAY_TOKEN ?? (await readTokenFromConfig());

  if (!token) {
    return NextResponse.json(
      { error: "Gateway token not found. Set OPENCLAW_GATEWAY_TOKEN or configure ~/.openclaw/openclaw.json" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url,
    token,
    agents: ["engineering"],
  });
}
