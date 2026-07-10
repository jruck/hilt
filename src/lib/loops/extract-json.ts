function plainObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseObject(candidate: string): unknown | null {
  try {
    const parsed = JSON.parse(candidate.trim());
    return plainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fencedCandidates(text: string): string[] {
  const candidates: string[] = [];
  const fences = text.matchAll(/```([^\n`]*)?\n?([\s\S]*?)```/g);
  for (const match of fences) {
    const rawInfo = match[1] || "";
    const info = rawInfo.trim().toLowerCase();
    const body = match[2] || "";
    if (info === "json" || info.startsWith("json ")) candidates.push(body);
    else if (!info && body.trimStart().startsWith("{")) candidates.push(body);
    else if (!body && rawInfo.trimStart().startsWith("{")) candidates.push(rawInfo);
  }
  return candidates;
}

function balancedCandidates(text: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
        continue;
      }
      if (ch === "\"") inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) candidates.push(text.slice(start, i + 1));
        if (depth < 0) break;
      }
    }
  }
  return candidates;
}

/** Extracts the model's JSON object from a possibly-chatty answer; returns null and never throws. */
export function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  let fencedNonObject = false;
  for (const candidate of fencedCandidates(text)) {
    const parsed = parseObject(candidate);
    if (parsed) return parsed;
    // Same guard as the whole-text check below: a fence holding valid non-object JSON
    // (e.g. a top-level array) is a complete answer of the wrong shape — don't pluck
    // an inner object out of it.
    try {
      JSON.parse(candidate.trim());
      fencedNonObject = true;
    } catch {}
  }
  if (fencedNonObject) return null;
  try {
    if (!plainObject(JSON.parse(trimmed))) return null;
  } catch {}
  for (const candidate of balancedCandidates(text).sort((a, b) => b.length - a.length)) {
    const parsed = parseObject(candidate);
    if (parsed) return parsed;
  }
  return parseObject(trimmed);
}
