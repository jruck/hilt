/**
 * Loop registry IO — `bridge/meta/loops/registry.yml` is the single source of truth for what loops
 * exist, their cadence, homes, and rollout phase (scope §5). Three consumers: gather (print latest
 * artifacts), the runtime loop (absence detection), Hilt (rendering).
 *
 * Implementation notes: use the `yaml` package (v2, direct dependency). Fail-loud parsing like
 * artifacts.ts — a malformed registry should stop a loop run, not silently no-op it.
 */
import fs from "fs";
import path from "path";
import YAML from "yaml";
import type { LoopsRegistry, RegistryLoop } from "./types";
import { LoopContractError } from "./artifacts";

export const REGISTRY_REL_PATH = "meta/loops/registry.yml";

const CADENCES = new Set(["daily", "weekly", "manual"]);
const PHASES = new Set(["shadow", "live"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Parse + validate registry YAML. Problems collected and thrown as LoopContractError:
 * - top-level `loops` array present
 * - every loop has id, domain, cadence ∈ daily|weekly|manual, enabled boolean,
 *   phase ∈ shadow|live
 * - ids unique; (domain, writer-less) uniqueness NOT required (a domain may have projections
 *   written by another loop — `writer` documents that)
 */
export function parseRegistry(yamlText: string): LoopsRegistry {
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LoopContractError([`registry YAML parse failed: ${message}`]);
  }

  const problems: string[] = [];
  if (!isRecord(parsed)) {
    throw new LoopContractError(["registry must be an object with a loops array"]);
  }

  if (!Array.isArray(parsed.loops)) {
    problems.push("registry.loops must be an array");
  } else {
    const seenIds = new Set<string>();
    parsed.loops.forEach((loop, index) => {
      const fallbackLabel = `loop[${index}]`;
      const label = isRecord(loop) && isNonEmptyString(loop.id) ? loop.id : fallbackLabel;
      if (!isRecord(loop)) {
        problems.push(`${fallbackLabel} must be an object`);
        return;
      }

      if (!isNonEmptyString(loop.id)) {
        problems.push(`${label}.id must be a non-empty string`);
      } else if (seenIds.has(loop.id)) {
        problems.push(`duplicate loop id ${loop.id}`);
      } else {
        seenIds.add(loop.id);
      }

      if (!isNonEmptyString(loop.domain)) {
        problems.push(`${label}.domain must be a non-empty string`);
      }
      if (!isNonEmptyString(loop.cadence) || !CADENCES.has(loop.cadence)) {
        problems.push(`${label}.cadence must be one of daily|weekly|manual, got ${String(loop.cadence)}`);
      }
      if (typeof loop.enabled !== "boolean") {
        problems.push(`${label}.enabled must be boolean`);
      }
      if (!isNonEmptyString(loop.phase) || !PHASES.has(loop.phase)) {
        problems.push(`${label}.phase must be one of shadow|live, got ${String(loop.phase)}`);
      }
      if (loop.published_surfaces !== undefined) {
        if (!Array.isArray(loop.published_surfaces)) {
          problems.push(`${label}.published_surfaces must be an array when present`);
        } else {
          loop.published_surfaces.forEach((surface, surfaceIndex) => {
            if (!isNonEmptyString(surface)) {
              problems.push(`${label}.published_surfaces[${surfaceIndex}] must be a non-empty string`);
            }
          });
        }
      }
      if (loop.writer !== undefined && !isNonEmptyString(loop.writer)) {
        problems.push(`${label}.writer must be a non-empty string when present`);
      }
      if (loop.budget !== undefined) {
        if (!isRecord(loop.budget)) {
          problems.push(`${label}.budget must be an object when present`);
        } else {
          if (loop.budget.model !== undefined && typeof loop.budget.model !== "string") {
            problems.push(`${label}.budget.model must be a string when present`);
          }
          if (loop.budget.notes !== undefined && typeof loop.budget.notes !== "string") {
            problems.push(`${label}.budget.notes must be a string when present`);
          }
        }
      }
    });
  }

  if (problems.length > 0) throw new LoopContractError(problems);
  return parsed as unknown as LoopsRegistry;
}

/** Read + parse the registry from the vault. Throws when the file is missing or invalid. */
export function loadRegistry(vaultPath: string): LoopsRegistry {
  const filePath = path.join(vaultPath, REGISTRY_REL_PATH);
  if (!fs.existsSync(filePath)) throw new LoopContractError([`registry file missing: ${filePath}`]);
  return parseRegistry(fs.readFileSync(filePath, "utf-8"));
}

/** Absolute home dir for a loop's machinery: <base>/meta/loops/<domain> */
export function loopHome(base: string, loop: Pick<RegistryLoop, "domain">): string {
  return path.join(base, "meta", "loops", loop.domain);
}

/**
 * Find the latest dated artifact for a loop under `base` (vault or sandbox): the lexicographically
 * greatest `meta/loops/<domain>/reports/YYYY-MM-DD.md`. Optionally bounded by `asOf` (inclusive) —
 * the launchpad's time-boundedness hook. Returns the absolute path, or null when none exists.
 */
export function latestArtifactPath(base: string, loop: Pick<RegistryLoop, "domain">, asOf?: string): string | null {
  const reportsDir = path.join(loopHome(base, loop), "reports");
  if (!fs.existsSync(reportsDir)) return null;

  const candidates = fs.readdirSync(reportsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
    .map((entry) => entry.name.slice(0, -3))
    .filter((date) => !asOf || date <= asOf)
    .sort();
  const latest = candidates.at(-1);
  return latest ? path.join(reportsDir, `${latest}.md`) : null;
}
