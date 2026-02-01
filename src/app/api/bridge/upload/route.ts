import { NextRequest, NextResponse } from "next/server";
import { mkdir, stat, writeFile } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const scope = form.get("scope") as string | null;
  const fileDir = form.get("fileDir") as string | null;

  if (!file || !scope || !fileDir) {
    return NextResponse.json(
      { error: "Missing file, scope, or fileDir" },
      { status: 400 }
    );
  }

  // Resolve the media directory within the vault
  const mediaDir = path.resolve(scope, fileDir, "media");
  const resolved = path.resolve(mediaDir);

  // Ensure the media dir is within the scope
  if (!resolved.startsWith(path.resolve(scope))) {
    return NextResponse.json(
      { error: "Path traversal denied" },
      { status: 403 }
    );
  }

  await mkdir(mediaDir, { recursive: true });

  // Sanitize filename: keep extension, replace non-alphanumeric with dashes
  const ext = path.extname(file.name) || "";
  const base = path
    .basename(file.name, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);

  let filename = `${base}${ext}`;
  let dest = path.join(mediaDir, filename);

  // Deduplicate on collision
  try {
    await stat(dest);
    const ts = Date.now();
    filename = `${base}-${ts}${ext}`;
    dest = path.join(mediaDir, filename);
  } catch {
    // No collision
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(dest, buffer);

  return NextResponse.json({ relativePath: `media/${filename}` });
}
