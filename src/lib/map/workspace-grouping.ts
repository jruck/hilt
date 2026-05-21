import { existsSync, statSync } from "fs";
import { basename, dirname, join, normalize, sep } from "path";
import { homedir } from "os";

export interface WorkspaceInfo {
  root?: string;
  label?: string;
  spaceLabel?: string;
  signals: string[];
}

function pathExists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function findGitRoot(cwd: string): string | undefined {
  let current = normalize(cwd);
  while (current && current !== dirname(current)) {
    if (pathExists(join(current, ".git"))) return current;
    current = dirname(current);
  }
  return undefined;
}

function rootFromKnownPattern(cwd: string): string | undefined {
  const home = homedir();
  const normalized = normalize(cwd);
  const relative = normalized.startsWith(home) ? normalized.slice(home.length + 1) : normalized;
  const parts = relative.split(sep).filter(Boolean);

  if (parts[0] === "work" && parts.length >= 3) {
    return join(home, parts[0], parts[1], parts[2]);
  }

  if (parts[0] === ".openclaw" && parts.length >= 2) {
    return join(home, parts[0], parts[1]);
  }

  if (parts[0] === "clawd" && parts.length >= 2) {
    return join(home, parts[0], parts[1]);
  }

  if (parts.length >= 2) {
    return join(home, parts[0], parts[1]);
  }

  return normalized;
}

function labelForRoot(root: string | undefined, repoRemote?: string): string | undefined {
  if (root) return basename(root) || root;
  if (!repoRemote) return undefined;
  const withoutGit = repoRemote.replace(/\.git$/, "");
  return withoutGit.split(/[/:]/).filter(Boolean).pop();
}

function spaceForRoot(root: string | undefined): string | undefined {
  if (!root) return undefined;
  const home = homedir();
  const relative = root.startsWith(home) ? root.slice(home.length + 1) : root;
  const parts = relative.split(sep).filter(Boolean);

  if (parts[0] === "work") return parts[1] ? `work/${parts[1]}` : "work";
  if (parts[0] === ".openclaw") return "openclaw";
  if (parts[0] === "clawd") return "clawd";
  if (parts[0]) return parts[0];
  return "local";
}

export function inferWorkspace(cwd?: string, repoRemote?: string): WorkspaceInfo {
  if (!cwd) {
    return {
      label: labelForRoot(undefined, repoRemote),
      spaceLabel: repoRemote ? "repo" : undefined,
      signals: repoRemote ? ["repo remote only"] : ["missing cwd"],
    };
  }

  const normalized = normalize(cwd);
  const signals: string[] = [];
  let root: string | undefined;

  if (isDirectory(normalized)) {
    root = findGitRoot(normalized);
    if (root) signals.push("git root");
  }

  if (!root) {
    root = rootFromKnownPattern(normalized);
    if (root) signals.push("path pattern");
  }

  return {
    root,
    label: labelForRoot(root, repoRemote),
    spaceLabel: spaceForRoot(root),
    signals,
  };
}
