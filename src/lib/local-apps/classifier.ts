import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { stableId } from "./stable-id";
import { isLoopbackHost, previewUrlForPort, publicHostForListener, urlHost } from "./tailnet";
import type {
  Health,
  ObservedService,
  ProcessInfo,
  ProjectInfo,
  Service,
  ServiceGroup,
  ServiceKind,
  Settings,
  UserRule,
} from "./types";

const VISIBLE_THRESHOLD = 35;

export function defaultHealth(): Health {
  return {
    status: "unknown",
    label: "Unknown",
    http_status: null,
    latency_ms: null,
    checked_at: null,
    error: null,
    url: null,
  };
}

export function classify(observed: ObservedService, settings: Settings): Service {
  const { listener, process } = observed;
  const commandLc = `${listener.command} ${process.executable || ""} ${process.args}`.toLowerCase();
  let confidence = 0;
  const sourceSignals: string[] = [];
  const project = inspectProject(process.cwd);
  let kind = inferKind(listener.port, commandLc);
  let hasProjectContext = false;

  if (isNoiseCommand(listener.port, commandLc, process.executable)) {
    confidence -= 65;
    sourceSignals.push("recognized app/system noise");
    if (kind === "unknown") kind = listener.port === 9222 ? "browser_debug" : "system";
  }

  if (process.cwd) {
    if (insideAnyRoot(process.cwd, settings.dev_roots)) {
      confidence += 35;
      hasProjectContext = true;
      sourceSignals.push("cwd is inside a configured dev root");
    }
    if (process.cwd !== "/" && project.git_root) {
      confidence += 30;
      hasProjectContext = true;
      sourceSignals.push("cwd belongs to a git worktree");
    }
  }

  if (isStrongDevCommand(commandLc) || (hasProjectContext && isRuntimeCommand(commandLc))) {
    confidence += 25;
    sourceSignals.push("process command looks like a dev server");
  }

  if (listener.port === settings.api_port) {
    confidence -= 100;
    sourceSignals.push("Port Authority local API listener");
  }

  if (isCommonDevPort(listener.port)) {
    confidence += 10;
    sourceSignals.push(`port ${listener.port} is common in local dev`);
  }

  if (isInfraCommandOrPort(listener.port, commandLc)) {
    confidence += 25;
    sourceSignals.push("recognized local infrastructure service");
  }

  if (
    process.executable?.startsWith("/Applications/") &&
    !isStrongDevCommand(commandLc) &&
    !(hasProjectContext && isRuntimeCommand(commandLc))
  ) {
    confidence -= 30;
    sourceSignals.push("process is owned by a macOS app bundle");
  }

  const id = stableId(`svc:${listener.pid}:${listener.host}:${listener.port}:${process.args}`);
  const url_candidates = urlCandidates(listener.host, listener.port, kind);
  const preview_url = url_candidates.length > 0 ? previewUrlForPort(listener.port) : null;

  let forcedAction: UserRule["action"] | null = null;
  for (const rule of settings.rules) {
    if (ruleMatchesService(rule, id, listener.port, listener.command, process)) {
      forcedAction = rule.action;
      sourceSignals.push(`matched user rule: ${rule.pattern}`);
    }
  }

  let visible = confidence >= VISIBLE_THRESHOLD;
  let hidden_reason: string | null = null;
  if (forcedAction === "show") {
    visible = true;
    confidence = Math.max(confidence, VISIBLE_THRESHOLD);
  } else if (forcedAction === "hide") {
    visible = false;
    hidden_reason = "hidden by user rule";
  } else if (!visible) {
    hidden_reason = "below dev-service confidence threshold";
  }

  return {
    id,
    listener,
    process,
    kind,
    title: serviceTitle(listener.command, project, kind, listener.port),
    description: serviceDescription(listener, process, kind),
    confidence: clampConfidence(confidence),
    visible,
    hidden_reason,
    source_signals: sourceSignals,
    project,
    preview_url,
    url_candidates,
    health: defaultHealth(),
    page_title: null,
    favicon_url: null,
    framework_hints: [],
    preview: null,
  };
}

export function groupServices(services: Service[], settings: Settings): ServiceGroup[] {
  const sorted = [...services].sort((a, b) => {
    const git = String(a.project.git_root || "").localeCompare(String(b.project.git_root || ""));
    if (git) return git;
    const branch = String(a.project.branch || "").localeCompare(String(b.project.branch || ""));
    if (branch) return branch;
    return a.listener.port - b.listener.port;
  });

  const buckets = new Map<string, Service[]>();
  for (const service of sorted) {
    const key = groupKey(service);
    buckets.set(key, [...(buckets.get(key) || []), service]);
  }

  return [...buckets.values()]
    .map((bucket) => buildGroup(bucket, settings))
    .sort((a, b) => Number(b.visible) - Number(a.visible) || b.confidence - a.confidence || a.title.localeCompare(b.title));
}

export function applyHttpSignal(service: Service): void {
  if (!service.health.url || service.confidence >= 100) return;
  service.confidence = Math.min(100, service.confidence + 10);
  if (!service.source_signals.includes("HTTP responded")) {
    service.source_signals.push("HTTP responded");
  }
  if (
    service.confidence >= VISIBLE_THRESHOLD &&
    !["system", "browser_debug"].includes(service.kind) &&
    service.hidden_reason === "below dev-service confidence threshold"
  ) {
    service.visible = true;
    service.hidden_reason = null;
  }
}

function buildGroup(services: Service[], settings: Settings): ServiceGroup {
  const first = services[0];
  const gitRoot = first.project.git_root || null;
  const branch = first.project.branch || null;
  const packageName = first.project.package_name || null;
  const groupPath = gitRoot || (first.process.cwd && first.process.cwd !== "/" ? first.process.cwd : null);
  const id = stableId(`group:${groupPath || first.listener.command}:${branch || ""}:${first.listener.command}`);
  let forcedAction: UserRule["action"] | null = null;
  for (const rule of settings.rules) {
    if (ruleMatchesGroup(rule, id, groupPath)) forcedAction = rule.action;
  }

  const ports = [...new Set(services.map((service) => service.listener.port))].sort((a, b) => a - b);
  const primary_url = services.filter((service) => service.visible).map(bestUrl).find(Boolean)
    || services.map(bestUrl).find(Boolean)
    || null;
  const confidence = Math.max(...services.map((service) => service.confidence), 0);
  let visible = services.some((service) => service.visible);
  let hidden_reason = visible ? null : "all services are hidden";
  if (forcedAction === "show") {
    visible = true;
    hidden_reason = null;
  } else if (forcedAction === "hide") {
    visible = false;
    hidden_reason = "hidden by user rule";
  }

  const signals = [...new Set(services.flatMap((service) => service.source_signals))].sort();
  const titleBase = packageName || basename(groupPath || "") || first.listener.command;
  const branchSuffix = branch && branch !== "HEAD" ? ` / ${branch}` : "";

  return {
    id,
    title: `${titleBase}${branchSuffix}`,
    description: groupDescription(services),
    path: groupPath,
    git_root: gitRoot,
    branch,
    package_name: packageName,
    confidence,
    visible,
    hidden_reason,
    services,
    ports,
    primary_url,
    source_signals: signals,
    ai: null,
    updated_at: new Date().toISOString(),
  };
}

function groupDescription(services: Service[]): string {
  const visible = services.filter((service) => service.visible).length;
  const kinds = [...new Set(services.map((service) => service.kind))].sort().join(", ");
  return visible === services.length
    ? `${services.length} services: ${kinds}`
    : `${visible} visible of ${services.length} services: ${kinds}`;
}

function groupKey(service: Service): string {
  if (service.project.git_root) return `git:${service.project.git_root}:${service.project.branch || ""}`;
  if (service.process.cwd && service.process.cwd !== "/") return `cwd:${service.process.cwd}`;
  if (service.listener.parent_pid) return `parent:${service.listener.parent_pid}:${service.listener.command}`;
  return `process:${service.listener.command}`;
}

export function bestUrl(service: Service): string | null {
  return (
    service.preview_url ||
    (service.health.url && !isLoopbackUrl(service.health.url) ? service.health.url : null) ||
    service.url_candidates.find((url) => !isLoopbackUrl(url)) ||
    service.health.url ||
    service.url_candidates[0] ||
    null
  );
}

export function probeUrls(service: Service): string[] {
  return [...(service.health.url ? [service.health.url] : []), ...service.url_candidates];
}

function serviceTitle(command: string, project: ProjectInfo, kind: ServiceKind, port: number): string {
  if (project.package_name) {
    if (kind === "frontend" || kind === "fullstack") return `${project.package_name} web`;
    if (kind === "backend") return `${project.package_name} API`;
    if (kind === "database") return `${project.package_name} database`;
    if (kind === "queue") return `${project.package_name} queue`;
    return project.package_name;
  }

  if (kind === "database") return `${command} database`;
  if (kind === "queue") return `${command} queue`;
  if (kind === "frontend") return `${command} frontend`;
  if (kind === "backend") return `${command} backend`;
  if (kind === "fullstack") return `${command} app`;
  return `${command} :${port}`;
}

function serviceDescription(listener: Service["listener"], process: ProcessInfo, kind: ServiceKind): string {
  const cwd = (process.cwd && process.cwd !== "/" && basename(process.cwd)) || listener.command;
  return `${kindLabel(kind)} listener on ${listener.host}:${listener.port} from ${cwd}`;
}

function kindLabel(kind: ServiceKind): string {
  return kind.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

export function inferKind(port: number, commandLc: string): ServiceKind {
  if (commandLc.includes("--remote-debugging-port") || port === 9222) return "browser_debug";
  if ([5432, 3306, 33060, 27017, 9200].includes(port) || containsAny(commandLc, ["postgres", "mysqld", "mongod", "elasticsearch"])) return "database";
  if ([6379, 5672, 15672, 9092].includes(port) || containsAny(commandLc, ["redis-server", "rabbitmq", "kafka"])) return "queue";
  if (containsAny(commandLc, ["next", "vite", "astro", "remix", "storybook", "webpack-dev-server"])) return commandLc.includes("next") ? "fullstack" : "frontend";
  if (
    containsAny(commandLc, ["ws-server", "websocket", "uvicorn", "gunicorn", "flask", "django", "rails", "puma", "wrangler", "cargo run", "go run", "dotnet", "mvn", "gradle"]) ||
    [8000, 8080, 8787, 5000, 5001].includes(port)
  ) return "backend";
  if (containsAny(commandLc, ["nginx", "caddy", "traefik", "minio", "ollama"])) return "infra";
  if (isCommonDevPort(port)) return "frontend";
  return "unknown";
}

function inspectProject(cwd?: string | null): ProjectInfo {
  if (!cwd || cwd === "/") return {};
  const gitRoot = git(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = git(cwd, ["branch", "--show-current"]) || null;
  const packageName = (gitRoot && readPackageName(gitRoot)) || readPackageName(cwd) || null;
  return {
    git_root: gitRoot,
    branch: branch || null,
    worktree: gitRoot,
    package_name: packageName,
  };
}

function git(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf-8",
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function readPackageName(dir: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf-8");
    const name = JSON.parse(raw).name;
    return typeof name === "string" ? name.trim().replace(/^@/, "").replace("/", " / ") : null;
  } catch {
    return null;
  }
}

function urlCandidates(host: string, port: number, kind: ServiceKind): string[] {
  if (["database", "queue", "system", "browser_debug"].includes(kind)) return [];
  const publicHost = publicHostForListener(host);
  return [`http://${urlHost(publicHost)}:${port}`, `https://${urlHost(publicHost)}:${port}`];
}

function isLoopbackUrl(url: string): boolean {
  const rest = url.split("://")[1];
  if (!rest) return false;
  const host = rest.startsWith("[")
    ? rest.slice(1).split("]")[0]
    : rest.split(/[:/?#]/)[0];
  return isLoopbackHost(host);
}

function isStrongDevCommand(commandLc: string): boolean {
  return containsAny(commandLc, ["npm", "pnpm", "yarn", "bun", "vite", "next", "astro", "remix", "storybook", "webpack", "cargo", "rust", "uvicorn", "gunicorn", "flask", "django", "rails", "puma", "go run", "air", "wrangler", "docker compose", "docker-compose", "gradle", "mvn", "dotnet"]);
}

function isRuntimeCommand(commandLc: string): boolean {
  return containsAny(commandLc, ["node ", "/node", "python", "ruby", "java", "go ", "deno"]);
}

function isInfraCommandOrPort(port: number, commandLc: string): boolean {
  return [80, 443, 5432, 3306, 33060, 6379, 27017, 9200, 5672, 15672, 9092, 11434].includes(port) ||
    containsAny(commandLc, ["postgres", "mysqld", "redis-server", "mongod", "rabbitmq", "kafka", "nginx", "caddy", "traefik", "minio", "ollama"]);
}

function isCommonDevPort(port: number): boolean {
  return port === 1420 || port === 24678 || (port >= 3000 && port <= 3010) || (port >= 4000 && port <= 4010) || [4173, 4321, 5000, 5001, 5173, 5174, 6006, 7007, 8000, 8080, 8787].includes(port);
}

function isNoiseCommand(port: number, commandLc: string, executable?: string | null): boolean {
  if (port === 9222 && containsAny(commandLc, ["dia", "chrome", "browser helper"])) return true;
  if (executable?.startsWith("/System/Library/")) return true;
  return containsAny(commandLc, ["figma", "google drive", "onedrive", "adobe", "creative cloud", "raycast", "superhuman", "slack.app", "dia.app", "plex media server", "plex script host", "com.plexapp", "browser helper", "rapportd", "controlcenter", "1password", "com.apple", "webkit", "audiovisualthumbnail", "imagethumbnail", "webthumbnail"]);
}

function insideAnyRoot(candidate: string, roots: string[]): boolean {
  const normalized = normalizePath(candidate);
  return roots.some((root) => {
    const normalizedRoot = normalizePath(root);
    return normalizedRoot && (normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}/`));
  });
}

function normalizePath(candidate: string): string {
  return path.normalize(candidate).replace(/\/+$/, "");
}

function ruleMatchesService(rule: UserRule, serviceId: string, port: number, command: string, process: ProcessInfo): boolean {
  const pattern = rule.pattern.toLowerCase();
  if (rule.scope === "service_id") return serviceId === rule.pattern;
  if (rule.scope === "process_name") return command.toLowerCase() === pattern;
  if (rule.scope === "command_contains") return process.args.toLowerCase().includes(pattern);
  if (rule.scope === "path_prefix") return !!process.cwd && normalizePath(process.cwd).startsWith(normalizePath(rule.pattern));
  if (rule.scope === "port") return String(port) === rule.pattern;
  return false;
}

function ruleMatchesGroup(rule: UserRule, groupId: string, groupPath: string | null): boolean {
  if (rule.scope === "group_id") return groupId === rule.pattern;
  if (rule.scope === "path_prefix") return !!groupPath && normalizePath(groupPath).startsWith(normalizePath(rule.pattern));
  return false;
}

function containsAny(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function basename(candidate: string): string | null {
  return candidate ? path.basename(candidate) || null : null;
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(100, confidence));
}
