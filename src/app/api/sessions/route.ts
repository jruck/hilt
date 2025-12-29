import { NextRequest, NextResponse } from "next/server";
import { getSessions } from "@/lib/claude-sessions";
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

    // Get our status data
    const statuses = await getAllSessionStatuses();

    // Merge sessions with status data
    const sessions: Session[] = filteredSessions.map((session) => {
      const statusData = statuses.get(session.id);
      return {
        ...session,
        status: statusData?.status || "inactive",
        sortOrder: statusData?.sortOrder || 0,
      };
    });

    // Sort by status priority, then by sort order, then by last activity
    const statusOrder: Record<SessionStatus, number> = {
      active: 0,
      inbox: 1,
      inactive: 2,
      done: 3,
    };

    sessions.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;

      const orderDiff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;

      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });

    // Paginate
    const total = sessions.length;
    const startIndex = (page - 1) * pageSize;
    const paginatedSessions = sessions.slice(startIndex, startIndex + pageSize);

    return NextResponse.json({
      sessions: paginatedSessions,
      total,
      page,
      pageSize,
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
    const { sessionId, status, sortOrder } = body;

    if (!sessionId || !status) {
      return NextResponse.json(
        { error: "sessionId and status are required" },
        { status: 400 }
      );
    }

    const validStatuses: SessionStatus[] = [
      "inbox",
      "active",
      "inactive",
      "done",
    ];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    await setSessionStatus(sessionId, status, sortOrder);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating session status:", error);
    return NextResponse.json(
      { error: "Failed to update session status" },
      { status: 500 }
    );
  }
}
