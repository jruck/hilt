/**
 * Tauri API wrapper for Claude Kanban
 *
 * This module provides TypeScript bindings for all Tauri commands.
 * It replaces the previous fetch/WebSocket API calls.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ============================================================================
// Types
// ============================================================================

export interface Session {
  id: string;
  title: string;
  project: string;
  projectPath?: string;
  updatedAt: string;
  messageCount: number;
  gitBranch?: string;
  firstPrompt?: string;
  lastPrompt?: string;
  slug?: string;
  slugs: string[];
  status: "inbox" | "active" | "recent";
  sortOrder?: number;
  starred?: boolean;
  isRunning?: boolean;
  planSlugs?: string[];
  terminalId?: string;
}

export interface SessionCounts {
  inbox: number;
  active: number;
  recent: number;
  running: number;
}

export interface SessionsResponse {
  sessions: Session[];
  counts: SessionCounts;
}

export interface InboxItem {
  id: string;
  content: string;
  createdAt: string;
  source?: string;
}

export interface InboxSection {
  name: string;
  items: InboxItem[];
}

export interface InboxResponse {
  sections: InboxSection[];
}

export interface TodoItem {
  id: string;
  prompt: string;
  completed: boolean;
  section?: string;
  projectPath?: string;
  createdAt: string;
  sortOrder: number;
}

export interface TodoSection {
  heading: string;
  level: number;
}

export interface TodoResponse {
  items: TodoItem[];
  sections: TodoSection[];
  lastModTime?: number;
}

export interface PlanResponse {
  slug: string;
  path: string;
  content: string;
  modifiedAt: string;
}

export interface FoldersResponse {
  folders: string[];
}

// ============================================================================
// Session Commands
// ============================================================================

export async function getSessions(scope?: string): Promise<SessionsResponse> {
  return invoke("get_sessions", { scope });
}

export async function getSession(sessionId: string): Promise<Session | null> {
  return invoke("get_session", { sessionId });
}

export async function updateSessionStatus(
  sessionId: string,
  status?: string,
  sortOrder?: number,
  starred?: boolean
): Promise<void> {
  return invoke("update_session_status", {
    sessionId,
    status,
    sortOrder,
    starred,
  });
}

export async function getHomeDir(): Promise<string> {
  return invoke("get_home_dir");
}

// ============================================================================
// Inbox Commands
// ============================================================================

export async function getInbox(scope: string): Promise<InboxResponse> {
  return invoke("get_inbox", { scope });
}

export async function addInboxItem(
  scope: string,
  sectionName: string,
  content: string
): Promise<InboxItem> {
  return invoke("add_inbox_item", { scope, sectionName, content });
}

export async function updateInboxItem(
  scope: string,
  itemId: string,
  content: string
): Promise<void> {
  return invoke("update_inbox_item", { scope, itemId, content });
}

export async function deleteInboxItem(
  scope: string,
  itemId: string
): Promise<void> {
  return invoke("delete_inbox_item", { scope, itemId });
}

export async function moveInboxItem(
  scope: string,
  itemId: string,
  targetSection: string
): Promise<void> {
  return invoke("move_inbox_item", { scope, itemId, targetSection });
}

// ============================================================================
// Folder Commands
// ============================================================================

export async function getSubfolders(scope: string): Promise<FoldersResponse> {
  return invoke("get_subfolders", { scope });
}

export async function listDirectory(path: string): Promise<string[]> {
  return invoke("list_directory", { path });
}

export async function pathExists(path: string): Promise<boolean> {
  return invoke("path_exists", { path });
}

export async function createDirectory(path: string): Promise<void> {
  return invoke("create_directory", { path });
}

export async function getClaudeDir(): Promise<string> {
  return invoke("get_claude_dir");
}

// ============================================================================
// Plan Commands
// ============================================================================

export async function getPlans(): Promise<PlanResponse[]> {
  return invoke("get_plans");
}

export async function getPlan(slug: string): Promise<PlanResponse | null> {
  return invoke("get_plan", { slug });
}

export async function updatePlan(slug: string, content: string): Promise<void> {
  return invoke("update_plan", { slug, content });
}

export async function deletePlan(slug: string): Promise<void> {
  return invoke("delete_plan", { slug });
}

export async function createPlan(
  slug: string,
  content: string
): Promise<PlanResponse> {
  return invoke("create_plan", { slug, content });
}

// ============================================================================
// Terminal Commands
// ============================================================================

export async function spawnTerminal(
  terminalId: string,
  sessionId: string,
  projectPath: string,
  isNew: boolean,
  initialPrompt?: string
): Promise<void> {
  return invoke("spawn_terminal", {
    terminalId,
    sessionId,
    projectPath,
    isNew,
    initialPrompt,
  });
}

export async function writeTerminal(
  terminalId: string,
  data: string
): Promise<void> {
  return invoke("write_terminal", { terminalId, data });
}

export async function resizeTerminal(
  terminalId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke("resize_terminal", { terminalId, cols, rows });
}

export async function killTerminal(terminalId: string): Promise<void> {
  return invoke("kill_terminal", { terminalId });
}

export async function getActiveTerminals(): Promise<string[]> {
  return invoke("get_active_terminals");
}

export async function hasTerminal(terminalId: string): Promise<boolean> {
  return invoke("has_terminal", { terminalId });
}

// ============================================================================
// Dev Mode Commands
// ============================================================================

export async function toggleDevMode(): Promise<boolean> {
  return invoke("toggle_dev_mode");
}

export async function isDevModeEnabled(): Promise<boolean> {
  return invoke("is_dev_mode_enabled");
}

export async function startDevMode(): Promise<void> {
  return invoke("start_dev_mode");
}

export async function stopDevMode(): Promise<void> {
  return invoke("stop_dev_mode");
}

// ============================================================================
// Event Listeners
// ============================================================================

export interface PtyDataEvent {
  terminalId: string;
  data: string;
}

export interface PtyTitleEvent {
  terminalId: string;
  title: string;
}

export interface PtyContextEvent {
  terminalId: string;
  progress: number;
}

export interface PtyExitEvent {
  terminalId: string;
  exitCode: number;
}

export interface FileChangedEvent {
  type: "created" | "modified" | "removed";
  fileType: "session" | "todo" | "inbox" | "plan" | "other";
  paths: string[];
}

export interface PlanChangedEvent {
  event: "created" | "updated" | "removed";
  slug: string;
  path: string;
  content?: string;
}

export interface DevModeChangedEvent {
  enabled: boolean;
}

export function onPtyData(
  callback: (event: PtyDataEvent) => void
): Promise<UnlistenFn> {
  return listen("pty-data", (event) => callback(event.payload as PtyDataEvent));
}

export function onPtyTitle(
  callback: (event: PtyTitleEvent) => void
): Promise<UnlistenFn> {
  return listen("pty-title", (event) =>
    callback(event.payload as PtyTitleEvent)
  );
}

export function onPtyContext(
  callback: (event: PtyContextEvent) => void
): Promise<UnlistenFn> {
  return listen("pty-context", (event) =>
    callback(event.payload as PtyContextEvent)
  );
}

export function onPtyExit(
  callback: (event: PtyExitEvent) => void
): Promise<UnlistenFn> {
  return listen("pty-exit", (event) => callback(event.payload as PtyExitEvent));
}

export function onPtySpawned(
  callback: (event: { terminalId: string }) => void
): Promise<UnlistenFn> {
  return listen("pty-spawned", (event) =>
    callback(event.payload as { terminalId: string })
  );
}

export function onFileChanged(
  callback: (event: FileChangedEvent) => void
): Promise<UnlistenFn> {
  return listen("file-changed", (event) =>
    callback(event.payload as FileChangedEvent)
  );
}

export function onPlanChanged(
  callback: (event: PlanChangedEvent) => void
): Promise<UnlistenFn> {
  return listen("plan-changed", (event) =>
    callback(event.payload as PlanChangedEvent)
  );
}

export function onDevModeChanged(
  callback: (event: DevModeChangedEvent) => void
): Promise<UnlistenFn> {
  return listen("dev-mode-changed", (event) =>
    callback(event.payload as DevModeChangedEvent)
  );
}

// ============================================================================
// Utility: Check if running in Tauri
// ============================================================================

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

// ============================================================================
// Shell Commands
// ============================================================================

export async function revealInFinder(path: string): Promise<void> {
  return invoke("reveal_in_finder", { path });
}

export async function openPath(path: string): Promise<void> {
  return invoke("open_path", { path });
}

export async function pickFolder(): Promise<string | null> {
  return invoke("pick_folder");
}
