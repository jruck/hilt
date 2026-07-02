/**
 * Loop emission — the one way a loop turns its run results into a contract artifact.
 *
 * Every loop's runner ends with emitLoopArtifact(): it assembles the frontmatter (items + health),
 * appends the rendered `## Escalations` and `## Loop health` VIEWS to the loop-defined content
 * body (so body and frontmatter agree by construction), validates against the contract
 * (fail-loud), and writes through the WRITE GUARD (shadow → sandbox; live → vault; as_of always
 * sandbox). Runtime absence detection, gather, and Hilt all read what this writes.
 */
import { LoopContractError, renderEscalationsSection, renderLoopHealthSection, serializeLoopArtifact, validateLoopArtifactFrontmatter, writeLoopArtifact } from "./artifacts";
import type { LoopArtifactFrontmatter, LoopHealth, LoopItem, RegistryLoop } from "./types";

export interface EmitOptions {
  vaultPath: string;
  /** Required for shadow-phase loops and any as_of run. Conventional: $DATA_DIR/loops-shadow */
  sandboxDir?: string;
  loop: RegistryLoop;
  /** Artifact date (YYYY-MM-DD). */
  date: string;
  /** ISO timestamp of this run. */
  runAt: string;
  /** Launchpad/backtest bound — forces the sandbox regardless of phase. */
  asOf?: string;
  items: LoopItem[];
  health: LoopHealth;
  /** The loop-defined CONTENT sections (markdown, no Escalations/Loop-health — those are appended). */
  contentBody: string;
}

/** Default sandbox location when a caller doesn't override: $DATA_DIR/loops-shadow. */
export function defaultSandboxDir(): string {
  const dataDir = process.env.DATA_DIR || "data";
  return `${dataDir}/loops-shadow`;
}

/**
 * Emit the artifact. Returns the absolute path written. Throws LoopContractError on any contract
 * violation (invalid items/health, guard refusal) — a loop must fail its run loudly rather than
 * write a malformed artifact.
 */
export function emitLoopArtifact(opts: EmitOptions): string {
  const fm: LoopArtifactFrontmatter = {
    loop: opts.loop.id,
    run_at: opts.runAt,
    cadence: opts.loop.cadence,
    ...(opts.asOf ? { as_of: opts.asOf } : {}),
    items: opts.items,
    health: opts.health,
  };
  const problems = validateLoopArtifactFrontmatter(fm);
  if (problems.length) throw new LoopContractError(problems);

  const escalations = renderEscalationsSection(opts.items);
  const body = [
    opts.contentBody.trimEnd(),
    escalations ? `\n${escalations.trimEnd()}\n` : "",
    `\n${renderLoopHealthSection(opts.health).trimEnd()}\n`,
  ].join("");

  return writeLoopArtifact({
    vaultPath: opts.vaultPath,
    sandboxDir: opts.sandboxDir ?? defaultSandboxDir(),
    loop: opts.loop,
    fm,
    body,
    date: opts.date,
  });
}

/** Serialize without writing — for tests and dry runs. */
export function buildLoopArtifactMarkdown(opts: Omit<EmitOptions, "vaultPath" | "sandboxDir">): string {
  const fm: LoopArtifactFrontmatter = {
    loop: opts.loop.id,
    run_at: opts.runAt,
    cadence: opts.loop.cadence,
    ...(opts.asOf ? { as_of: opts.asOf } : {}),
    items: opts.items,
    health: opts.health,
  };
  const problems = validateLoopArtifactFrontmatter(fm);
  if (problems.length) throw new LoopContractError(problems);
  const escalations = renderEscalationsSection(opts.items);
  const body = [
    opts.contentBody.trimEnd(),
    escalations ? `\n${escalations.trimEnd()}\n` : "",
    `\n${renderLoopHealthSection(opts.health).trimEnd()}\n`,
  ].join("");
  return serializeLoopArtifact(fm, body);
}
