const VAULT_ROOT_LINK_PREFIXES = new Set([
  "areas",
  "briefings",
  "docs",
  "libraries",
  "lists",
  "meetings",
  "memory",
  "meta",
  "people",
  "projects",
  "references",
  "tasks",
  "templates",
  "thoughts",
  "vault-health",
]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export function taskEditorDirname(path: string): string {
  const normalized = normalizePath(path);
  const i = normalized.lastIndexOf("/");
  return i <= 0 ? "/" : normalized.slice(0, i);
}

export function resolveTaskEditorPath(base: string, target: string): string {
  const normalizedTarget = normalizePath(target.trim());
  if (normalizedTarget.startsWith("/")) return normalizedTarget;

  const parts = normalizePath(base).split("/").filter(Boolean);
  for (const seg of normalizedTarget.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return "/" + parts.join("/");
}

export function relativeTaskEditorPath(from: string, to: string): string {
  const fromParts = normalizePath(from).split("/").filter(Boolean);
  const toParts = normalizePath(to).split("/").filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const rest = toParts.slice(i);
  if (ups === 0) return rest.join("/") || ".";
  return [...Array(ups).fill(".."), ...rest].join("/");
}

export function isVaultRootRelativeTaskEditorTarget(target: string): boolean {
  const normalized = normalizePath(target.trim());
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    !normalized.includes("/")
  ) {
    return false;
  }
  const first = normalized.split("/")[0];
  return VAULT_ROOT_LINK_PREFIXES.has(first);
}

export function resolveTaskEditorReferencePath(
  target: string,
  vaultPath: string,
  filePath: string,
  options: { plainFileUsesMediaDir?: boolean } = {},
): string {
  const normalized = normalizePath(target.trim());
  const fileDir = taskEditorDirname(filePath);

  if (normalized.startsWith("/")) return normalized;
  if (normalized.startsWith("./") || normalized.startsWith("../")) {
    return resolveTaskEditorPath(fileDir, normalized);
  }
  if (isVaultRootRelativeTaskEditorTarget(normalized)) {
    return resolveTaskEditorPath(vaultPath, normalized);
  }
  if (options.plainFileUsesMediaDir && !normalized.includes("/")) {
    return resolveTaskEditorPath(fileDir, "media/" + normalized);
  }
  return resolveTaskEditorPath(fileDir, normalized);
}

export function formatTaskEditorWikilinkTarget(
  absolutePath: string,
  vaultPath: string,
  filePath: string,
): string {
  const normalizedPath = normalizePath(absolutePath);
  const normalizedVault = normalizePath(vaultPath).replace(/\/$/, "");
  if (normalizedVault && normalizedPath.startsWith(normalizedVault + "/")) {
    const vaultRelative = normalizedPath.slice(normalizedVault.length + 1);
    if (isVaultRootRelativeTaskEditorTarget(vaultRelative)) return vaultRelative;
  }
  return relativeTaskEditorPath(taskEditorDirname(filePath), normalizedPath);
}
