import { getVaultPath } from "@/lib/bridge/vault";
import { defaultSandboxDir } from "@/lib/loops/emit";
import { loadRegistry, loopHome } from "@/lib/loops/registry";
import type { LoopsRegistry, RegistryLoop } from "@/lib/loops/types";

export interface LoopApiError {
  loop?: string;
  phase?: RegistryLoop["phase"];
  message: string;
}

export interface LoopRegistryContext {
  vaultPath: string;
  registry: LoopsRegistry | null;
  error?: string;
}

export async function loadLoopRegistryContext(): Promise<LoopRegistryContext> {
  const vaultPath = await getVaultPath();
  try {
    return { vaultPath, registry: loadRegistry(vaultPath) };
  } catch (error) {
    return { vaultPath, registry: null, error: errorMessage(error) };
  }
}

export function loopBase(vaultPath: string, loop: RegistryLoop): string {
  return loop.phase === "live" ? vaultPath : defaultSandboxDir();
}

export function loopStoreHome(vaultPath: string, loop: RegistryLoop): string {
  return loopHome(loopBase(vaultPath, loop), loop);
}

export function findEnabledLoop(registry: LoopsRegistry, loopId: string): RegistryLoop | null {
  return registry.loops.find((loop) => loop.id === loopId && loop.enabled) ?? null;
}

export function makeRecordId(prefix: "v" | "fb"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
