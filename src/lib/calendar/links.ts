import type { CalendarJoinLink } from "./types";

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
type JoinLinkSource = "description" | "generic" | "location" | "url";
type JoinLinkCandidate = CalendarJoinLink & {
  source: JoinLinkSource;
  sourceScore: number;
};

interface CalendarJoinLinkFields {
  description?: string | null;
  location?: string | null;
  url?: string | null;
}

export function extractJoinLinks(...values: Array<string | null | undefined>): CalendarJoinLink[] {
  const candidates: JoinLinkCandidate[] = [];
  for (const value of values) {
    candidates.push(...extractJoinLinkCandidates(value, "generic"));
  }
  return dedupeJoinLinkCandidates(candidates);
}

export function extractCalendarJoinLinks(fields: CalendarJoinLinkFields): CalendarJoinLink[] {
  return dedupeJoinLinkCandidates([
    ...extractJoinLinkCandidates(fields.location, "location"),
    ...extractJoinLinkCandidates(fields.url, "url"),
    ...extractJoinLinkCandidates(fields.description, "description"),
  ]);
}

export function dedupeJoinLinks(links: CalendarJoinLink[]): CalendarJoinLink[] {
  return dedupeJoinLinkCandidates(links.map((link) => ({ ...link, source: "generic", sourceScore: 0 })));
}

function extractJoinLinkCandidates(value: string | null | undefined, source: JoinLinkSource): JoinLinkCandidate[] {
  if (!value) return [];
  const candidates: JoinLinkCandidate[] = [];
  for (const match of value.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = normalizeRawUrl(raw);
    if (!url) continue;
    const classification = classifyUrl(url);
    const context = contextAroundMatch(value, match.index ?? 0, raw.length);
    if (classification.kind === "web" && !shouldIncludeWebJoinLink(url, value, context, raw, source)) continue;
    candidates.push({
      url,
      ...classification,
      source,
      sourceScore: joinLinkSourceScore(source),
    });
  }
  return candidates;
}

function dedupeJoinLinkCandidates(links: JoinLinkCandidate[]): CalendarJoinLink[] {
  const linksByKey = new Map<string, { index: number; link: CalendarJoinLink; score: number }>();
  const orderedKeys: string[] = [];
  for (const [index, link] of links.entries()) {
    const url = normalizeRawUrl(link.url);
    if (!url) continue;
    const classification = classifyUrl(url);
    if (isKnownMeetingBoilerplateUrl(url, classification.kind)) continue;
    const normalizedLink: CalendarJoinLink = { url, ...classification };
    const key = canonicalJoinLinkKey(url, classification.kind);
    const score = link.sourceScore + joinLinkScore(url, classification.kind);
    const existing = linksByKey.get(key);
    if (!existing) {
      linksByKey.set(key, { index, link: normalizedLink, score });
      orderedKeys.push(key);
      continue;
    }
    if (score > existing.score) {
      linksByKey.set(key, { ...existing, link: normalizedLink, score });
    }
  }
  return collapseJoinLinkRecords(orderedKeys.map((key) => linksByKey.get(key)!)).map((record) => record.link);
}

export function htmlToText(value: string | null | undefined): string | null {
  if (!value) return null;
  const stripped = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return stripped || null;
}

function trimUrl(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

function normalizeRawUrl(value: string): string {
  const url = trimUrl(value);
  if (!url) return "";
  return trimUrl(unwrapRedirectUrl(url));
}

function contextAroundMatch(value: string, index: number, length: number): string {
  return value.slice(Math.max(0, index - 80), Math.min(value.length, index + length + 80));
}

function unwrapRedirectUrl(url: string): string {
  const parsed = parseUrl(url);
  if (!parsed) return url;
  const host = normalizedHost(parsed.hostname);
  if (host === "teams.microsoft.com" && parsed.pathname.toLowerCase().includes("/dl/launcher")) {
    return unwrapTeamsLauncherUrl(parsed) || url;
  }
  const redirectParam =
    host.endsWith("safelinks.protection.outlook.com") ? "url"
      : host === "google.com" && parsed.pathname === "/url" ? "q"
        : null;
  if (!redirectParam) return url;
  const target = parsed.searchParams.get(redirectParam);
  return target && /^https?:\/\//i.test(target) ? target : url;
}

function unwrapTeamsLauncherUrl(url: URL): string | null {
  const rawTarget = url.searchParams.get("url");
  if (!rawTarget) return null;
  const target = safeDecode(rawTarget).replace(/^\/_#/, "").replace(/^#/, "");
  if (/^https?:\/\//i.test(target)) return target;
  if (target.startsWith("/")) return `${url.protocol}//${url.host}${target}`;
  return null;
}

function classifyUrl(url: string): Pick<CalendarJoinLink, "kind" | "label"> {
  const lower = url.toLowerCase();
  if (lower.includes("teams.microsoft.com") || lower.includes("teams.live.com")) {
    return { kind: "teams", label: "Teams" };
  }
  if (lower.includes("meet.google.com")) {
    return { kind: "meet", label: "Google Meet" };
  }
  if (lower.includes("zoom.us/j/") || lower.includes("zoom.us/my/")) {
    return { kind: "zoom", label: "Zoom" };
  }
  return { kind: "web", label: "Web link" };
}

function joinLinkSourceScore(source: JoinLinkSource): number {
  if (source === "location") return 20_000;
  if (source === "url") return 12_000;
  if (source === "description") return 0;
  return 0;
}

function shouldIncludeWebJoinLink(url: string, fullValue: string, context: string, raw: string, source: JoinLinkSource): boolean {
  if (source === "generic" && isBareUrlValue(fullValue, raw)) return true;
  if (isLikelyGenericMeetingUrl(url)) return true;
  return /\b(join|meeting|meet|video|conference|call|room|webinar)\b/i.test(context);
}

function isBareUrlValue(value: string, raw: string): boolean {
  return trimUrl(value.trim()) === trimUrl(raw.trim());
}

function isLikelyGenericMeetingUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = normalizedHost(parsed.hostname);
  const path = normalizedPathname(parsed).toLowerCase();
  if (/(^|\.)whereby\.com$/.test(host)) return true;
  if (/(^|\.)(webex|gotomeeting|bluejeans|ringcentral|chime\.aws)\./.test(host)) return true;
  return /\/(join|meet|meeting|room|conference|call|webinar)(\/|$)/.test(path);
}

function collapseJoinLinkRecords<T extends { index: number; link: CalendarJoinLink; score: number }>(records: T[]): T[] {
  const bestByKnownKind = new Map<CalendarJoinLink["kind"], T>();
  for (const record of records) {
    if (!isKnownMeetingKind(record.link.kind)) continue;
    const existing = bestByKnownKind.get(record.link.kind);
    if (!existing || record.score > existing.score) bestByKnownKind.set(record.link.kind, record);
  }

  if (bestByKnownKind.size === 0) return records;
  const selected = new Set(bestByKnownKind.values());
  return records.filter((record) => selected.has(record) || !isKnownMeetingKind(record.link.kind) && record.link.kind !== "web");
}

function isKnownMeetingKind(kind: CalendarJoinLink["kind"]): boolean {
  return kind === "teams" || kind === "meet" || kind === "zoom";
}

function canonicalJoinLinkKey(url: string, kind: CalendarJoinLink["kind"]): string {
  const parsed = parseUrl(url);
  if (!parsed) return `${kind}:${url.toLowerCase()}`;
  if (kind === "teams") return canonicalTeamsKey(parsed);
  if (kind === "meet") return canonicalMeetKey(parsed);
  if (kind === "zoom") return canonicalZoomKey(parsed);
  return `web:${canonicalExactUrl(parsed)}`;
}

function canonicalTeamsKey(url: URL): string {
  const segments = normalizedPathSegments(url);
  const meetupIndex = segments.findIndex((segment) => segment === "meetup-join");
  const meetingId = meetupIndex >= 0 ? segments[meetupIndex + 1] : null;
  if (meetingId) return `teams:meetup:${meetingId}`;

  const threadId = lowerSearchParam(url, "threadId");
  if (threadId) return `teams:thread:${threadId}`;

  return `teams:${normalizedHost(url.hostname)}:${normalizedPathname(url)}`;
}

function canonicalMeetKey(url: URL): string {
  const [meetingCode] = normalizedPathSegments(url);
  if (meetingCode) return `meet:${meetingCode.replace(/-/g, "")}`;
  return `meet:${canonicalExactUrl(url)}`;
}

function canonicalZoomKey(url: URL): string {
  const segments = normalizedPathSegments(url);
  const joinIndex = segments.findIndex((segment) => segment === "j");
  const roomIndex = segments.findIndex((segment) => segment === "my");
  if (joinIndex >= 0 && segments[joinIndex + 1]) {
    return `zoom:j:${segments[joinIndex + 1].replace(/[-\s]/g, "")}`;
  }
  if (roomIndex >= 0 && segments[roomIndex + 1]) {
    return `zoom:my:${segments[roomIndex + 1]}`;
  }
  return `zoom:${canonicalExactUrl(url)}`;
}

function canonicalExactUrl(url: URL): string {
  const copy = new URL(url.toString());
  copy.protocol = copy.protocol.toLowerCase();
  copy.hostname = normalizedHost(copy.hostname);
  copy.hash = "";
  const params = Array.from(copy.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => (
    leftKey === rightKey ? leftValue.localeCompare(rightValue) : leftKey.localeCompare(rightKey)
  ));
  copy.search = "";
  for (const [key, value] of params) copy.searchParams.append(key, value);
  return copy.toString();
}

function joinLinkScore(url: string, kind: CalendarJoinLink["kind"]): number {
  const parsed = parseUrl(url);
  if (!parsed) return url.length;
  let score = url.length;
  const path = parsed.pathname.toLowerCase();
  if (kind === "teams") {
    if (path.includes("/l/meetup-join/")) score += 1_000;
    if (parsed.searchParams.has("context")) score += 500;
    if (hasSearchParam(parsed, "tenantId")) score += 150;
    if (hasSearchParam(parsed, "threadId")) score += 150;
  }
  if (kind === "zoom") {
    if (hasSearchParam(parsed, "pwd")) score += 500;
  }
  return score;
}

function isKnownMeetingBoilerplateUrl(url: string, kind: CalendarJoinLink["kind"]): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = normalizedHost(parsed.hostname);
  const path = parsed.pathname.toLowerCase();
  const full = url.toLowerCase();

  if (kind === "teams") {
    return path.includes("meetingoptions") || path.includes("/dl/launcher");
  }

  if (kind !== "web") return false;
  if (host === "aka.ms" && path.includes("jointeamsmeeting")) return true;
  if (host.endsWith("microsoft.com") && full.includes("microsoft-teams")) {
    return full.includes("download") || full.includes("join-a-meeting") || full.includes("meetingoptions");
  }
  return false;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizedHost(value: string): string {
  return value.toLowerCase().replace(/^www\./, "");
}

function normalizedPathname(url: URL): string {
  const path = normalizedPathSegments(url).join("/");
  return path ? `/${path}` : "/";
}

function normalizedPathSegments(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean).map((segment) => safeDecode(segment).toLowerCase());
}

function lowerSearchParam(url: URL, name: string): string | null {
  const value = Array.from(url.searchParams.entries()).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return value ? safeDecode(value).toLowerCase() : null;
}

function hasSearchParam(url: URL, name: string): boolean {
  return Array.from(url.searchParams.keys()).some((key) => key.toLowerCase() === name.toLowerCase());
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
