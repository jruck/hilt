import type { CalendarJoinLink, CalendarResourceLink } from "./types";

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
type JoinLinkSource = "description" | "generic" | "location" | "url";
type JoinLinkCandidate = CalendarJoinLink & {
  source: JoinLinkSource;
  sourceScore: number;
};
type ResourceLinkSource = JoinLinkSource;
type ResourceLinkCandidate = CalendarResourceLink & {
  source: ResourceLinkSource;
  sourceScore: number;
};

interface CalendarJoinLinkFields {
  description?: string | null;
  location?: string | null;
  url?: string | null;
}

interface CalendarResourceLinkFields {
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

export function extractResourceLinks(...values: Array<string | null | undefined>): CalendarResourceLink[] {
  const candidates: ResourceLinkCandidate[] = [];
  for (const value of values) {
    candidates.push(...extractResourceLinkCandidates(value, "generic"));
  }
  return dedupeResourceLinkCandidates(candidates);
}

export function extractCalendarResourceLinks(fields: CalendarResourceLinkFields): CalendarResourceLink[] {
  return dedupeResourceLinkCandidates([
    ...extractResourceLinkCandidates(fields.description, "description"),
    ...extractResourceLinkCandidates(fields.location, "location"),
    ...extractResourceLinkCandidates(fields.url, "url"),
  ]);
}

export function dedupeResourceLinks(links: CalendarResourceLink[]): CalendarResourceLink[] {
  return dedupeResourceLinkCandidates(links.map((link) => ({ ...link, source: "generic", sourceScore: 0 })));
}

export function canonicalCalendarActionUrlKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeRawUrl(value);
  if (!normalized) return null;
  const parsed = parseUrl(normalized);
  if (!parsed) return normalized.toLowerCase();

  const classification = classifyUrl(normalized);
  if (isKnownMeetingKind(classification.kind)) return `join:${canonicalJoinLinkKey(normalized, classification.kind)}`;

  const resourceClassification = classifyCalendarResourceUrl(normalized);
  if (resourceClassification) return `resource:${canonicalResourceUrl(normalized)}`;

  return `web:${canonicalExactUrl(parsed)}`;
}

export function shouldRenderCalendarProviderUrl(
  value: string | null | undefined,
  visibleActionLinks: Array<{ url: string | null | undefined }>,
): value is string {
  const key = canonicalCalendarActionUrlKey(value);
  if (!value || !key) return false;
  if (isGeneratedCalendarActionUrl(value)) return false;
  if (isZoomRegistrationUrl(value) && visibleActionLinks.some((link) => canonicalCalendarActionUrlKey(link.url)?.startsWith("join:zoom:"))) return false;
  return !visibleActionLinks.some((link) => canonicalCalendarActionUrlKey(link.url) === key);
}

export function classifyCalendarResourceUrl(url: string): Pick<CalendarResourceLink, "kind" | "label"> | null {
  const parsed = parseUrl(normalizeRawUrl(url));
  if (!parsed) return null;
  const host = normalizedHost(parsed.hostname);
  const path = normalizedPathname(parsed).toLowerCase();

  if (host === "docs.google.com") {
    if (path.startsWith("/document/d/")) return { kind: "doc", label: "Google Doc" };
    if (path.startsWith("/spreadsheets/d/")) return { kind: "sheet", label: "Google Sheet" };
    if (path.startsWith("/presentation/d/")) return { kind: "slide", label: "Google Slides" };
  }

  if (host.endsWith("sharepoint.com")) return { kind: "sharepoint", label: "SharePoint" };
  if (host === "onedrive.live.com" || host.endsWith("1drv.ms")) return { kind: "office", label: "Office" };
  if (host.endsWith("office.com") || host.endsWith("office365.com") || host.endsWith("microsoft365.com")) {
    if (path.includes("word")) return { kind: "office", label: "Word" };
    if (path.includes("excel")) return { kind: "office", label: "Excel" };
    if (path.includes("powerpoint")) return { kind: "office", label: "PowerPoint" };
    return { kind: "office", label: "Office" };
  }

  if (/\.(docx?|xlsx?|pptx?|pdf)$/i.test(path)) return { kind: "doc", label: "Document" };
  return null;
}

export function canonicalResourceUrl(value: string): string {
  const normalized = normalizeRawUrl(value);
  const parsed = parseUrl(normalized);
  if (!parsed) return normalized.toLowerCase();
  const host = normalizedHost(parsed.hostname);
  const googleDocMatch = normalizedPathname(parsed).match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/i);
  if (host === "docs.google.com" && googleDocMatch) {
    return `${parsed.protocol.toLowerCase()}//${host}/${googleDocMatch[1].toLowerCase()}/d/${googleDocMatch[2]}/`;
  }

  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = host;
  parsed.hash = "";
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) parsed.searchParams.delete(key);
  }
  return canonicalExactUrl(parsed);
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

function extractResourceLinkCandidates(value: string | null | undefined, source: ResourceLinkSource): ResourceLinkCandidate[] {
  if (!value) return [];
  const candidates: ResourceLinkCandidate[] = [];
  for (const match of value.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = normalizeRawUrl(raw);
    if (!url) continue;
    const joinClassification = classifyUrl(url);
    if (isKnownMeetingKind(joinClassification.kind) || isLikelyGenericMeetingUrl(url)) continue;
    if (isKnownMeetingBoilerplateUrl(url, joinClassification.kind)) continue;

    const context = contextAroundMatch(value, match.index ?? 0, raw.length);
    const classification = classifyCalendarResourceUrl(url) ?? classifyContextualResourceLink(context);
    if (!classification) continue;
    candidates.push({
      url,
      ...classification,
      source,
      sourceScore: resourceLinkSourceScore(source),
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

function dedupeResourceLinkCandidates(links: ResourceLinkCandidate[]): CalendarResourceLink[] {
  const linksByKey = new Map<string, { index: number; link: CalendarResourceLink; score: number }>();
  const orderedKeys: string[] = [];
  for (const [index, link] of links.entries()) {
    const url = normalizeRawUrl(link.url);
    if (!url) continue;
    const classification = classifyCalendarResourceUrl(url) ?? { kind: link.kind, label: link.label };
    const normalizedLink: CalendarResourceLink = { url, ...classification };
    const key = canonicalResourceUrl(url);
    const score = link.sourceScore + resourceLinkScore(url, classification.kind);
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

  return orderedKeys
    .map((key) => linksByKey.get(key)!)
    .sort((left, right) => left.index - right.index)
    .map((record) => record.link);
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
  const parsed = parseUrl(url);
  if (parsed && isZoomJoinUrl(parsed)) {
    return { kind: "zoom", label: "Zoom" };
  }
  const lower = url.toLowerCase();
  if (lower.includes("teams.microsoft.com") || lower.includes("teams.live.com")) {
    return { kind: "teams", label: "Teams" };
  }
  if (lower.includes("meet.google.com")) {
    return { kind: "meet", label: "Google Meet" };
  }
  return { kind: "web", label: "Web link" };
}

function joinLinkSourceScore(source: JoinLinkSource): number {
  if (source === "location") return 20_000;
  if (source === "url") return 12_000;
  if (source === "description") return 0;
  return 0;
}

function resourceLinkSourceScore(source: ResourceLinkSource): number {
  if (source === "description") return 20_000;
  if (source === "url") return 8_000;
  if (source === "location") return 1_000;
  return 0;
}

function shouldIncludeWebJoinLink(url: string, fullValue: string, context: string, raw: string, source: JoinLinkSource): boolean {
  if (source === "generic" && isBareUrlValue(fullValue, raw)) return true;
  if (isLikelyGenericMeetingUrl(url)) return true;
  return /\b(join|meeting|meet|video|conference|call|room)\b/i.test(context);
}

function isBareUrlValue(value: string, raw: string): boolean {
  return trimUrl(value.trim()) === trimUrl(raw.trim());
}

function isLikelyGenericMeetingUrl(url: string): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  if (isZoomJoinUrl(parsed)) return true;
  const host = normalizedHost(parsed.hostname);
  const path = normalizedPathname(parsed).toLowerCase();
  if (/(^|\.)whereby\.com$/.test(host)) return true;
  if (/(^|\.)(webex|gotomeeting|bluejeans|ringcentral|chime\.aws)\./.test(host)) return true;
  return /\/(join|meet|meeting|room|conference|call)(\/|$)/.test(path);
}

function classifyContextualResourceLink(context: string): Pick<CalendarResourceLink, "kind" | "label"> | null {
  if (/\b(agenda|running agenda)\b/i.test(context)) return { kind: "web", label: "Agenda" };
  if (/\b(notes?|meeting notes?)\b/i.test(context)) return { kind: "web", label: "Notes" };
  if (/\b(deck|slides?)\b/i.test(context)) return { kind: "web", label: "Deck" };
  if (/\b(sheet|spreadsheet|tracker)\b/i.test(context)) return { kind: "web", label: "Sheet" };
  if (/\b(doc|document|resource|reference|pre[- ]?read|brief|plan)\b/i.test(context)) return { kind: "web", label: "Resource" };
  return null;
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
  const keyedSegment = ["j", "w", "u"].find((segment) => {
    const index = segments.findIndex((candidate) => candidate === segment);
    return index >= 0 && Boolean(segments[index + 1]);
  });
  if (keyedSegment) {
    const index = segments.findIndex((segment) => segment === keyedSegment);
    return `zoom:${keyedSegment}:${segments[index + 1].replace(/[-\s]/g, "")}`;
  }
  const wcJoinIndex = segments.findIndex((segment, index) => segment === "join" && segments[index - 1] === "wc");
  if (wcJoinIndex >= 0 && segments[wcJoinIndex + 1]) return `zoom:j:${segments[wcJoinIndex + 1].replace(/[-\s]/g, "")}`;

  const roomIndex = segments.findIndex((segment) => segment === "my");
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

function resourceLinkScore(url: string, kind: CalendarResourceLink["kind"]): number {
  const parsed = parseUrl(url);
  if (!parsed) return url.length;
  const path = parsed.pathname.toLowerCase();
  let score = url.length;
  if (kind !== "web") score += 1_000;
  if (path.includes("/edit")) score += 100;
  return score;
}

function isKnownMeetingBoilerplateUrl(url: string, kind: CalendarJoinLink["kind"]): boolean {
  const parsed = parseUrl(url);
  if (!parsed) return false;
  const host = normalizedHost(parsed.hostname);
  const path = parsed.pathname.toLowerCase();
  const full = url.toLowerCase();

  if (isStaticAssetUrl(parsed)) return true;
  if (isGeneratedCalendarActionUrl(url)) return true;
  if (isZoomRegistrationUrl(url)) return true;

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

function isZoomJoinUrl(url: URL): boolean {
  if (!isZoomHost(normalizedHost(url.hostname))) return false;
  const segments = normalizedPathSegments(url);
  if (["j", "my", "w", "u"].includes(segments[0]) && Boolean(segments[1])) return true;
  return segments[0] === "wc" && segments[1] === "join" && Boolean(segments[2]);
}

function isGeneratedCalendarActionUrl(value: string): boolean {
  const parsed = parseUrl(normalizeRawUrl(value));
  if (!parsed) return false;
  const host = normalizedHost(parsed.hostname);
  const path = normalizedPathname(parsed).toLowerCase();

  if (isStaticAssetUrl(parsed)) return true;

  if (isZoomHost(host)) {
    if (path.startsWith("/webinar/email/")) return true;
    if (path.includes("/calendar/")) return true;
    if (path.endsWith("/ics")) return true;
  }

  return false;
}

function isZoomRegistrationUrl(value: string): boolean {
  const parsed = parseUrl(normalizeRawUrl(value));
  if (!parsed) return false;
  return isZoomHost(normalizedHost(parsed.hostname)) && normalizedPathname(parsed).toLowerCase().startsWith("/webinar/register/");
}

function isZoomHost(host: string): boolean {
  return /(^|\.)zoom\.us$/.test(host);
}

function isStaticAssetUrl(url: URL): boolean {
  const path = normalizedPathname(url).toLowerCase();
  return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/.test(path);
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
