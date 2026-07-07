/**
 * /api/tasks — the task-object store (v3 unit A2).
 *
 * GET  → both stores: accepted tasks (`tasks/`) and proposals (`tasks/.proposals/`).
 * POST → create a task file (createTask; `proposed` status lands in `.proposals/`).
 *
 * NO broadcasting here — the file write triggers the BridgeWatcher, which is the only
 * broadcast path (`tasks-changed` on the `bridge` channel).
 */
import { NextResponse } from "next/server";
import { createTask, listTasks } from "@/lib/tasks/store";
import type { CreatableTaskStatus, CreateTaskInput } from "@/lib/tasks/store";
import { listProposals } from "@/lib/tasks/proposals";
import type { TaskOrigin, TaskProvenance } from "@/lib/tasks/types";
import { errorMessage, isDateString, isRecord, isStringArray, taskBaseDir } from "./_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CREATABLE_STATUSES: readonly CreatableTaskStatus[] = ["proposed", "accepted-me", "accepted-agent"];

export async function GET() {
  try {
    const baseDir = await taskBaseDir();
    return NextResponse.json({
      tasks: listTasks(baseDir),
      proposals: listProposals(baseDir),
    });
  } catch (err) {
    console.error("[tasks] GET error:", err);
    return NextResponse.json({ error: "Failed to list tasks" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Validate up front so the lib's throws surface as 400s, never 500s.
    if (typeof body.title !== "string" || !body.title.trim()) {
      return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
    }
    if (body.status !== undefined && !CREATABLE_STATUSES.includes(body.status as CreatableTaskStatus)) {
      return NextResponse.json(
        { error: `status must be one of ${CREATABLE_STATUSES.join(", ")} (a task cannot be born done/dropped/in-progress)` },
        { status: 400 },
      );
    }
    if (body.body !== undefined && typeof body.body !== "string") {
      return NextResponse.json({ error: "body must be a string" }, { status: 400 });
    }
    if (body.due !== undefined && !isDateString(body.due)) {
      return NextResponse.json({ error: "due must be a YYYY-MM-DD string" }, { status: 400 });
    }
    if (body.projects !== undefined && !isStringArray(body.projects)) {
      return NextResponse.json({ error: "projects must be an array of strings" }, { status: 400 });
    }
    if (body.origin !== undefined && !isRecord(body.origin)) {
      return NextResponse.json({ error: "origin must be an object" }, { status: 400 });
    }
    if (body.provenance !== undefined) {
      const p = body.provenance;
      if (!isRecord(p) || typeof p.quote !== "string" || typeof p.source !== "string") {
        return NextResponse.json(
          { error: "provenance must be an object with string quote and source" },
          { status: 400 },
        );
      }
    }

    const input: CreateTaskInput = { title: body.title };
    if (body.status !== undefined) input.status = body.status as CreatableTaskStatus;
    if (body.body !== undefined) input.body = body.body;
    if (body.due !== undefined) input.due = body.due;
    if (body.projects !== undefined) input.projects = body.projects;
    if (body.origin !== undefined) input.origin = body.origin as TaskOrigin;
    if (body.provenance !== undefined) input.provenance = body.provenance as unknown as TaskProvenance;

    const baseDir = await taskBaseDir();
    const task = createTask(baseDir, input);
    const store = task.status === "proposed" ? "proposals" : "tasks";
    return NextResponse.json({ task, store }, { status: 201 });
  } catch (err) {
    console.error("[tasks] POST error:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
