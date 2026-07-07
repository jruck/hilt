/**
 * /api/objects/resolve — universal object-reference resolver (v3 unit B5).
 *
 * GET ?kind=<ObjectKind>&id=<native id> → ResolvedObject (card + nav target) for the
 * ObjectPill popover. Thin dispatch over src/lib/objects/resolvers.ts; pure read, NO side
 * effects (the library resolver deliberately bypasses the read-state-stamping detail route).
 *
 * 400 = unknown kind / missing id; 404 = the ref doesn't resolve (missing file, invalid task
 * id, meeting outside the vault, …) — the pill degrades gracefully on 404.
 */
import { NextResponse } from "next/server";
import { resolveObjectRef } from "@/lib/objects/resolvers";
import { isObjectKind, OBJECT_KINDS } from "@/lib/objects/uri";
import { errorMessage, taskBaseDir } from "../../tasks/_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const id = searchParams.get("id");

    if (!isObjectKind(kind)) {
      return NextResponse.json(
        { error: `unknown kind: ${String(kind).slice(0, 80)} (expected one of: ${OBJECT_KINDS.join(", ")})` },
        { status: 400 },
      );
    }
    if (!id || !id.trim()) {
      return NextResponse.json({ error: "missing id" }, { status: 400 });
    }

    const vaultPath = await taskBaseDir();
    const resolved = resolveObjectRef(vaultPath, { kind, id });
    if (!resolved) {
      return NextResponse.json({ error: `${kind} not found: ${id.slice(0, 200)}` }, { status: 404 });
    }
    return NextResponse.json(resolved);
  } catch (err) {
    console.error("[objects/resolve] GET error:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
