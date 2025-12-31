import { NextResponse } from "next/server";
import { exec } from "child_process";

export async function POST(request: Request) {
  try {
    const { path } = await request.json();

    if (!path || typeof path !== "string") {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    // Use macOS 'open' command to reveal in Finder
    // -R flag reveals (selects) the file in Finder
    exec(`open -R "${path}"`, (error) => {
      if (error) {
        console.error("Failed to reveal in Finder:", error);
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revealing file:", error);
    return NextResponse.json(
      { error: "Failed to reveal file" },
      { status: 500 }
    );
  }
}
