import fs from "fs";
import path from "path";
import { openMapDbForPath, setMapMeta, upsertMapSessions, upsertSourceFileRecord } from "../src/lib/map/local-index-db";
import type { ActivityHeat, LocalSession, LocalSessionProvider, LocalSourceStatus, WorkFootprintKind } from "../src/lib/map/local-types";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "docs/demo/.hilt-data");
const dbPath = process.env.HILT_MAP_DB_PATH || path.join(dataDir, "map.sqlite");
const now = Date.now();
const demoRoot = "/demo/hilt";

interface DemoSessionInput {
  title: string;
  workspace: string;
  folder: string;
  branch?: string;
  provider: LocalSessionProvider;
  role?: LocalSession["role"];
  active?: boolean;
  background?: boolean;
  heat: number;
  hoursAgo: number;
  events: number;
  model?: string;
  kinds?: WorkFootprintKind[];
}

function heat(value: number): ActivityHeat {
  return {
    heat24h: value,
    heat7d: value * 1.25,
    heat30d: value * 1.6,
    heatAll: value * 2,
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function session(input: DemoSessionInput, index: number): LocalSession {
  const workspaceSlug = slug(input.workspace);
  const folderPath = path.posix.join(demoRoot, workspaceSlug, input.folder);
  const externalId = `demo-session-${String(index + 1).padStart(2, "0")}`;
  const providerHarness = input.provider === "codex" ? "demo-state" : "demo-jsonl";

  return {
    id: `${input.provider}:${externalId}`,
    provider: input.provider,
    harness: providerHarness,
    externalId,
    externalKey: `${input.provider}:${providerHarness}:${externalId}`,
    title: input.title,
    cwd: path.posix.join(demoRoot, workspaceSlug),
    workspaceRoot: path.posix.join(demoRoot, workspaceSlug),
    workspaceLabel: input.workspace,
    spaceLabel: "Hilt Demo",
    repoRemote: `git@example.invalid:hilt/${workspaceSlug}.git`,
    gitBranch: input.branch || "main",
    modelProvider: input.provider === "codex" ? "OpenAI" : "Anthropic",
    model: input.model || (input.provider === "codex" ? "gpt-5-codex" : "claude-sonnet"),
    role: input.role || "orchestrator",
    observedState: input.active ? "active" : "idle",
    trackingState: input.background ? "background" : "foreground",
    sourcePath: `/demo/sources/${input.provider}/${externalId}.jsonl`,
    createdAt: now - (input.hoursAgo + 3) * 60 * 60 * 1000,
    lastSeenAt: now - input.hoursAgo * 60 * 60 * 1000,
    lastActivityAt: now - input.hoursAgo * 60 * 60 * 1000,
    eventCount: input.events,
    tokenEstimate: input.events * 840,
    workFootprint: [{
      path: folderPath,
      label: input.folder,
      weight: Math.max(1, Math.round(input.heat)),
      eventCount: input.events,
      kinds: input.kinds || ["read", "write", "search"],
    }],
    activity: heat(input.heat),
    signals: [
      input.active ? "active demo work" : "recent demo work",
      input.provider,
      input.role || "orchestrator",
    ],
    ignoreReasons: input.background ? ["demo background worker"] : [],
  };
}

const sessionInputs: DemoSessionInput[] = [
  { title: "Wire Reference Library source adapters", workspace: "Reference Library", folder: "src/lib/library", branch: "feature/source-adapters", provider: "codex", active: true, heat: 9.6, hoursAgo: 1, events: 42 },
  { title: "Tune candidate review actions", workspace: "Reference Library", folder: "src/components/library", branch: "feature/review-actions", provider: "claude", active: true, heat: 8.8, hoursAgo: 2, events: 38 },
  { title: "Repair hot digestion queue", workspace: "Reference Library", folder: "scripts", provider: "codex", heat: 7.9, hoursAgo: 5, events: 35 },
  { title: "Summarize media cache contract", workspace: "Reference Library", folder: "docs", provider: "claude", heat: 6.2, hoursAgo: 8, events: 26 },
  { title: "Backfill dry-run report pass", workspace: "Reference Library", folder: "src/lib/library", branch: "feature/backfill-reports", provider: "codex", heat: 5.8, hoursAgo: 14, events: 24 },
  { title: "Newsletter candidate parser", workspace: "Reference Library", folder: "src/lib/library/adapters", provider: "claude", heat: 4.5, hoursAgo: 22, events: 19 },
  { title: "Candidate cleanup worker", workspace: "Reference Library", folder: "src/lib/library", provider: "codex", role: "worker", background: true, heat: 3.1, hoursAgo: 28, events: 15 },

  { title: "Map treemap layout polish", workspace: "System Sessions", folder: "src/components/map", branch: "feature/map-polish", provider: "codex", active: true, heat: 7.4, hoursAgo: 3, events: 31 },
  { title: "System peer aggregation review", workspace: "System Sessions", folder: "src/lib/system", provider: "claude", heat: 6.8, hoursAgo: 6, events: 29 },
  { title: "Session history detail smoke", workspace: "System Sessions", folder: "src/app/api/system", provider: "codex", heat: 5.5, hoursAgo: 11, events: 21 },
  { title: "Map fixture screenshot seed", workspace: "System Sessions", folder: "scripts", provider: "codex", heat: 4.9, hoursAgo: 18, events: 18 },
  { title: "Remote machine probe worker", workspace: "System Sessions", folder: "src/lib/system", provider: "claude", role: "worker", background: true, heat: 2.5, hoursAgo: 30, events: 12 },

  { title: "Markdown rendering parity", workspace: "Docs", folder: "src/components/docs", branch: "fix/markdown-render", provider: "claude", heat: 6.6, hoursAgo: 7, events: 28 },
  { title: "Wikilink resolver edge cases", workspace: "Docs", folder: "src/lib/docs", provider: "codex", heat: 4.7, hoursAgo: 19, events: 17 },
  { title: "Docs screenshot refresh", workspace: "Docs", folder: "docs/screenshots", provider: "codex", heat: 3.9, hoursAgo: 26, events: 11 },

  { title: "Meeting transcript matching", workspace: "People", folder: "src/lib/people", provider: "claude", heat: 5.4, hoursAgo: 12, events: 22 },
  { title: "People inbox suggestion flow", workspace: "People", folder: "src/components/people", provider: "codex", heat: 3.8, hoursAgo: 32, events: 14 },
  { title: "Group note timeline worker", workspace: "People", folder: "src/lib/people", provider: "claude", role: "worker", background: true, heat: 2.2, hoursAgo: 42, events: 9 },

  { title: "Daily briefing read state", workspace: "Briefing", folder: "src/components/briefings", provider: "codex", heat: 5.1, hoursAgo: 9, events: 20 },
  { title: "Briefing source recap card", workspace: "Briefing", folder: "docs/demo/briefings", provider: "claude", heat: 4.2, hoursAgo: 16, events: 16 },
  { title: "Unread badge regression check", workspace: "Briefing", folder: "src/hooks", provider: "codex", heat: 3.2, hoursAgo: 36, events: 12 },
];

function resetDbFiles() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const candidate of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    fs.rmSync(candidate, { force: true });
  }
}

function sourceStatus(provider: LocalSessionProvider, count: number): LocalSourceStatus {
  return {
    id: `demo-${provider}`,
    label: provider === "codex" ? "Demo Codex sessions" : "Demo Claude sessions",
    kind: provider,
    harness: provider === "codex" ? "demo-state" : "demo-jsonl",
    path: `/demo/sources/${provider}`,
    ok: true,
    sessionCount: count,
    lastReadAt: now,
    filesScanned: count,
    filesChanged: count,
  };
}

resetDbFiles();

const db = openMapDbForPath(dbPath);
const sessions = sessionInputs.map(session);
upsertMapSessions(db, sessions);

for (const provider of ["codex", "claude"] as const) {
  const count = sessions.filter((item) => item.provider === provider).length;
  upsertSourceFileRecord(db, {
    path: `/demo/sources/${provider}`,
    provider,
    harness: provider === "codex" ? "demo-state" : "demo-jsonl",
    mtimeMs: now,
    sizeBytes: count * 1024,
    lastScannedAt: now,
    status: "ok",
  });
}

setMapMeta(db, "last_scan_at", now + 24 * 60 * 60 * 1000);
setMapMeta(db, "last_scan_diagnostics", {
  lastScanAt: now,
  durationMs: 12,
  filesScanned: sessions.length,
  filesChanged: sessions.length,
  errors: [],
  indexedSessionCount: sessions.length,
  sourceStatuses: [
    sourceStatus("codex", sessions.filter((item) => item.provider === "codex").length),
    sourceStatus("claude", sessions.filter((item) => item.provider === "claude").length),
  ],
});

db.close();

console.log(`Seeded ${sessions.length} demo Map sessions at ${dbPath}`);
