import { NextRequest, NextResponse } from "next/server";
import { getSessionDerivedState, getSessionJSONLPath, parseSessionFileForMetadata } from "@/lib/claude-sessions";
import {
  readSessionsRegistry,
  registerSession as dbRegisterSession,
  updateRegisteredSession,
  resolveSessionId,
  purgeStaleTemps,
  type RegisteredSession,
} from "@/lib/db";
import { Session, SessionStatus } from "@/lib/types";
import { buildTree, isUnderScope } from "@/lib/tree-utils";
import { getCachedPlannedSlugs, setCachedPlannedSlugs } from "@/lib/session-cache";
import fs from "fs";
import path from "path";
import os from "os";

// Auto-archive threshold: sessions inactive for 7 days
const ARCHIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

// Threshold for considering a session "running" based on file modification time
const RUNNING_THRESHOLD_MS = 30_000; // 30 seconds

const PLANS_DIR = path.join(os.homedir(), ".claude", "plans");

// Purge stale temp sessions on first request
let hasPurgedOnStartup = false;

// Get set of slugs that have plan files (with 30s caching)
function getPlannedSlugs(): Set<string> {
  const cached = getCachedPlannedSlugs();
  if (cached) return cached;

  const slugs = new Set<string>();
  try {
    if (fs.existsSync(PLANS_DIR)) {
      const files = fs.readdirSync(PLANS_DIR);
      for (const file of files) {
        if (file.endsWith(".md")) {
          slugs.add(file.slice(0, -3));
        }
      }
    }
  } catch {
    // Ignore errors reading plans directory
  }

  setCachedPlannedSlugs(slugs);
  return slugs;
}

/**
 * Check if a session's JSONL file was modified within RUNNING_THRESHOLD_MS.
 * Returns the mtime if running, undefined otherwise.
 */
function getRunningMtime(sessionId: string, projectPath: string): number | undefined {
  const jsonlPath = getSessionJSONLPath(sessionId, projectPath);
  if (!jsonlPath) return undefined;

  try {
    const stats = fs.statSync(jsonlPath);
    const mtime = stats.mtime.getTime();
    if (Date.now() - mtime < RUNNING_THRESHOLD_MS) {
      return mtime;
    }
  } catch {
    // File doesn't exist yet
  }
  return undefined;
}

export async function GET(request: NextRequest) {
  try {
    // Purge stale temp sessions on first request
    if (!hasPurgedOnStartup) {
      hasPurgedOnStartup = true;
      const purged = purgeStaleTemps();
      if (purged > 0) {
        console.log(`[sessions/GET] Purged ${purged} stale temp sessions`);
      }
    }

    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const scopePath = searchParams.get("scope") || undefined;
    const mode = searchParams.get("mode") || "exact"; // "exact" | "tree"
    const showArchived = searchParams.get("showArchived") === "true";

    // Read registered sessions from our registry
    const allRegistered = readSessionsRegistry();

    // Filter by scope path
    let filteredSessions: RegisteredSession[];
    if (mode === "tree") {
      filteredSessions = scopePath
        ? allRegistered.filter(s => isUnderScope(s.projectPath, scopePath))
        : allRegistered;
    } else {
      filteredSessions = scopePath
        ? allRegistered.filter(s => s.projectPath === scopePath)
        : allRegistered;
    }

    const plannedSlugs = getPlannedSlugs();
    const now = Date.now();

    // Build Session objects with live state
    const sessions: Session[] = filteredSessions.map((reg) => {
      const runningMtime = getRunningMtime(reg.id, reg.projectPath);
      const isRunning = runningMtime !== undefined;

      // For running/active sessions, read JSONL for derived state and update metadata
      let derivedState = undefined;
      if (isRunning || reg.status === "active") {
        const state = getSessionDerivedState(reg.id, reg.projectPath);
        if (state) {
          derivedState = state;
        }

        // Opportunistically update metadata from JSONL for active/running sessions
        if (isRunning) {
          const metadata = parseSessionFileForMetadata(reg.id, reg.projectPath);
          if (metadata) {
            const needsUpdate =
              metadata.messageCount !== reg.messageCount ||
              metadata.slug !== reg.slug ||
              metadata.lastMessage !== reg.lastMessage ||
              metadata.title !== reg.title;

            if (needsUpdate) {
              updateRegisteredSession(reg.id, {
                messageCount: metadata.messageCount,
                slug: metadata.slug,
                slugs: metadata.slugs,
                lastMessage: metadata.lastMessage,
                lastPrompt: metadata.lastPrompt,
                title: metadata.title,
                lastActivity: new Date().toISOString(),
                gitBranch: metadata.gitBranch,
              });
            }
          }
        }
      }

      // Auto-archive: sessions with status "recent" that are not starred, not running, and old
      const isOld = now - new Date(reg.lastActivity).getTime() > ARCHIVE_THRESHOLD_MS;
      if (reg.status === "recent" && !reg.starred && !reg.archived && !isRunning && isOld) {
        updateRegisteredSession(reg.id, { archived: true, archivedAt: new Date().toISOString() });
        reg.archived = true;
        reg.archivedAt = new Date().toISOString();
      }

      // If running session was archived, auto-unarchive
      if (isRunning && reg.archived) {
        updateRegisteredSession(reg.id, { archived: false, archivedAt: undefined });
        reg.archived = false;
      }

      // Find which of the session's slugs have plan files
      const planSlugs = reg.slugs?.filter(slug => plannedSlugs.has(slug)) || [];

      return {
        id: reg.id,
        title: reg.title,
        project: reg.project,
        projectPath: reg.projectPath,
        lastActivity: new Date(reg.lastActivity),
        messageCount: reg.messageCount,
        gitBranch: reg.gitBranch,
        firstPrompt: reg.firstPrompt,
        lastPrompt: reg.lastPrompt,
        lastMessage: reg.lastMessage,
        slug: reg.slug,
        slugs: reg.slugs,
        status: (isRunning && reg.status !== "active") ? "active" : reg.status,
        sortOrder: reg.sortOrder,
        starred: reg.starred,
        archived: isRunning ? false : reg.archived,
        isRunning,
        planSlugs,
        derivedState,
        terminalId: reg.terminalId,
        initialPrompt: reg.initialPrompt,
      };
    });

    // Count total archived before filtering
    const totalArchived = sessions.filter(s => s.archived).length;

    // Filter out archived sessions when showArchived is false
    const visibleSessions = showArchived
      ? sessions
      : sessions.filter(s => !s.archived);

    // Sort by status priority, then by sort order, then by last activity
    const statusOrder: Record<SessionStatus, number> = {
      active: 0,
      inbox: 1,
      recent: 2,
    };

    visibleSessions.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;

      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });

    // Count by status
    const counts = {
      inbox: visibleSessions.filter(s => s.status === "inbox").length,
      active: visibleSessions.filter(s => s.status === "active").length,
      recent: visibleSessions.filter(s => s.status === "recent" && !s.archived).length,
      archived: totalArchived,
    };

    // Paginate
    const total = visibleSessions.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedSessions = visibleSessions.slice(startIndex, startIndex + pageSize);

    // Build response
    const response: Record<string, unknown> = {
      sessions: paginatedSessions,
      total,
      page,
      pageSize,
      counts,
    };

    // Include tree structure for tree mode
    if (mode === "tree") {
      response.tree = buildTree(visibleSessions, scopePath || "");
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, projectPath, title, firstPrompt, initialPrompt } = body;

    if (!id || !projectPath) {
      return NextResponse.json(
        { error: "id and projectPath are required" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const project = projectPath.split("/").filter(Boolean).pop() || projectPath;

    const session: RegisteredSession = {
      id,
      projectPath,
      project,
      title: title || firstPrompt?.slice(0, 50) || "New Session",
      firstPrompt: firstPrompt || null,
      initialPrompt,
      status: "active",
      sortOrder: 0,
      starred: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
      lastActivity: now,
      messageCount: 0,
      gitBranch: null,
      slug: null,
      slugs: [],
      lastPrompt: firstPrompt || null,
      lastMessage: firstPrompt || null,
      terminalId: body.terminalId,
    };

    dbRegisterSession(session);

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, status, sortOrder, starred, archived, realId } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    // Handle temp→real ID resolution
    if (realId) {
      const resolved = resolveSessionId(sessionId, realId);
      if (!resolved) {
        return NextResponse.json(
          { error: "Session not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, session: resolved });
    }

    // Handle archive/unarchive
    if (archived !== undefined) {
      const updated = updateRegisteredSession(sessionId, {
        archived,
        archivedAt: archived ? new Date().toISOString() : undefined,
      });
      if (!updated) {
        // Session not in registry - might be legacy. Create a minimal entry.
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ success: true });
    }

    // Handle status/sortOrder/starred updates
    const validStatuses: SessionStatus[] = ["inbox", "active", "recent"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: Partial<RegisteredSession> = {};
    if (status !== undefined) updates.status = status;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (starred !== undefined) updates.starred = starred;

    const updated = updateRegisteredSession(sessionId, updates);
    if (!updated) {
      // Session not in registry - might be legacy or temp. Silently succeed.
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: 500 }
    );
  }
}
