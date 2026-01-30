import { NextResponse } from "next/server";
import { getAllProjects } from "@/lib/bridge/project-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const projects = await getAllProjects(vaultPath);
    return NextResponse.json(projects);
  } catch (err) {
    console.error("[bridge/projects] Error:", err);
    return NextResponse.json({ error: "Failed to read projects" }, { status: 500 });
  }
}
