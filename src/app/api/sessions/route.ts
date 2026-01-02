import { NextRequest, NextResponse } from "next/server";
import { getSessions, getRunningSessionIds } from "@/lib/claude-sessions";
import { getAllSessionStatuses, setSessionStatus } from "@/lib/db";
import { Session, SessionStatus } from "@/lib/types";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    const scopePath = searchParams.get("scope") || undefined;

    // Get all sessions from Claude's JSONL files
    const claudeSessions = await getSessions();

    // Filter by scope path if provided
    const filteredSessions = scopePath
      ? claudeSessions.filter(s => s.projectPath?.startsWith(scopePath))
      : claudeSessions;

    // Get our status data and running session IDs
    const statuses = await getAllSessionStatuses();
    const runningIds = getRunningSessionIds();

    // Auto-update running sessions to "active" status (permanent)
    const statusUpdates: Promise<void>[] = [];
    for (const sessionId of runningIds) {
      const currentStatus = statuses.get(sessionId);
      if (!currentStatus || currentStatus.status !== "active") {
        statusUpdates.push(setSessionStatus(sessionId, "active"));
      }
    }
    // Fire and forget - don't block response
    if (statusUpdates.length > 0) {
      Promise.all(statusUpdates).catch(console.error);
    }

    // Merge sessions with status data and running indicator
    const sessions: Session[] = filteredSessions.map((session) => {
      const statusData = statuses.get(session.id);
      const isRunning = runningIds.has(session.id);
      return {
        ...session,
        // Running sessions are always shown as active
        status: isRunning ? "active" : (statusData?.status || "recent"),
        sortOrder: statusData?.sortOrder || 0,
        starred: statusData?.starred || false,
        isRunning,
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

    return NextResponse.json({
      sessions: paginatedSessions,
      total,
      page,
      pageSize,
      counts,
    });
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

    await setSessionStatus(sessionId, status, sortOrder, starred);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating session status:", error);
    return NextResponse.json(
      { error: "Failed to update session status" },
      { status: 500 }
    );
  }
}
