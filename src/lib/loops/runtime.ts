/**
 * The runtime loop's check logic (scope §7): the one loop whose subject is the OTHER loops'
 * existence and the substrate they run on. Two things per-loop self-eval cannot cover:
 *
 *   1. ABSENCE — a dead loop writes no artifact; self-reporting can't report a run that never
 *      happened (case studies: the keychain-401 reweave outage, the v1.0.38 CLI fossil).
 *   2. SUBSTRATE — launchd job outcomes, credentials/CLI sanity, disk, supervisor heartbeat.
 *
 * Plus the cross-loop health digest: surfacing (not owning) notable per-loop health findings.
 *
 * Pure logic lives here (testable with fixtures); the script shell (scripts/loop-runtime.ts)
 * gathers the environmental inputs and emits through emit.ts.
 */
import fs from "fs";
import path from "path";
import { parseLoopArtifact } from "./artifacts";
import { latestArtifactPath } from "./registry";
import type { LoopItem, LoopsRegistry, RegistryLoop } from "./types";

const RUNTIME_LOOP_ID = "runtime";

/** Days of slack beyond the cadence before an artifact counts as stale. */
const GRACE_DAYS = 1;

const CADENCE_DAYS: Record<RegistryLoop["cadence"], number> = { daily: 1, weekly: 7, manual: Infinity };

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export interface SubstrateInputs {
  /** launchd rows relevant to the system: label → last exit status (from `launchctl list`). */
  launchdExitCodes: Record<string, number>;
  /** Labels whose failure should escalate (the critical overnight chain). */
  criticalJobs: string[];
  /** Resolved claude CLI version string (e.g. "2.1.198 (Claude Code)"). */
  claudeVersion: string | null;
  /** Whether the headless OAuth token is configured (existence only — never the value). */
  oauthTokenConfigured: boolean;
  /**
   * User-facing disk capacity fraction 0..1 for the volume holding the vault.
   * On macOS this should use Finder-style "available for important usage";
   * POSIX df free blocks are a fallback and can undercount purgeable space.
   */
  diskFreeFraction: number | null;
  /** POSIX df free-block fraction, retained as diagnostic context when it differs. */
  diskImmediateFreeFraction?: number | null;
  /** Supervisor heartbeat age in minutes (null = no heartbeat file). */
  supervisorHeartbeatAgeMin: number | null;
  /** Today's briefing file exists in the vault (checked after the morning window). */
  briefingPresent: boolean | null; // null = not applicable yet (before 07:00)
}

/**
 * Absence detection over enabled loops (excluding the runtime loop itself): a loop whose latest
 * artifact (in its phase-appropriate base) is older than cadence + grace — or missing entirely —
 * produces an ESCALATED insight. `today` is YYYY-MM-DD; `basesByPhase` maps shadow→sandbox root,
 * live→vault root.
 */
export function absenceItems(
  registry: LoopsRegistry,
  basesByPhase: { shadow: string; live: string },
  today: string,
): LoopItem[] {
  const items: LoopItem[] = [];
  for (const loop of registry.loops) {
    if (!loop.enabled || loop.id === RUNTIME_LOOP_ID) continue;
    const base = loop.phase === "live" ? basesByPhase.live : basesByPhase.shadow;
    const latest = latestArtifactPath(base, loop);
    const maxAge = CADENCE_DAYS[loop.cadence] + GRACE_DAYS;
    if (!latest) {
      items.push({
        id: `rt-${today}-absent-${loop.id}`,
        loop: RUNTIME_LOOP_ID,
        kind: "insight",
        title: `Loop "${loop.id}" has NO artifact at all (${loop.phase} base)`,
        citations: [{ source: `meta/loops/registry.yml`, anchor: loop.id }],
        escalated: { reason: `enabled ${loop.cadence} loop has never produced an artifact — runner dead or misconfigured` },
      });
      continue;
    }
    const date = path.basename(latest, ".md");
    const age = daysBetween(date, today);
    if (Number.isFinite(maxAge) && age > maxAge) {
      items.push({
        id: `rt-${today}-stale-${loop.id}`,
        loop: RUNTIME_LOOP_ID,
        kind: "insight",
        title: `Loop "${loop.id}" is STALE: latest artifact ${date} (${age}d old, cadence ${loop.cadence})`,
        citations: [{ source: `meta/loops/${loop.domain}/reports/${date}.md` }],
        escalated: { reason: `no artifact for ${age} days — the loop silently stopped running` },
      });
    }
  }
  return items;
}

/**
 * Cross-loop health digest: read each enabled loop's latest artifact and surface (not own) its
 * health. `health.ok === false` escalates; a health with proposals pending is a quiet insight.
 */
export function healthDigestItems(
  registry: LoopsRegistry,
  basesByPhase: { shadow: string; live: string },
  today: string,
): LoopItem[] {
  const items: LoopItem[] = [];
  for (const loop of registry.loops) {
    if (!loop.enabled || loop.id === RUNTIME_LOOP_ID) continue;
    const base = loop.phase === "live" ? basesByPhase.live : basesByPhase.shadow;
    const latest = latestArtifactPath(base, loop);
    if (!latest) continue; // absence already covers this
    let health;
    try {
      health = parseLoopArtifact(fs.readFileSync(latest, "utf-8")).frontmatter.health;
    } catch (error) {
      items.push({
        id: `rt-${today}-malformed-${loop.id}`,
        loop: RUNTIME_LOOP_ID,
        kind: "insight",
        title: `Loop "${loop.id}" latest artifact FAILS the contract`,
        detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
        citations: [{ source: latest }],
        escalated: { reason: "artifact violates the loop contract — writer bug" },
      });
      continue;
    }
    if (!health.ok) {
      items.push({
        id: `rt-${today}-unhealthy-${loop.id}`,
        loop: RUNTIME_LOOP_ID,
        kind: "insight",
        title: `Loop "${loop.id}" self-reports FAILING`,
        detail: [health.quality_notes, health.notes].filter(Boolean).join(" · ").slice(0, 300) || undefined,
        citations: [{ source: latest }],
        escalated: { reason: "loop's own health dimension reports not-ok" },
      });
    } else if (health.proposal_ids?.length) {
      items.push({
        id: `rt-${today}-proposals-${loop.id}`,
        loop: RUNTIME_LOOP_ID,
        kind: "insight",
        title: `Loop "${loop.id}" has ${health.proposal_ids.length} tuning proposal(s) awaiting verdict`,
        citations: [{ source: latest }],
      });
    }
  }
  return items;
}

/** Substrate checks → items. Escalation judgment: critical-job failures, fossil CLI, missing
 *  token, disk < 10%, supervisor heartbeat > 30 min, briefing missing after the window. */
export function substrateItems(inputs: SubstrateInputs, today: string): LoopItem[] {
  const items: LoopItem[] = [];
  const cite = { source: "system:mercury-v" };

  for (const [label, code] of Object.entries(inputs.launchdExitCodes)) {
    if (code === 0) continue;
    const critical = inputs.criticalJobs.includes(label);
    items.push({
      id: `rt-${today}-launchd-${label}`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: `launchd job ${label} last exited ${code}`,
      citations: [cite],
      ...(critical ? { escalated: { reason: "critical overnight job failing" } } : {}),
    });
  }

  if (inputs.claudeVersion && /^1\./.test(inputs.claudeVersion.trim())) {
    items.push({
      id: `rt-${today}-claude-fossil`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: `Scheduled jobs resolve a v1.x claude CLI (${inputs.claudeVersion.trim()}) — the fossil is back`,
      citations: [cite],
      escalated: { reason: "modern flags will silently fail (2026-07-02 incident class)" },
    });
  }
  if (inputs.claudeVersion === null) {
    items.push({
      id: `rt-${today}-claude-missing`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: "claude CLI not resolvable in the scheduled-job environment",
      citations: [cite],
      escalated: { reason: "every model-calling loop is dead" },
    });
  }

  if (!inputs.oauthTokenConfigured) {
    items.push({
      id: `rt-${today}-token-missing`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: "CLAUDE_CODE_OAUTH_TOKEN not configured for headless runs",
      citations: [cite],
      escalated: { reason: "overnight claude calls will 401 (keychain unreachable under launchd)" },
    });
  }

  if (inputs.diskFreeFraction !== null && inputs.diskFreeFraction < 0.1) {
    const immediate =
      inputs.diskImmediateFreeFraction !== null &&
      inputs.diskImmediateFreeFraction !== undefined &&
      Math.abs(inputs.diskImmediateFreeFraction - inputs.diskFreeFraction) >= 0.01
        ? ` (${(inputs.diskImmediateFreeFraction * 100).toFixed(1)}% immediately free)`
        : "";
    items.push({
      id: `rt-${today}-disk`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: `Disk available ${(inputs.diskFreeFraction * 100).toFixed(1)}%${immediate} — below 10%`,
      citations: [cite],
      escalated: { reason: "vault writes and sqlite stores at risk" },
    });
  }

  if (inputs.supervisorHeartbeatAgeMin !== null && inputs.supervisorHeartbeatAgeMin > 30) {
    items.push({
      id: `rt-${today}-supervisor`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: `App supervisor heartbeat is ${Math.round(inputs.supervisorHeartbeatAgeMin)} min old`,
      citations: [cite],
      escalated: { reason: "Hilt serving stack may be down" },
    });
  }

  if (inputs.briefingPresent === false) {
    items.push({
      id: `rt-${today}-briefing-missing`,
      loop: RUNTIME_LOOP_ID,
      kind: "insight",
      title: `Today's briefing (${today}) is missing from the vault after the morning window`,
      citations: [{ source: `briefings/${today}.md` }],
      escalated: { reason: "generation + retry both failed — investigate ~/Library/Logs/hilt-briefing/" },
    });
  }

  return items;
}
