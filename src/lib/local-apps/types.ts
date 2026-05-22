export type ServiceKind =
  | "frontend"
  | "backend"
  | "fullstack"
  | "database"
  | "queue"
  | "infra"
  | "browser_debug"
  | "system"
  | "unknown";

export type HealthStatus = "up" | "down" | "unknown";

export type RuleAction = "hide" | "show";

export type RuleScope =
  | "process_name"
  | "command_contains"
  | "path_prefix"
  | "port"
  | "service_id"
  | "group_id";

export interface Listener {
  protocol: string;
  host: string;
  port: number;
  pid: number;
  command: string;
  user?: string | null;
  parent_pid?: number | null;
}

export interface ProcessInfo {
  pid: number;
  parent_pid?: number | null;
  parent_chain: number[];
  cwd?: string | null;
  executable?: string | null;
  args: string;
  start_time?: string | null;
}

export interface ObservedService {
  listener: Listener;
  process: ProcessInfo;
}

export interface Health {
  status: HealthStatus;
  label: string;
  http_status?: number | null;
  latency_ms?: number | null;
  checked_at?: string | null;
  error?: string | null;
  url?: string | null;
}

export interface Preview {
  path?: string | null;
  captured_at: string;
  error?: string | null;
  error_at?: string | null;
  stale?: boolean;
}

export interface ProjectInfo {
  git_root?: string | null;
  branch?: string | null;
  worktree?: string | null;
  package_name?: string | null;
}

export interface Service {
  id: string;
  listener: Listener;
  process: ProcessInfo;
  kind: ServiceKind;
  title: string;
  description: string;
  confidence: number;
  visible: boolean;
  hidden_reason?: string | null;
  source_signals: string[];
  project: ProjectInfo;
  preview_url?: string | null;
  url_candidates: string[];
  health: Health;
  page_title?: string | null;
  favicon_url?: string | null;
  framework_hints: string[];
  preview?: Preview | null;
}

export interface ServiceGroup {
  id: string;
  title: string;
  description: string;
  path?: string | null;
  git_root?: string | null;
  branch?: string | null;
  package_name?: string | null;
  confidence: number;
  visible: boolean;
  hidden_reason?: string | null;
  services: Service[];
  ports: number[];
  primary_url?: string | null;
  source_signals: string[];
  ai?: null;
  updated_at: string;
}

export interface UserRule {
  id: string;
  action: RuleAction;
  scope: RuleScope;
  pattern: string;
  note?: string | null;
  created_at: string;
}

export interface Settings {
  dev_roots: string[];
  rules: UserRule[];
  scan_interval_ms: number;
  api_port: number;
  ai: {
    enabled: boolean;
    endpoint: string;
    model: string;
  };
}

export interface SettingsMetadata {
  settings: Settings;
  api_url: null;
  settings_path: string;
  preview_dir: string;
}

export interface MachineIdentity {
  hostname: string;
  tailscale_dns?: string | null;
  tailscale_ip4?: string | null;
  origin: "local" | "remote";
}

export interface ScanDiagnostics {
  scanned_at: string | null;
  is_scanning: boolean;
  duration_ms: number | null;
  listener_count: number;
  group_count: number;
  visible_group_count: number;
  errors: string[];
}

export interface LocalAppsEnabledResponse {
  app: "hilt-local-apps";
  enabled: true;
  machine: MachineIdentity;
  groups: ServiceGroup[];
  diagnostics: ScanDiagnostics;
  machines?: LocalAppsMachineSnapshot[];
  summary?: LocalAppsSummary;
}

export interface LocalAppsDisabledResponse {
  app: "hilt-local-apps";
  enabled: false;
  reason: string;
}

export type LocalAppsResponse = LocalAppsEnabledResponse | LocalAppsDisabledResponse;

export interface LocalAppsMachineSnapshot {
  id: string;
  self: boolean;
  reachable: boolean;
  source_url?: string | null;
  machine: MachineIdentity;
  groups: ServiceGroup[];
  diagnostics: ScanDiagnostics;
  error?: string | null;
}

export interface LocalAppsSummary {
  machine_count: number;
  group_count: number;
  service_count: number;
  visible_group_count: number;
}
