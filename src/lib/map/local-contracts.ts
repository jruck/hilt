import { z } from "zod";
import type { LocalMapNode, LocalSession } from "./local-types";

export const activityWindowSchema = z.enum(["24h", "7d", "30d", "all"]);
export const mapStatusFilterSchema = z.preprocess((value) => {
  if (value === "tracked") return "foreground";
  if (value === "unmatched" || value === "ignored") return "background";
  return value;
}, z.enum(["all", "foreground", "background"]));
export const mapSourceFilterSchema = z.enum(["all", "codex", "claude"]);

export const graphQuerySchema = z.object({
  window: activityWindowSchema.default("7d"),
  status: mapStatusFilterSchema.default("foreground"),
  source: mapSourceFilterSchema.default("all"),
  q: z.string().max(200).optional().default(""),
}).strict();

export const sessionsQuerySchema = graphQuerySchema.extend({
  nodeId: z.string().max(500).optional().default("root"),
  cursor: z.string().max(40).optional().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(200).default(80),
}).strict();

export const sessionDetailQuerySchema = z.object({
  id: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(20).max(240).default(120),
}).strict();

const activityHeatSchema = z.object({
  heat24h: z.number(),
  heat7d: z.number(),
  heat30d: z.number(),
  heatAll: z.number(),
}).strict();

const workFootprintSchema = z.object({
  path: z.string(),
  label: z.string(),
  weight: z.number(),
  eventCount: z.number(),
  kinds: z.array(z.enum(["read", "write", "shell", "search"])),
}).strict();

export const publicSessionSchema: z.ZodType<Omit<LocalSession, "sourcePath">> = z.object({
  id: z.string(),
  provider: z.enum(["codex", "claude"]),
  harness: z.string(),
  externalId: z.string(),
  externalKey: z.string(),
  title: z.string().optional(),
  cwd: z.string().optional(),
  workspaceRoot: z.string().optional(),
  workspaceLabel: z.string().optional(),
  spaceLabel: z.string().optional(),
  repoRemote: z.string().optional(),
  gitBranch: z.string().optional(),
  modelProvider: z.string().optional(),
  model: z.string().optional(),
  role: z.enum(["orchestrator", "worker", "peer", "unknown"]),
  observedState: z.enum(["active", "idle", "archived", "unknown"]),
  trackingState: z.enum(["foreground", "background"]),
  createdAt: z.number().optional(),
  lastSeenAt: z.number(),
  lastActivityAt: z.number().optional(),
  eventCount: z.number(),
  tokenEstimate: z.number().optional(),
  parentExternalId: z.string().optional(),
  childExternalIds: z.array(z.string()).optional(),
  workFootprint: z.array(workFootprintSchema).optional(),
  activity: activityHeatSchema,
  signals: z.array(z.string()),
  ignoreReasons: z.array(z.string()),
}).strict();

export const mapNodeSchema: z.ZodType<LocalMapNode> = z.lazy(() => z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["root", "space", "workspace", "folder", "workItem"]),
  parentId: z.string().optional(),
  path: z.string().optional(),
  repoRemote: z.string().optional(),
  branch: z.string().optional(),
  sessionIds: z.array(z.string()),
  children: z.array(mapNodeSchema),
  providerCounts: z.record(z.string(), z.number()),
  trackingCounts: z.object({
    foreground: z.number(),
    background: z.number(),
  }).strict(),
  sessionCount: z.number(),
  activeSessionCount: z.number(),
  activity: activityHeatSchema,
  signals: z.array(z.string()),
}).strict());

const sourceStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["codex", "claude", "system"]),
  harness: z.string().optional(),
  path: z.string(),
  ok: z.boolean(),
  sessionCount: z.number(),
  lastReadAt: z.number(),
  filesScanned: z.number().optional(),
  filesChanged: z.number().optional(),
  durationMs: z.number().optional(),
  message: z.string().optional(),
}).strict();

const diagnosticsSchema = z.object({
  lastScanAt: z.number().optional(),
  durationMs: z.number().optional(),
  filesScanned: z.number(),
  filesChanged: z.number(),
  errors: z.array(z.object({
    provider: z.enum(["codex", "claude", "system"]).optional(),
    path: z.string().optional(),
    message: z.string(),
  }).strict()),
  indexedSessionCount: z.number(),
  sourceStatuses: z.array(sourceStatusSchema),
}).strict();

export const graphResponseSchema = z.object({
  generatedAt: z.number(),
  indexedAt: z.number().optional(),
  activeWindow: activityWindowSchema,
  root: mapNodeSchema,
  summary: z.object({
    totalSessions: z.number(),
    foregroundSessions: z.number(),
    backgroundSessions: z.number(),
    activeSessions: z.number(),
    workspaceCount: z.number(),
  }).strict(),
  statusCounts: z.object({
    all: z.number(),
    foreground: z.number(),
    background: z.number(),
  }).strict(),
  sourceCounts: z.object({
    all: z.number(),
    codex: z.number(),
    claude: z.number(),
  }).strict(),
  diagnostics: diagnosticsSchema,
}).strict();

export const sessionsResponseSchema = z.object({
  generatedAt: z.number(),
  items: z.array(publicSessionSchema),
  total: z.number(),
  cursor: z.string().nullable(),
  nextCursor: z.string().nullable(),
  limit: z.number(),
}).strict();

export type GraphQuery = z.infer<typeof graphQuerySchema>;
export type SessionsQuery = z.infer<typeof sessionsQuerySchema>;
