import { getVaultPath } from "@/lib/bridge/vault";
import { TASK_STATUSES } from "@/lib/tasks/types";
import type { TaskStatus } from "@/lib/tasks/types";

/** Vault resolution: same source of truth as every /api/bridge route. */
export async function taskBaseDir(): Promise<string> {
  return getVaultPath();
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && TASK_STATUSES.includes(value as TaskStatus);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateString(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}
