import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ArtifactFetchBatch, FetchArtifactsOptions, LibrarySourceConfig, RawArtifact } from "../types";
import { LibrarySourceBlockedError, MissingCredentialError } from "../errors";
import { isoNow } from "../utils";

const SUPERHUMAN_MCP_URL = "https://mcp.mail.superhuman.com/mcp";
const SUPERHUMAN_TIMEOUT_MS = 180000;
const SUPERHUMAN_READ_TOOL_ALLOWLIST = new Set(["list_threads", "get_thread"]);

interface SuperhumanMessage {
  message_id?: string;
  from?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  sent_at?: string;
}

interface SuperhumanThread {
  thread_id?: string;
  subject?: string;
  snippet?: string;
  participants?: unknown[];
  labels?: unknown[];
  splits?: unknown[];
  last_message_at?: string;
  last_message_id?: string;
  message_count?: number;
  messages?: SuperhumanMessage[];
}

interface SuperhumanThreadsResponse {
  threads?: SuperhumanThread[];
  next_cursor?: string;
}

function metadataString(source: LibrarySourceConfig, key: string): string | null {
  const value = source.metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function superhumanSplit(source: LibrarySourceConfig): string {
  const explicit = metadataString(source, "split");
  if (explicit) return explicit;

  try {
    const url = new URL(source.url);
    const fromPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (fromPath) return fromPath;
  } catch {
    // Source config validation already ensures a non-empty URL; fall back below.
  }

  return "News";
}

function superhumanLimit(source: LibrarySourceConfig, options: FetchArtifactsOptions = {}): number {
  const configured = Number(options.limit || source.metadata.max_results || source.backfill.limit || 25);
  if (!Number.isFinite(configured) || configured < 1) return 25;
  return Math.min(100, Math.floor(configured));
}

function mcpRemoteCommand(): string {
  return process.env.SUPERHUMAN_MCP_REMOTE_BIN || path.join(process.cwd(), "node_modules", ".bin", "mcp-remote");
}

function superhumanMcpArgs(): string[] {
  return [
    SUPERHUMAN_MCP_URL,
    "--transport",
    "http-only",
    "--silent",
    "--auth-timeout",
    "120",
    "--ignore-tool",
    "send*",
    "--ignore-tool",
    "create*",
    "--ignore-tool",
    "update*",
    "--ignore-tool",
    "trash*",
    "--ignore-tool",
    "mark_spam",
    "--ignore-tool",
    "unsubscribe",
    "--ignore-tool",
    "discard*",
    "--ignore-tool",
    "undo_send",
  ];
}

function textFromToolResult(result: unknown): string {
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const block = item as { type?: unknown; text?: unknown };
      return block.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function parseJsonToolResult<T>(result: unknown, sourceId: string, toolName: string): T {
  const text = textFromToolResult(result);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LibrarySourceBlockedError(`Superhuman MCP tool ${toolName} returned a non-JSON response.`, sourceId);
  }
}

function compactText(value: unknown): string {
  return typeof value === "string"
    ? value
      .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const value = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    if (lower.startsWith("#")) {
      const value = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(value) ? String.fromCodePoint(value) : match;
    }
    return named[lower] || match;
  });
}

function stripHtml(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/<\s*(script|style|head|svg)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr|table|section|article|blockquote)\s*>/gi, ".\n")
    .replace(/<\s*(p|div|h[1-6]|li|tr|table|section|article|blockquote)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/<[^>\n]{0,200}/g, " ")
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function cleanEmailText(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  return compactText(/<\/?[a-z][\s\S]*>/i.test(text) ? stripHtml(text) : text);
}

function maxContentChars(source: LibrarySourceConfig): number {
  const configured = Number(source.metadata.max_content_chars || 20000);
  return Number.isFinite(configured) && configured > 1000 ? Math.floor(configured) : 20000;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}... [truncated]`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => compactText(item)).filter(Boolean) : [];
}

function threadToArtifact(source: LibrarySourceConfig, thread: SuperhumanThread): RawArtifact | null {
  const threadId = compactText(thread.thread_id);
  if (!threadId) return null;

  const messages = Array.isArray(thread.messages) ? thread.messages : [];
  const primaryMessage = messages[0] || {};
  const title = compactText(thread.subject || primaryMessage.subject) || `Superhuman thread ${threadId}`;
  const snippet = cleanEmailText(thread.snippet || primaryMessage.snippet);
  const body = cleanEmailText(primaryMessage.body);
  const contentBody = truncateText(body, maxContentChars(source));
  const author = compactText(primaryMessage.from) || stringList(thread.participants)[0];
  const date = compactText(thread.last_message_at || primaryMessage.sent_at) || isoNow();
  const labels = stringList(thread.labels);
  const splits = stringList(thread.splits);

  const content = [
    contentBody,
    contentBody ? "" : snippet,
    `Subject: ${title}`,
    author ? `From: ${author}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    url: `superhuman://thread/${encodeURIComponent(threadId)}`,
    title,
    author: author || undefined,
    date,
    content,
    metadata: {
      source: "superhuman_news",
      format: "newsletter",
      thread_id: threadId,
      message_id: compactText(primaryMessage.message_id || thread.last_message_id) || undefined,
      split: superhumanSplit(source),
      labels,
      splits,
      participants: stringList(thread.participants),
      message_count: thread.message_count,
      excerpt: snippet || contentBody.slice(0, 500),
      content_truncated: body.length > contentBody.length,
    },
  };
}

export function parseSuperhumanThreads(source: LibrarySourceConfig, response: SuperhumanThreadsResponse | SuperhumanThread): RawArtifact[] {
  const threads = Array.isArray((response as SuperhumanThreadsResponse).threads)
    ? (response as SuperhumanThreadsResponse).threads || []
    : [response as SuperhumanThread];
  return threads.map((thread) => threadToArtifact(source, thread)).filter((artifact): artifact is RawArtifact => Boolean(artifact));
}

async function callAllowedTool(client: Client, source: LibrarySourceConfig, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (!SUPERHUMAN_READ_TOOL_ALLOWLIST.has(name)) {
    throw new LibrarySourceBlockedError(`Refusing to call non-read Superhuman MCP tool: ${name}`, source.id);
  }
  return client.callTool({ name, arguments: args }, undefined, { timeout: SUPERHUMAN_TIMEOUT_MS });
}

async function fetchSuperhumanArtifacts(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const client = new Client({ name: "hilt-superhuman-library", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: mcpRemoteCommand(),
    args: superhumanMcpArgs(),
    stderr: "pipe",
  });

  try {
    await client.connect(transport, { timeout: SUPERHUMAN_TIMEOUT_MS });
    const listArgs: Record<string, unknown> = {
      split: superhumanSplit(source),
      limit: superhumanLimit(source, options),
    };
    if (options.cursor) listArgs.cursor = options.cursor;
    const listResult = await callAllowedTool(client, source, "list_threads", listArgs);
    const listed = parseJsonToolResult<SuperhumanThreadsResponse>(listResult, source.id, "list_threads");
    const threads = Array.isArray(listed.threads) ? listed.threads : [];
    const fullThreads: SuperhumanThread[] = [];

    for (const thread of threads) {
      const threadId = compactText(thread.thread_id);
      if (!threadId) continue;
      try {
        const detailResult = await callAllowedTool(client, source, "get_thread", { thread_id: threadId });
        fullThreads.push(parseJsonToolResult<SuperhumanThread>(detailResult, source.id, "get_thread"));
      } catch {
        fullThreads.push(thread);
      }
    }

    return {
      artifacts: parseSuperhumanThreads(source, { threads: fullThreads }),
      cursor: options.cursor || null,
      next_cursor: listed.next_cursor || null,
    };
  } catch (error) {
    if (error instanceof LibrarySourceBlockedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new LibrarySourceBlockedError(
      `Superhuman MCP live access failed. Run \`codex mcp login superhuman-mail\` or \`npm run library:auth -- superhuman-news\`, complete browser login, then retry. Underlying error: ${message}`,
      source.id,
    );
  } finally {
    await client.close().catch(() => {});
  }
}

export async function fetchEmailArtifacts(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<RawArtifact[] | ArtifactFetchBatch> {
  if (source.fixtures?.length) return source.fixtures;
  if (source.url.startsWith("superhuman://")) {
    return fetchSuperhumanArtifacts(source, options);
  }
  throw new MissingCredentialError(source.id, "GMAIL_ACCESS_TOKEN");
}
