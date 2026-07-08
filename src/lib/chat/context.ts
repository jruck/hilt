/**
 * First-turn prompt composition — the context block sent to the CLI on turn 1 ONLY.
 * The STORED user message is the user's own prompt; this block never enters the transcript.
 * Coverage per plan + v3 phase-C extension: library and task are fully hydrated, meeting
 * reads the vault note head; doc/person/loop-item/briefing-line are labeled stubs whose
 * richer prompts are composed by later workstreams. Every kind yields a sane contextLabel.
 */
import fs from "fs";
import path from "path";
import { getVaultPath } from "../bridge/vault";
import { getLibraryArtifact } from "../library/library";
import { isValidTaskId, readTask } from "../tasks/store";
import type { ChatContextRef } from "./types";

// Head-of-content cap — keeps turn-1 prompts bounded regardless of source size.
const CONTENT_HEAD_CHARS = 12_000;

const STANDING_INSTRUCTIONS =
  "You are chatting inside Hilt, the user's personal knowledge app. cwd is the vault root. " +
  "You may read and edit vault files with your tools. Markdown files are the source of truth — " +
  "keep edits minimal and surgical, preserve frontmatter keys. Be concise.";

function head(content: string): string {
  return content.length > CONTENT_HEAD_CHARS
    ? `${content.slice(0, CONTENT_HEAD_CHARS)}\n…[content truncated]`
    : content;
}

function compose(lines: Array<string | null>): string {
  return [STANDING_INSTRUCTIONS, "", ...lines.filter((line): line is string => line !== null)].join("\n");
}

/** Vault-relative → absolute, confined to the vault. Null when the path escapes or is absolute. */
function resolveVaultRelative(vaultPath: string, relPath: string): string | null {
  if (!relPath || path.isAbsolute(relPath)) return null;
  const vaultRoot = path.resolve(vaultPath);
  const resolved = path.resolve(vaultRoot, relPath);
  if (resolved === vaultRoot || !resolved.startsWith(vaultRoot + path.sep)) return null;
  return resolved;
}

export interface FirstTurnPrompt {
  prompt: string;
  contextLabel: string;
}

export async function buildFirstTurnPrompt(context: ChatContextRef): Promise<FirstTurnPrompt> {
  switch (context.kind) {
    case "library": {
      const vaultPath = await getVaultPath();
      const artifact = getLibraryArtifact(vaultPath, context.id);
      if (!artifact) {
        return {
          prompt: compose([
            `Context: Reference Library artifact id ${context.id} — not found on disk; ask the user for details if needed.`,
          ]),
          contextLabel: `Library ${context.id}`,
        };
      }
      return {
        prompt: compose([
          "Context: a Reference Library artifact the user is looking at.",
          `Title: ${artifact.title}`,
          artifact.url ? `URL: ${artifact.url}` : null,
          `File (vault-relative): ${artifact.path}`,
          artifact.summary ? `Summary: ${artifact.summary}` : null,
          "",
          "Content:",
          head(artifact.content),
        ]),
        contextLabel: artifact.title,
      };
    }
    case "task": {
      const vaultPath = await getVaultPath();
      const task = isValidTaskId(context.id) ? readTask(vaultPath, context.id) : null;
      if (!task) {
        return {
          prompt: compose([
            `Context: task ${context.id} — not found in the vault's tasks/ store; ask the user for details if needed.`,
          ]),
          contextLabel: `Task ${context.id}`,
        };
      }
      return {
        prompt: compose([
          "Context: a task file the user is looking at.",
          `Task id: ${task.id}`,
          `File (vault-relative): tasks/${task.id}.md`,
          `Title: ${task.title}`,
          `Status: ${task.status}`,
          task.due ? `Due: ${task.due}` : null,
          "",
          "Body:",
          head(task.body),
        ]),
        contextLabel: task.title,
      };
    }
    case "meeting": {
      const vaultPath = await getVaultPath();
      const filePath = resolveVaultRelative(vaultPath, context.path);
      const label = path.basename(context.path).replace(/\.md$/i, "") || context.path;
      if (!filePath || !fs.existsSync(filePath)) {
        return {
          prompt: compose([
            `Context: meeting note at vault path ${context.path} — not found; ask the user for details if needed.`,
          ]),
          contextLabel: label,
        };
      }
      return {
        prompt: compose([
          "Context: a meeting note the user is looking at.",
          `File (vault-relative): ${context.path}`,
          "",
          "Content:",
          head(fs.readFileSync(filePath, "utf-8")),
        ]),
        contextLabel: label,
      };
    }
    case "doc":
      // Stub — Workstream 4 composes the doc content block.
      return {
        prompt: compose([
          `Context: a document at ${context.path}. Read it with your tools if the conversation needs it.`,
        ]),
        contextLabel: path.basename(context.path) || context.path,
      };
    case "person":
      // Stub — Workstream 4 composes the person-note block.
      return {
        prompt: compose([
          `Context: the person "${context.slug}" from the user's People space (people/${context.slug}.md and related notes). Read vault files with your tools if the conversation needs them.`,
        ]),
        contextLabel: context.slug,
      };
    case "loop-item":
      // Stub — a later unit composes the loop-item block.
      return {
        prompt: compose([
          `Context: item ${context.itemId} from the "${context.loop}" loop in Hilt. The user will explain what they want; ask for details if needed.`,
        ]),
        contextLabel: `${context.loop} · ${context.itemId}`,
      };
    case "briefing-line":
      // Stub — a later unit composes the briefing-line block.
      return {
        prompt: compose([
          `Context: the briefing line anchored "${context.anchor}" in the ${context.date} daily briefing (briefings/ in the vault). Read vault files with your tools if the conversation needs them.`,
        ]),
        contextLabel: `Briefing ${context.date}`,
      };
    case "none":
      return { prompt: STANDING_INSTRUCTIONS, contextLabel: "Chat" };
  }
}
