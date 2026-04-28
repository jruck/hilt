import { NextRequest, NextResponse } from "next/server";
import { updatePersonNext } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";
import * as fs from "fs";
import * as path from "path";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();

    const vaultPath = await getVaultPath();
    const filePath = path.join(vaultPath, "people", `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    let fileContent = fs.readFileSync(filePath, "utf-8");

    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "content must be a string" },
        { status: 400 }
      );
    }
    fileContent = updatePersonNext(fileContent, body.content);

    // Atomic write
    const tmpPath = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, fileContent, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/people/slug/next] Error:", err);
    return NextResponse.json(
      { error: "Failed to update next section" },
      { status: 500 }
    );
  }
}
