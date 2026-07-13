"use client";

import type { ObjectRef } from "@/lib/objects/types";
import { useObjectCard } from "@/hooks/useObjectCard";
import { useScope } from "@/contexts/ScopeContext";
import { ObjectCard } from "@/components/objects/ObjectCard";
import { ObjectPill } from "@/components/objects/ObjectPill";

/** The shared pinned attachment for the meeting that originated a task. */
export function TaskMeetingLinkageCard({ meetingId }: { meetingId: string }) {
  const refr: ObjectRef = { kind: "meeting", id: meetingId };
  const { resolved, error } = useObjectCard(refr, true);
  const { navigateTo } = useScope();
  const nav = resolved?.nav ?? null;

  return (
    <div className="px-6 pt-3">
      {resolved ? (
        <ObjectCard card={resolved.card} onOpen={nav ? () => navigateTo(nav.view, nav.scope) : undefined} />
      ) : error ? (
        <span className="text-xs text-[var(--text-tertiary)]"><ObjectPill refr={refr} /></span>
      ) : (
        <div className="space-y-2 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5" aria-hidden>
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-[var(--bg-tertiary)]" />
          <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--bg-tertiary)]" />
        </div>
      )}
    </div>
  );
}
