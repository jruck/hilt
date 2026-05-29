"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, GitCompareArrows, Loader2, RefreshCw } from "lucide-react";
import { runGranolaSync, useGranolaSyncStatus } from "@/hooks/useGranolaSync";

export function GranolaSyncControl({ compact }: { compact?: boolean }) {
  const { data, error: statusError, isLoading, mutate } = useGranolaSyncStatus();
  const [pending, setPending] = useState<"sync" | "compare" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const blocked = data ? !data.handoff.safeForProductionWrites : false;
  const hasError = Boolean(statusError || actionError);
  const label = blocked
    ? "Blocked"
    : data?.lastRun?.finishedAt
      ? "Synced"
      : "Granola";
  const detail = statusError
    ? "Status unavailable"
    : actionError
      ? actionError
      : blocked
        ? "Obsidian sync still on"
        : data?.documents.total
          ? `${data.documents.total} notes · ${data.documents.linkedCalendarEvents} linked`
          : "Ready";

  async function run(mode: "sync" | "compare") {
    setPending(mode);
    setActionError(null);
    try {
      if (mode === "compare") {
        await runGranolaSync("compare", { dryRun: true, daysBack: 30, limit: 50 });
      } else {
        await runGranolaSync("incremental", { dryRun: false });
      }
      await mutate();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Granola sync failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={`rounded-lg border bg-[var(--content-surface)] ${compact ? "px-2.5 py-2" : "px-3 py-2.5"} ${blocked ? "border-amber-500/40" : hasError ? "border-red-500/30" : "border-[var(--border-default)]"}`}>
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center text-[var(--text-tertiary)]">
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : blocked || hasError ? (
            <AlertTriangle className={`h-3.5 w-3.5 ${hasError ? "text-red-500" : "text-amber-500"}`} />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[var(--text-primary)]">{label}</div>
          <div className={`truncate text-[11px] ${hasError ? "text-red-500" : "text-[var(--text-tertiary)]"}`}>
            {detail}
          </div>
        </div>
        <button
          type="button"
          className="calendar-icon-button h-7 w-7"
          title="Compare Granola output"
          disabled={pending !== null}
          onClick={() => void run("compare")}
        >
          {pending === "compare" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          className="calendar-icon-button h-7 w-7"
          title="Sync Granola"
          disabled={pending !== null || blocked}
          onClick={() => void run("sync")}
        >
          {pending === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
