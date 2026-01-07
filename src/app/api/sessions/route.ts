import { NextRequest, NextResponse } from "next/server";
import { getSessions, getRunningSessionIds, getSessionMtime } from "@/lib/claude-sessions";
import { getAllSessionStatuses, setSessionStatus } from "@/lib/db";
import { Session, SessionStatus } from "@/lib/types";
import { buildTree, isUnderScope } from "@/lib/tree-utils";
import fs from "fs";
import path from "path";
import os from "os";

const PLANS_DIR = path.join(os.homedir(), ".claude", "plans");

// Get set of slugs that have plan files
function getPlannedSlugs(): Set<string> {
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
  return slugs;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const scopePath = searchParams.get("scope") || undefined;
    const mode = searchParams.get("mode") || "exact"; // "exact" | "tree"

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

        return {
          ...session,
          status: shouldShowAsActive ? "active" : (statusData?.status || "recent"),
          sortOrder: statusData?.sortOrder || 0,
          starred: statusData?.starred || false,
          isRunning,
          planSlugs,
        };
      });

    // Sort by status priority, then by sort order, then by last activity
    const statusOrder: Record<SessionStatus, number> = {
      active: 0,
      inbox: 1,
      recent: 2,
    };

    sessions.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;

      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });

    // Count by status before pagination
    const counts = {
      inbox: sessions.filter(s => s.status === "inbox").length,
      active: sessions.filter(s => s.status === "active").length,
      recent: sessions.filter(s => s.status === "recent").length,
    };

    // Paginate
    const total = sessions.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedSessions = sessions.slice(startIndex, startIndex + pageSize);

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
      response.tree = buildTree(sessions, scopePath || "");
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
    const { sessionId, status, sortOrder, starred } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 }
      );
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
