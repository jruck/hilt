import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "../library/utils";
import type { Ledger, LedgerEntry } from "./meeting-ledger";
import { entryAgeDays, nextSeq } from "./meeting-ledger";
import { backupMeetingLedger, exportLegacyMeetingState, writeReadableMeetingLedgerExport } from "./meeting-ledger-maintenance";
import {
  type IdentityContextSelection,
  ledgerSurfaceState,
  type LedgerEventRecord,
  type MeetingLedgerCounts,
  type MeetingLedgerListFilters,
  type MeetingLedgerListResult,
  emitMeetingLedgerChanged,
  MeetingLedgerStore,
  meetingLedgerDbPath,
  readMeetingLedgerStorageMarker,
} from "./meeting-ledger-store";

export interface RuntimeMeetingSummary {
  date: string;
  summary: string;
}

export interface MeetingLedgerRuntime {
  readonly mode: "legacy" | "sqlite";
  getEntry(id: string): LedgerEntry | null;
  allEntries(): LedgerEntry[];
  openEntries(): LedgerEntry[];
  recentlyDismissed(now: string, days?: number): LedgerEntry[];
  identityContext(input: { now: string; observations?: string[]; tokenBudget?: number }): IdentityContextSelection;
  nextEntryId(date: string): string;
  processedMeetings(): Record<string, string>;
  meetingSummaries(dateFrom?: string, dateTo?: string): Record<string, RuntimeMeetingSummary>;
  meetingSummary(meeting: string): RuntimeMeetingSummary | null;
  applyEntries(entries: LedgerEntry[], input: { type: string; at: string; runId?: string }): void;
  applyMeeting(input: {
    meeting: string;
    processedAt: string;
    entries: LedgerEntry[];
    summary?: RuntimeMeetingSummary;
    runId?: string;
    eventType?: string;
  }): void;
  escalationCandidates(today: string, recentDays?: number): LedgerEntry[];
  acceptedAging(now: string, minimumDays?: number): Array<{ entry: LedgerEntry; age: number }>;
  goalsContext(until: string, limit?: number): LedgerEntry[];
  counts(): MeetingLedgerCounts;
  list(filters?: MeetingLedgerListFilters): MeetingLedgerListResult;
  eventsForEntry(id: string, limit?: number): LedgerEventRecord[];
  beginRun(input: { id: string; startedAt: string; attempted?: number }): void;
  finishRun(input: { id: string; finishedAt: string; status: "succeeded" | "partial" | "failed"; attempted: number; succeeded: number; contextTokens: number; error?: string }): void;
  finishSuccessfulRun(vaultPath: string, legacyHome: string, now?: Date): Promise<void>;
  close(): void;
}

function tokenEstimate(entries: LedgerEntry[]): number {
  return Math.ceil(entries.reduce((total, entry) => total + entry.action.length + (entry.context?.length ?? 0) + 80, 0) / 4);
}

class LegacyMeetingLedgerRuntime implements MeetingLedgerRuntime {
  readonly mode = "legacy" as const;
  private readonly home: string;
  private readonly ledger: Ledger;
  private readonly processed: Record<string, string>;
  private readonly summaries: Record<string, RuntimeMeetingSummary>;

  constructor(home: string) {
    this.home = home;
    const read = <T>(filePath: string, fallback: T): T => {
      try { return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T; } catch { return fallback; }
    };
    this.ledger = read(path.join(home, "state", "ledger.json"), { version: 1, entries: {} });
    this.processed = read<{ processed?: Record<string, string> }>(
      path.join(home, "state", "processed-meetings.json"),
      { processed: {} },
    ).processed ?? {};
    this.summaries = read(path.join(home, "state", "meeting-summaries.json"), {});
  }

  getEntry(id: string): LedgerEntry | null { return this.ledger.entries[id] ?? null; }
  allEntries(): LedgerEntry[] { return Object.values(this.ledger.entries); }
  openEntries(): LedgerEntry[] { return Object.values(this.ledger.entries).filter((entry) => entry.status === "open" || entry.status === "carried"); }
  recentlyDismissed(now: string, days = 30): LedgerEntry[] {
    const cutoff = Date.parse(now) - days * 86_400_000;
    return Object.values(this.ledger.entries).filter((entry) => {
      if (entry.status !== "dropped" || entry.verdict?.verdict !== "dismiss") return false;
      const dropped = [...entry.status_history].reverse().find((history) => history.to === "dropped")?.at;
      return Date.parse(dropped ?? entry.verdict.at) >= cutoff;
    }).sort((a, b) => Date.parse(b.verdict!.at) - Date.parse(a.verdict!.at));
  }
  identityContext(input: { now: string; observations?: string[]; tokenBudget?: number }): IdentityContextSelection {
    const required = [...this.openEntries(), ...this.recentlyDismissed(input.now)]
      .filter((entry, index, values) => values.findIndex((value) => value.id === entry.id) === index);
    const budget = input.tokenBudget ?? 40_000;
    const chunks: LedgerEntry[][] = [];
    let chunk: LedgerEntry[] = [];
    for (const entry of required) {
      if (chunk.length && tokenEstimate([...chunk, entry]) > budget) { chunks.push(chunk); chunk = []; }
      chunk.push(entry);
    }
    if (chunk.length) chunks.push(chunk);
    return {
      required,
      older_matches: [],
      estimated_tokens: tokenEstimate(required),
      chunks,
      complete_recent_window: true,
    };
  }
  nextEntryId(date: string): string { return `ma-${date}-${String(nextSeq(this.ledger, date)).padStart(3, "0")}`; }
  processedMeetings(): Record<string, string> { return { ...this.processed }; }
  meetingSummaries(dateFrom?: string, dateTo?: string): Record<string, RuntimeMeetingSummary> {
    return Object.fromEntries(Object.entries(this.summaries).filter(([, value]) =>
      (!dateFrom || value.date >= dateFrom) && (!dateTo || value.date <= dateTo),
    ));
  }
  meetingSummary(meeting: string): RuntimeMeetingSummary | null { return this.summaries[meeting] ?? null; }
  applyEntries(entries: LedgerEntry[]): void {
    for (const entry of entries) this.ledger.entries[entry.id] = entry;
    this.writeLedger();
  }
  applyMeeting(input: {
    meeting: string;
    processedAt: string;
    entries: LedgerEntry[];
    summary?: RuntimeMeetingSummary;
  }): void {
    for (const entry of input.entries) this.ledger.entries[entry.id] = entry;
    if (input.summary) this.summaries[input.meeting] = input.summary;
    this.processed[input.meeting] = input.processedAt;
    this.writeLedger();
    atomicWriteFile(path.join(this.home, "state", "meeting-summaries.json"), `${JSON.stringify(this.summaries, null, 1)}\n`);
    atomicWriteFile(path.join(this.home, "state", "processed-meetings.json"), `${JSON.stringify({ processed: this.processed }, null, 1)}\n`);
  }
  escalationCandidates(today: string, recentDays = 3): LedgerEntry[] {
    return this.openEntries().filter((entry) => {
      if (entry.verdict || entry.owner.startsWith("other:")) return false;
      const date = entry.opened_from.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? today;
      return Boolean(entry.first_escalated_at) || (Date.parse(today) - Date.parse(date)) / 86_400_000 <= recentDays;
    });
  }
  acceptedAging(now: string, minimumDays = 7): Array<{ entry: LedgerEntry; age: number }> {
    return this.openEntries()
      .filter((entry) => ["approve", "assign_to_me", "assign_to_agent"].includes(entry.verdict?.verdict ?? ""))
      .map((entry) => ({ entry, age: Math.floor((Date.parse(now) - Date.parse(entry.verdict!.at)) / 86_400_000) }))
      .filter(({ age }) => age >= minimumDays);
  }
  goalsContext(until: string, limit = 80): LedgerEntry[] {
    return this.openEntries().filter((entry) => entry.opened_at.slice(0, 10) <= until).slice(0, limit);
  }
  counts(): MeetingLedgerCounts {
    const entries = Object.values(this.ledger.entries);
    return {
      total: entries.length,
      open: entries.filter((entry) => entry.status === "open").length,
      carried: entries.filter((entry) => entry.status === "carried").length,
      resolved: entries.filter((entry) => entry.status === "resolved").length,
      dropped: entries.filter((entry) => entry.status === "dropped").length,
      latent: entries.filter((entry) => entry.status === "open" && !entry.verdict && !entry.task_id && !entry.first_escalated_at && ["justin", "unclear"].includes(entry.owner)).length,
      pending: entries.filter((entry) => entry.task_id && !entry.verdict && ["open", "carried"].includes(entry.status)).length,
      accepted_open: entries.filter((entry) => ["open", "carried"].includes(entry.status) && ["approve", "assign_to_me", "assign_to_agent"].includes(entry.verdict?.verdict ?? "")).length,
      stamped: entries.filter((entry) => entry.task_id).length,
      event_sequence: 0,
    };
  }
  list(filters: MeetingLedgerListFilters = {}): MeetingLedgerListResult {
    const all = this.allEntries();
    const lastSeen = (entry: LedgerEntry) => entry.sightings.reduce((latest, sighting) => sighting.at > latest ? sighting.at : latest, entry.opened_at);
    const filtered = all.filter((entry) => {
      if (filters.status && entry.status !== filters.status) return false;
      if (filters.surface && ledgerSurfaceState(entry) !== filters.surface) return false;
      if (filters.owner && entry.owner !== filters.owner) return false;
      if (filters.meeting && entry.opened_from !== filters.meeting) return false;
      const seen = lastSeen(entry);
      if (filters.dateFrom && seen < `${filters.dateFrom}T00:00:00.000Z`) return false;
      if (filters.dateTo && seen > `${filters.dateTo}T23:59:59.999Z`) return false;
      if (filters.query) {
        const haystack = `${entry.action} ${entry.context ?? ""} ${entry.owner} ${entry.opened_from}`.toLowerCase();
        if (!filters.query.toLowerCase().split(/\s+/).filter(Boolean).every((term) => haystack.includes(term))) return false;
      }
      if (filters.cursor) {
        const [at, id] = filters.cursor.split("|");
        if (!(seen < at || (seen === at && entry.id < (id ?? "")))) return false;
      }
      return true;
    }).sort((a, b) => lastSeen(b).localeCompare(lastSeen(a)) || b.id.localeCompare(a.id));
    const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
    const page = filtered.slice(0, limit);
    const last = page.at(-1);
    const status = { open: 0, carried: 0, resolved: 0, dropped: 0 };
    const surface = { pending: 0, accepted: 0, latent: 0, observed: 0, dismissed: 0, resolved: 0 };
    const owner: Record<string, number> = {};
    for (const entry of all) {
      status[entry.status] += 1;
      surface[ledgerSurfaceState(entry)] += 1;
      owner[entry.owner] = (owner[entry.owner] ?? 0) + 1;
    }
    return {
      items: page,
      total: filtered.length,
      next_cursor: filtered.length > limit && last ? `${lastSeen(last)}|${last.id}` : null,
      facets: { status, surface, owner },
    };
  }
  eventsForEntry(id: string, limit = 100): LedgerEventRecord[] {
    const entry = this.getEntry(id);
    if (!entry) return [];
    return entry.status_history.slice(-limit).reverse().map((history, index) => ({
      sequence: entry.status_history.length - index,
      event_id: `legacy:${entry.id}:${entry.status_history.length - index}`,
      event_type: "status-transition",
      entry_id: entry.id,
      meeting_path: entry.opened_from,
      occurred_at: history.at,
      run_id: null,
      payload: history,
    }));
  }
  beginRun(): void { /* compatibility JSON has no normalized run table */ }
  finishRun(): void { /* compatibility JSON has no normalized run table */ }
  async finishSuccessfulRun(vaultPath: string): Promise<void> {
    emitMeetingLedgerChanged(vaultPath, { storage: this.mode, counts: this.counts() });
  }
  close(): void { /* no handle */ }
  private writeLedger(): void {
    atomicWriteFile(path.join(this.home, "state", "ledger.json"), `${JSON.stringify(this.ledger, null, 1)}\n`);
  }
}

class SqliteMeetingLedgerRuntime implements MeetingLedgerRuntime {
  readonly mode = "sqlite" as const;
  readonly store: MeetingLedgerStore;
  private readonly exportCompatibility: boolean;

  constructor(store: MeetingLedgerStore, exportCompatibility: boolean) {
    this.store = store;
    this.exportCompatibility = exportCompatibility;
  }
  getEntry(id: string): LedgerEntry | null { return this.store.getEntry(id); }
  allEntries(): LedgerEntry[] { return Object.values(this.store.readAll().entries); }
  openEntries(): LedgerEntry[] { return this.store.openEntries(); }
  recentlyDismissed(now: string, days = 30): LedgerEntry[] { return this.store.recentlyDismissed(now, days); }
  identityContext(input: { now: string; observations?: string[]; tokenBudget?: number }): IdentityContextSelection { return this.store.identityContext(input); }
  nextEntryId(date: string): string { return this.store.nextEntryId(date); }
  processedMeetings(): Record<string, string> { return this.store.processedMeetings(); }
  meetingSummaries(dateFrom?: string, dateTo?: string): Record<string, RuntimeMeetingSummary> {
    return Object.fromEntries(this.store.meetingSummaries(dateFrom, dateTo).map((record) => [record.meeting, { date: record.date, summary: record.summary }]));
  }
  meetingSummary(meeting: string): RuntimeMeetingSummary | null {
    const record = this.store.meetingSummary(meeting);
    return record ? { date: record.date, summary: record.summary } : null;
  }
  applyEntries(entries: LedgerEntry[], input: { type: string; at: string; runId?: string }): void { this.store.putEntries(entries, input); }
  applyMeeting(input: {
    meeting: string;
    processedAt: string;
    entries: LedgerEntry[];
    summary?: RuntimeMeetingSummary;
    runId?: string;
    eventType?: string;
  }): void { this.store.applyMeeting(input); }
  escalationCandidates(today: string, recentDays = 3): LedgerEntry[] { return this.store.escalationCandidates(today, recentDays); }
  acceptedAging(now: string, minimumDays = 7): Array<{ entry: LedgerEntry; age: number }> { return this.store.acceptedAging(now, minimumDays); }
  goalsContext(until: string, limit = 80): LedgerEntry[] { return this.store.goalsContext(until, limit); }
  counts(): MeetingLedgerCounts { return this.store.counts(); }
  list(filters: MeetingLedgerListFilters = {}): MeetingLedgerListResult { return this.store.list(filters); }
  eventsForEntry(id: string, limit = 100): LedgerEventRecord[] { return this.store.eventsForEntry(id, limit); }
  beginRun(input: { id: string; startedAt: string; attempted?: number }): void { this.store.beginExtractionRun(input); }
  finishRun(input: { id: string; finishedAt: string; status: "succeeded" | "partial" | "failed"; attempted: number; succeeded: number; contextTokens: number; error?: string }): void { this.store.finishExtractionRun(input); }
  async finishSuccessfulRun(vaultPath: string, legacyHome: string, now = new Date()): Promise<void> {
    try {
      const integrity = this.store.integrityCheck();
      if (integrity !== "ok") throw new Error(`meeting ledger integrity_check failed: ${integrity}`);
      await backupMeetingLedger(this.store, vaultPath, now);
      writeReadableMeetingLedgerExport(this.store, vaultPath, now.toISOString());
      if (this.exportCompatibility) exportLegacyMeetingState(this.store, legacyHome, now.toISOString());
      emitMeetingLedgerChanged(vaultPath, { storage: this.mode, counts: this.counts(), integrity });
    } catch (error) {
      try { this.store.blockWrites(`post-write verification/backup failed: ${error instanceof Error ? error.message : String(error)}`, now.toISOString()); } catch { /* corruption may prevent the latch itself */ }
      throw error;
    }
  }
  close(): void { this.store.close(); }
}

export function openMeetingLedgerRuntime(input: {
  vaultPath: string;
  legacyHome: string;
  ledgerHomeOverride?: string | null;
  forceSqlite?: boolean;
}): MeetingLedgerRuntime {
  const marker = readMeetingLedgerStorageMarker(input.vaultPath);
  const sqlite = input.forceSqlite || Boolean(input.ledgerHomeOverride) || marker.mode === "sqlite";
  if (!sqlite) return new LegacyMeetingLedgerRuntime(input.legacyHome);
  const dbPath = meetingLedgerDbPath(input.vaultPath, input.ledgerHomeOverride);
  if (marker.mode === "sqlite" && !input.ledgerHomeOverride && !fs.existsSync(dbPath)) {
    throw new Error(`canonical meeting ledger is missing at ${dbPath}; refusing to initialize a blank database`);
  }
  return new SqliteMeetingLedgerRuntime(new MeetingLedgerStore(dbPath), Boolean(input.ledgerHomeOverride));
}

export function formatLedgerDigest(entries: LedgerEntry[], now: string): string {
  if (!entries.length) return "(ledger empty — every commitment you extract is NEW)";
  return entries.map((entry) => {
    const context = entry.context ? ` · context ${entry.context.replace(/\s+/g, " ").slice(0, 180)}` : "";
    const verdict = entry.verdict ? ` · verdict ${entry.verdict.verdict}${entry.verdict.note ? ` (${entry.verdict.note.replace(/\s+/g, " ").slice(0, 100)})` : ""}` : "";
    return `${entry.id} · ${entry.status} · ${entry.owner} · ${entry.action.replace(/\s+/g, " ").slice(0, 140)} · opened ${entry.opened_at.slice(0, 10)} (${entryAgeDays(entry, now)}d)${verdict}${context}`;
  }).join("\n");
}
