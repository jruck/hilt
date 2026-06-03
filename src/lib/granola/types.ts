export type GranolaSyncMode = "incremental" | "backfill" | "compare" | "augment-existing";

export interface GranolaPerson {
  name: string;
  email: string | null;
}

export interface GranolaCalendarEvent {
  id: string | null;
  iCalUID: string | null;
  calendarId: string | null;
  title: string | null;
  start: string | null;
  end: string | null;
  htmlLink: string | null;
  organizer: GranolaPerson | null;
  attendees: GranolaPerson[];
  raw: Record<string, unknown>;
}

export interface GranolaTranscriptEntry {
  source: string;
  text: string;
  startTimestamp: string | null;
  endTimestamp: string | null;
  speaker: string | null;
  raw: Record<string, unknown>;
}

export interface GranolaDocument {
  id: string;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  granolaUrl: string | null;
  attendees: GranolaPerson[];
  folders: string[];
  notesMarkdown: string | null;
  panelContent: unknown;
  privateNotesMarkdown: string | null;
  calendarEvent: GranolaCalendarEvent | null;
  transcript: GranolaTranscriptEntry[];
  raw: Record<string, unknown>;
}

export interface GranolaCalendarMatch {
  hiltCalendarEventId: string | null;
  method: "none" | "granola-calendar-id" | "icaluid" | "title-time-attendees" | "title-time";
  confidence: number;
  reason: string;
}

export interface GranolaMeetingNoteLink {
  granolaId: string;
  title: string;
  notePath: string | null;
  transcriptPath: string | null;
  granolaUrl: string | null;
  meetingEndCount: number | null;
  calendarMatchMethod: string | null;
  calendarMatchConfidence: number | null;
}

export interface GranolaSyncRunInput {
  mode: GranolaSyncMode;
  dryRun?: boolean;
  daysBack?: number;
  limit?: number;
  includeTranscripts?: boolean;
  outputDir?: string;
  skipHandoffCheck?: boolean;
}

export interface GranolaSyncRunReport {
  mode: GranolaSyncMode;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  fetched: number;
  considered: number;
  createdNotes: number;
  createdTranscripts: number;
  augmentedNotes: number;
  augmentedTranscripts: number;
  skipped: number;
  linkedCalendarEvents: number;
  blocked: boolean;
  errors: string[];
  compareReportPath: string | null;
}

export interface GranolaSyncStatus {
  configured: boolean;
  daemonEnabled: boolean;
  daemonConfigured: boolean;
  daemonHeartbeat: {
    active: boolean;
    updatedAt: string | null;
    pid: number | null;
    stale: boolean;
    error: string | null;
  };
  remoteHost: string;
  lastRun: {
    mode: GranolaSyncMode | string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    dryRun: boolean;
    counts: Record<string, unknown>;
    error: string | null;
    reportPath: string | null;
  } | null;
  documents: {
    total: number;
    linkedCalendarEvents: number;
    pendingTranscripts: number;
    lastSyncedAt: string | null;
    lastSeenAt: string | null;
  };
  handoff: GranolaObsidianHandoffStatus;
}

export interface GranolaObsidianVaultStatus {
  host: string;
  vaultPath: string;
  obsidianRunning: boolean;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  pluginSyncEnabled: boolean | null;
  communityPluginsPath: string | null;
  pluginDataPath: string | null;
  error: string | null;
}

export interface GranolaObsidianHandoffStatus {
  safeForProductionWrites: boolean;
  local: GranolaObsidianVaultStatus;
  remote: GranolaObsidianVaultStatus;
}
