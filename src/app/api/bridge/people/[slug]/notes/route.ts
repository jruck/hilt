import { NextRequest, NextResponse } from "next/server";
import { updatePersonNotes, deletePersonNotes } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";
import * as fs from "fs";
import * as path from "path";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { date, notes } = await request.json();

    if (typeof date !== "string" || typeof notes !== "string") {
      return NextResponse.json(
        { error: "date and notes must be strings" },
        { status: 400 }
      );
    }

    const vaultPath = await getVaultPath();
    const filePath = path.join(vaultPath, "people", `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const updated = updatePersonNotes(content, date, notes);

    // Atomic write
    const tmpPath = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, updated, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/people/slug/notes] Error:", err);
    return NextResponse.json(
      { error: "Failed to update notes" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { oldDate, newDate } = await request.json();

    if (typeof oldDate !== "string" || typeof newDate !== "string") {
      return NextResponse.json(
        { error: "oldDate and newDate must be strings" },
        { status: 400 }
      );
    }

    const vaultPath = await getVaultPath();
    const filePath = path.join(vaultPath, "people", `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    // Extract notes from old date, delete old section, insert at new date
    const sectionRegex = new RegExp(
      `^###\\s+${oldDate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n([\\s\\S]*?)(?=\\n###\\s|$)`,
      "m"
    );
    const match = content.match(sectionRegex);
    const notes = match ? match[1].trim() : "";
    if (!notes) {
      return NextResponse.json({ error: "Notes section not found" }, { status: 404 });
    }

    let updated = deletePersonNotes(content, oldDate);
    updated = updatePersonNotes(updated, newDate, notes);

    const tmpPath = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, updated, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/people/slug/notes] PATCH Error:", err);
    return NextResponse.json(
      { error: "Failed to change date" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { date } = await request.json();

    if (typeof date !== "string") {
      return NextResponse.json(
        { error: "date must be a string" },
        { status: 400 }
      );
    }

    const vaultPath = await getVaultPath();
    const filePath = path.join(vaultPath, "people", `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const updated = deletePersonNotes(content, date);

    // Atomic write
    const tmpPath = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, updated, "utf-8");
    fs.renameSync(tmpPath, filePath);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/people/slug/notes] DELETE Error:", err);
    return NextResponse.json(
      { error: "Failed to delete notes" },
      { status: 500 }
    );
  }
}
