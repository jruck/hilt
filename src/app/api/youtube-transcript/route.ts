import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const SCRIPT_PATH = path.join(process.cwd(), "scripts", "youtube-transcript.py");

export async function GET(request: NextRequest) {
  const input =
    request.nextUrl.searchParams.get("videoId") ||
    request.nextUrl.searchParams.get("url");

  if (!input) {
    return NextResponse.json(
      { error: "videoId or url parameter required" },
      { status: 400 }
    );
  }

  try {
    const { stdout, stderr } = await execFileAsync("python3", [SCRIPT_PATH, input], {
      timeout: 30000, // 30 second timeout
    });

    if (stderr) {
      console.error("Python stderr:", stderr);
    }

    const result = JSON.parse(stdout);

    if (result.error) {
      const status = result.error.includes("disabled") || result.error.includes("not found")
        ? 404
        : 500;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check if it's a JSON parse error from a failed Python script
    if (message.includes("Unexpected token")) {
      return NextResponse.json(
        { error: "Failed to parse transcript response" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: `Failed to fetch transcript: ${message}` },
      { status: 500 }
    );
  }
}
