"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowLeft, ChevronRight, Database, LoaderCircle, Search, X,
} from "lucide-react";
import { useMeetingLedger, useMeetingLedgerDetail, useMeetingLedgerHealth, type MeetingLedgerListItem } from "@/hooks/useMeetingLedger";
import type { LedgerSurfaceState } from "@/lib/loops/meeting-ledger-store";
import { formatRelativeDate } from "@/components/tasks/ProposalsSection";
import {
  LEDGER_STATE_META,
  LEDGER_SURFACE_COPY,
  MeetingLedgerRecord,
  meetingLedgerMeetingLabel,
} from "./MeetingLedgerRecord";

const SURFACES: Array<{ id: LedgerSurfaceState | "all"; label: string; description: string }> = [
  { id: "all", label: "All", description: "Every meeting-action record." },
  { id: "pending", label: "Pending", description: LEDGER_SURFACE_COPY.pending },
  { id: "accepted", label: "Accepted", description: LEDGER_SURFACE_COPY.accepted },
  { id: "latent", label: "Not surfaced", description: LEDGER_SURFACE_COPY.latent },
  { id: "observed", label: "Observed only", description: LEDGER_SURFACE_COPY.observed },
  { id: "dismissed", label: "Dismissed", description: LEDGER_SURFACE_COPY.dismissed },
  { id: "resolved", label: "Resolved", description: LEDGER_SURFACE_COPY.resolved },
];

export function MeetingLedgerLauncher({ onOpen }: { onOpen: () => void }) {
  const { data, error } = useMeetingLedgerHealth();
  // Older Hilt servers can briefly omit queue health during a rolling upgrade.
  const failed = data?.extraction_queue?.failed ?? 0;
  const active = data?.extraction_queue?.depth ?? 0;
  const status = error
    ? "Ledger unavailable"
    : failed
      ? `${failed.toLocaleString()} extraction ${failed === 1 ? "failure" : "failures"}`
      : active
        ? `${active.toLocaleString()} ${active === 1 ? "meeting" : "meetings"} processing`
        : data
          ? `${data.counts.total.toLocaleString()} entries · ${data.counts.latent.toLocaleString()} latent`
          : "Loading";
  const unhealthy = Boolean(error || failed);
  return (
    <button
      type="button"
      data-testid="meeting-ledger-launcher"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 border-t border-[var(--border-default)] py-3 text-left transition-colors hover:text-[var(--text-primary)]"
      title={error ? "Meeting ledger unavailable; open for details" : failed ? "Meeting extraction needs attention" : active ? "Meeting extraction is processing" : "Browse the meeting ledger"}
    >
      <Database className={`h-4 w-4 ${unhealthy ? "text-red-500" : active ? "text-blue-500" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"}`} />
      <span className="text-sm font-medium text-[var(--text-secondary)]">Meeting ledger</span>
      <span className={`text-xs tabular-nums ${unhealthy ? "text-red-500" : active ? "text-blue-500" : "text-[var(--text-quaternary)]"}`}>
        {status}
      </span>
      <ChevronRight className="ml-auto h-4 w-4 text-[var(--text-quaternary)] group-hover:text-[var(--text-secondary)]" />
    </button>
  );
}

function LedgerRow({ item, selected, onSelect }: { item: MeetingLedgerListItem; selected: boolean; onSelect: () => void }) {
  const meta = LEDGER_STATE_META[item.surface];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      data-ledger-id={item.id}
      onClick={onSelect}
      className={`flex h-[84px] w-full gap-3 border-b border-[var(--border-default)] px-4 py-3 text-left transition-colors ${selected ? "bg-blue-500/[0.07] border-l-2 border-l-blue-500" : "hover:bg-[var(--bg-secondary)] border-l-2 border-l-transparent"}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 flex-none ${meta.className}`} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[13px] font-medium leading-[1.35] text-[var(--text-primary)]">{item.action}</span>
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]">
          <span className="truncate">{meetingLedgerMeetingLabel(item.opened_from)}</span>
          <span className="text-[var(--text-quaternary)]">·</span>
          <span className="shrink-0">{item.owner}</span>
          <span className="ml-auto shrink-0 text-[var(--text-quaternary)]">{formatRelativeDate(item.last_seen_at)}</span>
        </span>
      </span>
    </button>
  );
}

function LedgerDetail({ id, onBack, onOpenTask }: { id: string; onBack: () => void; onOpenTask?: (id: string) => void }) {
  const { data, error, isLoading } = useMeetingLedgerDetail(id);
  if (isLoading && !data) return <div className="flex flex-1 items-center justify-center"><LoaderCircle className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" /></div>;
  if (error || !data) return <div className="p-5 text-sm text-red-500">Could not load this ledger entry.</div>;
  const { entry } = data;
  const meta = LEDGER_STATE_META[entry.surface];
  const StateIcon = meta.icon;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="meeting-ledger-detail">
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" title="Back to ledger" aria-label="Back to ledger">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span title={LEDGER_SURFACE_COPY[entry.surface]} className={`flex items-center gap-1.5 text-xs font-medium ${meta.className}`}><StateIcon className="h-3.5 w-3.5" />{meta.label}</span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-quaternary)]">{entry.id}</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <MeetingLedgerRecord
          detail={data}
          onOpenTask={onOpenTask}
          className="px-5 py-5 pb-[var(--hilt-mobile-nav-clearance)]"
        />
      </div>
    </div>
  );
}

export function MeetingLedgerPanel({ onClose, onOpenTask }: { onClose: () => void; onOpenTask?: (id: string) => void }) {
  const [surface, setSurface] = useState<LedgerSurfaceState | "all">("all");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const ledger = useMeetingLedger({ surface, query, owner });
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({ count: ledger.items.length, getScrollElement: () => scrollRef.current, estimateSize: () => 84, overscan: 8 });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const lastIndex = virtualRows.at(-1)?.index ?? -1;
  useEffect(() => {
    if (lastIndex >= ledger.items.length - 6 && ledger.hasMore && !ledger.isValidating) void ledger.loadMore();
  }, [lastIndex, ledger]);
  const ownerOptions = useMemo(() => Object.entries(ledger.facets?.owner ?? {}).sort((a, b) => b[1] - a[1]), [ledger.facets]);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-primary)] md:border-l md:border-[var(--border-default)]" data-testid="meeting-ledger-panel">
      <div className="flex items-center gap-3 border-b border-[var(--border-default)] px-4 py-3">
        <Database className="h-4 w-4 text-[var(--text-tertiary)]" />
        <div className="min-w-0"><div className="text-sm font-semibold text-[var(--text-primary)]">Meeting ledger</div><div className="text-[11px] text-[var(--text-quaternary)]">{ledger.total.toLocaleString()} records · read only</div></div>
        <button type="button" onClick={onClose} className="ml-auto rounded-md p-1.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]" title="Close meeting ledger" aria-label="Close meeting ledger"><X className="h-4 w-4" /></button>
      </div>
      {selectedId ? <LedgerDetail id={selectedId} onBack={() => setSelectedId(null)} onOpenTask={onOpenTask} /> : (
        <>
          <div className="border-b border-[var(--border-default)] px-3 py-3">
            <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-quaternary)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions and context" className="h-8 w-full rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] pl-8 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-quaternary)] focus:ring-1 focus:ring-blue-500/40" /></div>
            <div className="mt-2 flex min-h-[52px] flex-wrap content-start gap-1 pb-0.5">
              {SURFACES.map((item) => <button key={item.id} type="button" title={item.description} onClick={() => setSurface(item.id)} className={`shrink-0 rounded-md px-2 py-1 text-[11px] transition-colors ${surface === item.id ? "bg-[var(--bg-tertiary)] font-medium text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)]"}`}>{item.label}{item.id !== "all" && ledger.facets ? ` ${ledger.facets.surface[item.id].toLocaleString()}` : ""}</button>)}
            </div>
            {ownerOptions.length > 1 && <select value={owner} onChange={(event) => setOwner(event.target.value)} className="mt-2 h-7 max-w-full rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-2 text-[11px] text-[var(--text-secondary)]"><option value="">All owners</option>{ownerOptions.map(([value, count]) => <option key={value} value={value}>{value} · {count}</option>)}</select>}
          </div>
          <div ref={scrollRef} className="hilt-mobile-scroll-clearance min-h-0 flex-1 overflow-y-auto" data-testid="meeting-ledger-list">
            {ledger.isLoading && !ledger.items.length ? <div className="flex h-32 items-center justify-center"><LoaderCircle className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" /></div> : ledger.error ? <div className="p-5 text-sm text-red-500">Could not load the meeting ledger.</div> : !ledger.items.length ? <div className="p-8 text-center text-sm text-[var(--text-tertiary)]">No ledger entries match these filters.</div> : (
              <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                {virtualRows.map((virtual) => { const item = ledger.items[virtual.index]; return <div key={item.id} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${virtual.start}px)` }}><LedgerRow item={item} selected={selectedId === item.id} onSelect={() => setSelectedId(item.id)} /></div>; })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
