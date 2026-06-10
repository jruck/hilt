import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getNodeById, getNodeByRefPath } from "@/lib/graph/db";
import { candidateNodeId, noteNodeId, referenceNodeId } from "@/lib/graph/build";
import { getLibraryArtifact } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resolve an EXTERNAL reference to a graph node id. The "Show in graph" buttons pass what their
 * surface naturally has — a library artifact id (Library), a vault file path (Docs), a person slug
 * (People) — none of which are graph node ids (`ref:`/`note:` hash an ABSOLUTE path; people are
 * `person:<slug>`-prefixed). Rather than teach every surface the graph's id scheme, the graph
 * resolves: GraphView calls this once on a focus miss and re-enters with the canonical id.
 */
export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref")?.trim();
  if (!ref || ref.length > 512) {
    return NextResponse.json({ error: "ref required" }, { status: 400 });
  }
  try {
    const vaultPath = await getVaultPath();
    const tryIds: string[] = [ref, `cand:${ref}`, `person:${ref}`, `project:${ref}`];

    // Path-like refs (Docs passes file paths): hash the absolute path under every dweller scheme.
    if (ref.includes("/") || ref.endsWith(".md")) {
      const absPath = path.isAbsolute(ref) ? ref : path.join(vaultPath, ref);
      const byRefPath = getNodeByRefPath(absPath);
      if (byRefPath) return NextResponse.json({ node_id: byRefPath.id });
      tryIds.push(referenceNodeId(absPath), noteNodeId(absPath));
    }

    for (const id of tryIds) {
      const node = getNodeById(id);
      if (node) return NextResponse.json({ node_id: node.id });
    }

    // Library artifact id (Library passes artifact.id = hash of the RELATIVE path): look the
    // artifact up, then resolve through its absolute path.
    const artifact = getLibraryArtifact(vaultPath, ref);
    if (artifact) {
      const absPath = path.join(vaultPath, artifact.path);
      for (const id of [candidateNodeId(artifact.id), referenceNodeId(absPath), noteNodeId(absPath)]) {
        const node = getNodeById(id);
        if (node) return NextResponse.json({ node_id: node.id });
      }
      const byRefPath = getNodeByRefPath(absPath);
      if (byRefPath) return NextResponse.json({ node_id: byRefPath.id });
    }

    return NextResponse.json({ error: "No graph node for ref" }, { status: 404 });
  } catch (error) {
    console.error("[graph/resolve] failed:", error);
    return NextResponse.json({ error: "Resolve failed" }, { status: 500 });
  }
}
