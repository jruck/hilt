import { NextRequest, NextResponse } from "next/server";
import { updatePersonNext, updatePersonNotes, parseNextSection } from "@/lib/bridge/people-parser";
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

    // Commit: move Next content to a dated notes entry and clear Next
    if ("commit" in body && typeof body.commit === "string") {
      const date = body.commit;
      const nextRawMatch = fileContent.match(/^##\s+Next\s*\n([\s\S]*?)(?=\n##\s)/m);
      const currentRaw = nextRawMatch ? nextRawMatch[1].trim() : "";
      const { content } = parseNextSection(currentRaw);
      if (content) {
        fileContent = updatePersonNotes(fileContent, date, content);
      }
      fileContent = updatePersonNext(fileContent, "");
    }

    // Content update (plain save, no commit)
    if ("content" in body) {
      if (typeof body.content !== "string") {
        return NextResponse.json(
          { error: "content must be a string" },
          { status: 400 }
        );
      }
      fileContent = updatePersonNext(fileContent, body.content);
    }

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
