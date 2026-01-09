import { NextRequest, NextResponse } from "next/server";
import { getSessions, getRunningSessionIds, getSessionMtime, getSessionDerivedState } from "@/lib/claude-sessions";
import { getAllSessionStatuses, setSessionStatus, archiveSession, unarchiveSession } from "@/lib/db";
import { Session, SessionStatus } from "@/lib/types";
import { buildTree, isUnderScope } from "@/lib/tree-utils";
import { getCachedPlannedSlugs, setCachedPlannedSlugs } from "@/lib/session-cache";
import fs from "fs";
import path from "path";
import os from "os";

// Auto-archive threshold: sessions inactive for 7 days
const ARCHIVE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const PLANS_DIR = path.join(os.homedir(), ".claude", "plans");

// Get set of slugs that have plan files (with 30s caching)
function getPlannedSlugs(): Set<string> {
  // Try cache first
  const cached = getCachedPlannedSlugs();
  if (cached) return cached;

  // Cache miss - scan directory
  const slugs = new Set<string>();
  try {
    if (fs.existsSync(PLANS_DIR)) {
      const files = fs.readdirSync(PLANS_DIR);
      for (const file of files) {
        if (file.endsWith(".md")) {
          slugs.add(file.slice(0, -3)); // Remove .md extension
        }
      }
    }
  } catch {
    // Ignore errors reading plans directory
  }

  // Cache the result
  setCachedPlannedSlugs(slugs);
  return slugs;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const scopePath = searchParams.get("scope") || undefined;
    const mode = searchParams.get("mode") || "exact"; // "exact" | "tree"
    const showArchived = searchParams.get("showArchived") === "true";

    // Get all sessions from Claude's JSONL files
    const claudeSessions = await getSessions();

    // Filter by scope path
    // - mode=exact: Only sessions where projectPath === scope (current behavior)
    // - mode=tree: All sessions under scope (prefix match, for tree view)
    let filteredSessions;
    if (mode === "tree") {
      filteredSessions = scopePath
        ? claudeSessions.filter(s => isUnderScope(s.projectPath, scopePath))
        : claudeSessions;
    } else {
      filteredSessions = scopePath
        ? claudeSessions.filter(s => s.projectPath === scopePath)
        : claudeSessions;
    }

    // Get our status data, running session IDs, and planned slugs
    const statuses = await getAllSessionStatuses();
    const runningIds = getRunningSessionIds();
    const plannedSlugs = getPlannedSlugs();

    // Auto-update running sessions to "active" status, but ONLY if there's new activity
    // since the user marked it as "recent" (done). This prevents the bounce-back issue
    // where marking done on a running session would immediately revert.
    const statusUpdates: Promise<void>[] = [];
    for (const [sessionId, currentMtime] of runningIds) {
      const currentStatus = statuses.get(sessionId);
      const lastKnownMtime = currentStatus?.lastKnownMtime;

      // Only promote to active if:
      // 1. No status set yet, OR
      // 2. Status is not active AND there's new activity (mtime > lastKnownMtime)
      const hasNewActivity = !lastKnownMtime || currentMtime > lastKnownMtime;
      if ((!currentStatus || currentStatus.status !== "active") && hasNewActivity) {
        statusUpdates.push(setSessionStatus(sessionId, "active"));
      }
    }
    // Fire and forget - don't block response
    if (statusUpdates.length > 0) {
      Promise.all(statusUpdates).catch(console.error);
    }

    // Auto-archive: sessions with status "recent" that are:
    // - Not starred (user explicitly marked as important)
    // - Not running (currently active)
    // - Inactive for more than ARCHIVE_THRESHOLD_MS (7 days)
    const now = Date.now();
    const archiveUpdates: Promise<void>[] = [];
    for (const session of filteredSessions) {
      const statusData = statuses.get(session.id);
      const isRunning = runningIds.has(session.id);

      if (
        statusData?.status === "recent" &&
        !statusData?.starred &&
        !statusData?.archived &&
        !isRunning
      ) {
        const lastActivity = session.lastActivity.getTime();
        const age = now - lastActivity;
        if (age > ARCHIVE_THRESHOLD_MS) {
          archiveUpdates.push(archiveSession(session.id));
        }
      }
    }
    // Fire and forget - don't block response
    if (archiveUpdates.length > 0) {
      Promise.all(archiveUpdates).catch(console.error);
    }

    // Merge sessions with status data, running indicator, and plan status
    // Also deduplicate by ID (in case of any filesystem race conditions)
    const seenIds = new Set<string>();
    const sessions: Session[] = filteredSessions
      .filter((session) => {
        if (seenIds.has(session.id)) return false;
        seenIds.add(session.id);
        return true;
      })
      .map((session) => {
        const statusData = statuses.get(session.id);
        const currentMtime = runningIds.get(session.id);
        const isRunning = currentMtime !== undefined;

        // Determine if we should show as active:
        // - If running AND there's new activity since last status change
        // - OR if stored status is already active
        const lastKnownMtime = statusData?.lastKnownMtime;
        const hasNewActivity = !lastKnownMtime || (currentMtime !== undefined && currentMtime > lastKnownMtime);
        const shouldShowAsActive = isRunning && hasNewActivity;

        // Find which of the session's slugs have plan files
        const planSlugs = session.slugs?.filter(slug => plannedSlugs.has(slug)) || [];

        // If running session was archived, auto-unarchive it
        if (isRunning && statusData?.archived) {
          unarchiveSession(session.id).catch(console.error);
        }

        // Derive state for running/active sessions (to detect waiting_for_approval, etc.)
        const derivedState = (isRunning || shouldShowAsActive || statusData?.status === "active")
          ? getSessionDerivedState(session.id)
          : null;

        return {
          ...session,
          status: shouldShowAsActive ? "active" : (statusData?.status || "recent"),
          sortOrder: statusData?.sortOrder || 0,
          starred: statusData?.starred || false,
          archived: isRunning ? false : statusData?.archived || false,  // Running sessions are never archived
          isRunning,
          planSlugs,
          derivedState: derivedState ?? undefined,
        };
      });

    // Count total archived before filtering (always show this count)
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

    // Count by status (visible sessions only, except archived which shows total)
    const counts = {
      inbox: visibleSessions.filter(s => s.status === "inbox").length,
      active: visibleSessions.filter(s => s.status === "active").length,
      recent: visibleSessions.filter(s => s.status === "recent" && !s.archived).length,
      archived: totalArchived,  // Always show total archived count
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

    // Include tree structure for tree mode (using visible sessions)
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

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, status, sortOrder, starred, archived } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
    }

    // Handle archive/unarchive as a separate operation
    if (archived !== undefined) {
      if (archived) {
        await archiveSession(sessionId);
      } else {
        await unarchiveSession(sessionId);
      }
      return NextResponse.json({ success: true });
    }

    const validStatuses: SessionStatus[] = ["inbox", "active", "recent"];
    if (status !== undefined && !validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // When marking as "recent" (done), store the current JSONL mtime
    // This allows us to detect NEW activity after marking done
    let lastKnownMtime: number | undefined;
    if (status === "recent") {
      lastKnownMtime = getSessionMtime(sessionId) ?? undefined;
    }

    await setSessionStatus(sessionId, status, sortOrder, starred, lastKnownMtime);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating session status:", error);
    return NextResponse.json(
      { error: "Failed to update session status" },
      { status: 500 }
    );
  }
}
