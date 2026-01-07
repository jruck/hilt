import { NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const PORT_FILE = path.join(process.env.HOME || "~", ".claude-kanban-ws-port");

export async function GET() {
  try {
    if (!fs.existsSync(PORT_FILE)) {
      return NextResponse.json(
        { error: "WebSocket server not running" },
        { status: 503 }
      );
    }

    const port = parseInt(fs.readFileSync(PORT_FILE, "utf-8").trim(), 10);

    if (isNaN(port)) {
      return NextResponse.json(
        { error: "Invalid port in port file" },
        { status: 500 }
      );
    }

    return NextResponse.json({ port });
  } catch (error) {
    console.error("Error reading WS port file:", error);
    return NextResponse.json(
      { error: "Failed to read port file" },
      { status: 500 }
    );
  }
}
