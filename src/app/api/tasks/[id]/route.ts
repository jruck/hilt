/**
 * /api/tasks/[id] — one task object by id (v3 unit A2).
 *
 * GET → probes `tasks/` then `tasks/.proposals/`; the response says which store answered.
 * PUT → non-status patch for accepted tasks or proposals. JSON cannot carry `undefined`, so an explicit
 *       `null` translates to the lib's undefined-clears-the-key convention. Status changes
 *       are rejected here EXCEPT `{ transition: { to, via } }`, which routes through
 *       transitionTask — the shared audited path (history line in the file body).
 *
 * NO broadcasting here — the file write triggers the BridgeWatcher (`tasks-changed`).
 */
import { NextResponse } from "next/server";
import { isValidTaskId, readTask, transitionTask, updateTask } from "@/lib/tasks/store";
import type { TaskPatch } from "@/lib/tasks/store";
import { readProposal, updateProposal } from "@/lib/tasks/proposals";
import type { TaskOrigin, TaskProvenance } from "@/lib/tasks/types";
import {
  errorMessage,
  isDateString,
  isRecord,
  isStringArray,
  isTaskStatus,
  taskBaseDir,
} from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // Reject before any path.join: a crafted id (`..%2F..%2Fevil`, decoded by Next) is a
    // path-traversal vector — confirmed read/write outside the vault in the A2 review.
    if (!isValidTaskId(id)) {
      return NextResponse.json({ error: `invalid task id: ${id.slice(0, 80)}` }, { status: 400 });
    }
    const baseDir = await taskBaseDir();

    const task = readTask(baseDir, id);
    if (task) return NextResponse.json({ task, store: "tasks" });

    const proposal = readProposal(baseDir, id);
    if (proposal) return NextResponse.json({ task: proposal, store: "proposals" });

    return NextResponse.json({ error: `task not found: ${id}` }, { status: 404 });
  } catch (err) {
    console.error("[tasks/[id]] GET error:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** Keys a PUT may patch. `status`/`id`/`created_at` are identity/audited fields. */
const PATCHABLE_KEYS = new Set(["title", "body", "due", "projects", "origin", "provenance"]);
/** Optional frontmatter keys where `null` means clear-the-key. */
const CLEARABLE_KEYS = new Set(["due", "projects", "origin", "provenance"]);

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!isValidTaskId(id)) {
      return NextResponse.json({ error: `invalid task id: ${id.slice(0, 80)}` }, { status: 400 });
    }
    const body: unknown = await request.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if ("status" in body) {
      return NextResponse.json(
        { error: "status cannot be patched directly — send { transition: { to, via } } instead (the audited path)" },
        { status: 400 },
      );
    }

    const baseDir = await taskBaseDir();

    // --- Transition branch: { transition: { to, via } } → transitionTask ---
    if ("transition" in body) {
      const extraKeys = Object.keys(body).filter((key) => key !== "transition");
      if (extraKeys.length > 0) {
        return NextResponse.json(
          { error: `transition must be the only key in the body (got: ${extraKeys.join(", ")})` },
          { status: 400 },
        );
      }
      const transition = body.transition;
      if (!isRecord(transition) || !isTaskStatus(transition.to) || typeof transition.via !== "string" || !transition.via.trim()) {
        return NextResponse.json(
          { error: "transition must be { to: <task status>, via: <non-empty string> }" },
          { status: 400 },
        );
      }
      if (!readTask(baseDir, id)) {
        return notFoundResponse(baseDir, id);
      }
      try {
        const task = transitionTask(baseDir, id, transition.to, transition.via.trim());
        return NextResponse.json({ task, store: "tasks" });
      } catch (err) {
        // transitionTask throws on illegal transitions — a client error, not a server one.
        return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
      }
    }

    // --- Patch branch: non-status fields; explicit null clears optional keys ---
    const unknownKeys = Object.keys(body).filter((key) => !PATCHABLE_KEYS.has(key));
    if (unknownKeys.length > 0) {
      return NextResponse.json(
        { error: `unknown patch key(s): ${unknownKeys.join(", ")} (allowed: ${[...PATCHABLE_KEYS].join(", ")})` },
        { status: 400 },
      );
    }
    if (Object.keys(body).length === 0) {
      return NextResponse.json({ error: "empty patch" }, { status: 400 });
    }

    const patch: TaskPatch = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === null) {
        if (!CLEARABLE_KEYS.has(key)) {
          return NextResponse.json({ error: `${key} cannot be cleared` }, { status: 400 });
        }
        // JSON null → the lib's undefined-clears-the-key convention.
        patch[key as keyof TaskPatch] = undefined;
        continue;
      }
      if (key === "title" && (typeof value !== "string" || !value.trim())) {
        return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
      }
      if (key === "body" && typeof value !== "string") {
        return NextResponse.json({ error: "body must be a string" }, { status: 400 });
      }
      if (key === "due" && !isDateString(value)) {
        return NextResponse.json({ error: "due must be a YYYY-MM-DD string" }, { status: 400 });
      }
      if (key === "projects" && !isStringArray(value)) {
        return NextResponse.json({ error: "projects must be an array of strings" }, { status: 400 });
      }
      if (key === "origin" && !isRecord(value)) {
        return NextResponse.json({ error: "origin must be an object" }, { status: 400 });
      }
      if (key === "provenance") {
        if (!isRecord(value) || typeof value.quote !== "string" || typeof value.source !== "string") {
          return NextResponse.json(
            { error: "provenance must be an object with string quote and source" },
            { status: 400 },
          );
        }
      }
      switch (key) {
        case "title":
          patch.title = value as string;
          break;
        case "body":
          patch.body = value as string;
          break;
        case "due":
          patch.due = value as string;
          break;
        case "projects":
          patch.projects = value as string[];
          break;
        case "origin":
          patch.origin = value as TaskOrigin;
          break;
        case "provenance":
          patch.provenance = value as unknown as TaskProvenance;
          break;
      }
    }

    if (readTask(baseDir, id)) {
      const task = updateTask(baseDir, id, patch);
      return NextResponse.json({ task, store: "tasks" });
    }
    if (readProposal(baseDir, id)) {
      const task = updateProposal(baseDir, id, patch);
      return NextResponse.json({ task, store: "proposals" });
    }
    return NextResponse.json({ error: `task not found: ${id}` }, { status: 404 });
  } catch (err) {
    console.error("[tasks/[id]] PUT error:", err);
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

/** Audited status transitions target accepted tasks only; proposals use the verdict routes. */
function notFoundResponse(baseDir: string, id: string): NextResponse {
  if (readProposal(baseDir, id)) {
    return NextResponse.json(
      { error: `${id} is a proposal — proposals are managed via the verdict flow, not PUT /api/tasks` },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: `task not found: ${id}` }, { status: 404 });
}
