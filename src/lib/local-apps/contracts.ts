import { z } from "zod";

export const serviceKindSchema = z.enum([
  "frontend",
  "backend",
  "fullstack",
  "database",
  "queue",
  "infra",
  "browser_debug",
  "system",
  "unknown",
]);

export const healthStatusSchema = z.enum(["up", "down", "unknown"]);
export const ruleActionSchema = z.enum(["hide", "show"]);
export const ruleScopeSchema = z.enum([
  "process_name",
  "command_contains",
  "path_prefix",
  "port",
  "service_id",
  "group_id",
]);

export const listenerSchema = z.object({
  protocol: z.string(),
  host: z.string(),
  port: z.number().int().min(0).max(65535),
  pid: z.number().int().nonnegative(),
  command: z.string(),
  user: z.string().nullable().optional(),
  parent_pid: z.number().int().nonnegative().nullable().optional(),
});

export const processInfoSchema = z.object({
  pid: z.number().int().nonnegative(),
  parent_pid: z.number().int().nonnegative().nullable().optional(),
  parent_chain: z.array(z.number().int().nonnegative()),
  cwd: z.string().nullable().optional(),
  executable: z.string().nullable().optional(),
  args: z.string(),
  start_time: z.string().nullable().optional(),
});

export const healthSchema = z.object({
  status: healthStatusSchema,
  label: z.string(),
  http_status: z.number().int().min(100).max(599).nullable().optional(),
  latency_ms: z.number().nonnegative().nullable().optional(),
  checked_at: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
});

export const previewSchema = z.object({
  path: z.string().nullable().optional(),
  captured_at: z.string(),
  error: z.string().nullable().optional(),
  error_at: z.string().nullable().optional(),
  stale: z.boolean().optional(),
});

export const projectInfoSchema = z.object({
  git_root: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  worktree: z.string().nullable().optional(),
  package_name: z.string().nullable().optional(),
});

export const serviceSchema = z.object({
  id: z.string(),
  listener: listenerSchema,
  process: processInfoSchema,
  kind: serviceKindSchema,
  title: z.string(),
  description: z.string(),
  confidence: z.number().int().min(0).max(100),
  visible: z.boolean(),
  hidden_reason: z.string().nullable().optional(),
  source_signals: z.array(z.string()),
  project: projectInfoSchema,
  preview_url: z.string().nullable().optional(),
  url_candidates: z.array(z.string()),
  health: healthSchema,
  page_title: z.string().nullable().optional(),
  favicon_url: z.string().nullable().optional(),
  framework_hints: z.array(z.string()),
  preview: previewSchema.nullable().optional(),
});

export const serviceGroupSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  path: z.string().nullable().optional(),
  git_root: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  package_name: z.string().nullable().optional(),
  confidence: z.number().int().min(0).max(100),
  visible: z.boolean(),
  hidden_reason: z.string().nullable().optional(),
  services: z.array(serviceSchema),
  ports: z.array(z.number().int().min(0).max(65535)),
  primary_url: z.string().nullable().optional(),
  source_signals: z.array(z.string()),
  ai: z.null().optional(),
  updated_at: z.string(),
});

export const userRuleSchema = z.object({
  id: z.string(),
  action: ruleActionSchema,
  scope: ruleScopeSchema,
  pattern: z.string(),
  note: z.string().nullable().optional(),
  created_at: z.string(),
});

export const settingsSchema = z.object({
  dev_roots: z.array(z.string()),
  rules: z.array(userRuleSchema),
  scan_interval_ms: z.number().int().positive(),
  api_port: z.number().int().min(0).max(65535),
  ai: z.object({
    enabled: z.boolean(),
    endpoint: z.string(),
    model: z.string(),
  }),
});

export const settingsMetadataSchema = z.object({
  settings: settingsSchema,
  api_url: z.null(),
  settings_path: z.string(),
  preview_dir: z.string(),
});

export const machineIdentitySchema = z.object({
  hostname: z.string(),
  tailscale_dns: z.string().nullable().optional(),
  tailscale_ip4: z.string().nullable().optional(),
  origin: z.enum(["local", "remote"]),
});

export const scanDiagnosticsSchema = z.object({
  scanned_at: z.string().nullable(),
  is_scanning: z.boolean(),
  duration_ms: z.number().nullable(),
  listener_count: z.number().int().nonnegative(),
  group_count: z.number().int().nonnegative(),
  visible_group_count: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

export const localAppsEnabledResponseSchema = z.object({
  app: z.literal("hilt-local-apps"),
  enabled: z.literal(true),
  machine: machineIdentitySchema,
  groups: z.array(serviceGroupSchema),
  diagnostics: scanDiagnosticsSchema,
  machines: z.array(z.object({
    id: z.string(),
    self: z.boolean(),
    reachable: z.boolean(),
    source_url: z.string().nullable().optional(),
    machine: machineIdentitySchema,
    groups: z.array(serviceGroupSchema),
    diagnostics: scanDiagnosticsSchema,
    error: z.string().nullable().optional(),
  })).optional(),
  summary: z.object({
    machine_count: z.number().int().nonnegative(),
    group_count: z.number().int().nonnegative(),
    service_count: z.number().int().nonnegative(),
    visible_group_count: z.number().int().nonnegative(),
  }).optional(),
});

export const localAppsDisabledResponseSchema = z.object({
  app: z.literal("hilt-local-apps"),
  enabled: z.literal(false),
  reason: z.string(),
});

export const localAppsResponseSchema = z.union([
  localAppsEnabledResponseSchema,
  localAppsDisabledResponseSchema,
]);
