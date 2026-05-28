import { execFile } from "child_process";
import { promisify } from "util";
import type { ArtifactFetchBatch, FetchArtifactsOptions, LibrarySourceConfig, RawArtifact } from "../types";
import { LibrarySourceBlockedError, MissingCredentialError } from "../errors";
import { refreshXAccessToken } from "../oauth";

const execFileAsync = promisify(execFile);

function stripAnsi(input: string): string {
  return input.replace(/\u001b\[[0-9;]*m/g, "");
}

function sanitizeUnicode(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index] + input[index + 1];
        index += 1;
      } else {
        output += "\uFFFD";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      output += "\uFFFD";
    } else {
      output += input[index];
    }
  }
  return output;
}

function xurlSetupMessage(xurlBin: string): string {
  return [
    "xurl has no OAuth app registered.",
    `Register one locally with \`${xurlBin} auth apps add bridge-library --client-id <id> --client-secret <secret> --redirect-uri http://localhost:8080/callback\`.`,
    `Then run \`${xurlBin} auth default bridge-library\` and \`${xurlBin} auth oauth2 --app bridge-library\`.`,
    "The redirect URI must exactly match an allowed callback URL in the X Developer Portal.",
  ].join(" ");
}

export function formatXurlFailureMessage(xurlBin: string, error: Error & { stderr?: string; stdout?: string }): string {
  const detail = stripAnsi(error.stderr || error.stdout || "").trim();
  const message = detail || error.message || String(error);
  if (/no apps registered/i.test(message)) return xurlSetupMessage(xurlBin);
  return message;
}

export function parseTwitterBookmarks(source: LibrarySourceConfig, json: {
  data?: Array<{ id: string; text?: string; created_at?: string; author_id?: string; entities?: { urls?: Array<{ expanded_url?: string; url?: string }> } }>;
  includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
}): RawArtifact[] {
  const folderId = typeof source.metadata.folder_id === "string" ? source.metadata.folder_id : null;
  const users = new Map((json.includes?.users || []).map((user) => [user.id, user]));
  return (json.data || []).map((tweet) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const expandedUrl = tweet.entities?.urls?.find((item) => item.expanded_url)?.expanded_url;
    const text = sanitizeUnicode(tweet.text || `X bookmark ${tweet.id}`);
    return {
      url: `https://x.com/${user?.username || "i"}/status/${tweet.id}`,
      title: text.slice(0, 120),
      author: user?.name ? sanitizeUnicode(user.name) : user?.username,
      date: tweet.created_at || new Date().toISOString(),
      content: text,
      metadata: { tweet_id: tweet.id, expanded_url: expandedUrl, folder_id: folderId, signal: "twitter_bookmark" },
    };
  });
}

async function fetchTwitterArtifactsWithToken(
  source: LibrarySourceConfig,
  token: string,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const userId = String(source.metadata.user_id || process.env.X_USER_ID || "");
  if (!userId) throw new MissingCredentialError(source.id, "X_USER_ID");
  const folderId = typeof source.metadata.folder_id === "string" ? source.metadata.folder_id : null;
  const url = new URL(folderId
    ? `https://api.x.com/2/users/${userId}/bookmarks/folders/${folderId}`
    : `https://api.x.com/2/users/${userId}/bookmarks`);
  url.searchParams.set("max_results", String(options.limit || source.metadata.max_results || 50));
  if (options.cursor) url.searchParams.set("pagination_token", options.cursor);
  url.searchParams.set("tweet.fields", "created_at,author_id,entities");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`X bookmarks fetch failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as {
    data?: Array<{ id: string; text?: string; created_at?: string; author_id?: string; entities?: { urls?: Array<{ expanded_url?: string; url?: string }> } }>;
    includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
    meta?: { next_token?: string; result_count?: number };
  };
  return {
    artifacts: parseTwitterBookmarks(source, json),
    cursor: options.cursor || null,
    next_cursor: json.meta?.next_token || null,
  };
}

async function fetchTwitterArtifactsWithXurl(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const xurlBin = String(source.metadata.xurl_path || process.env.XURL_BIN || "xurl");
  const args = ["bookmarks", "--auth", "oauth2", "-n", String(options.limit || source.metadata.max_results || 50)];
  if (typeof source.metadata.xurl_username === "string") {
    args.push("--username", source.metadata.xurl_username);
  }
  if (options.cursor) {
    args.push("--pagination-token", options.cursor);
  }

  try {
    const appList = await execFileAsync(xurlBin, ["auth", "apps", "list"], { timeout: 10000, maxBuffer: 1024 * 1024 });
    if (/no apps registered/i.test(stripAnsi(appList.stdout))) {
      throw new LibrarySourceBlockedError(xurlSetupMessage(xurlBin), source.id);
    }
    const { stdout } = await execFileAsync(xurlBin, args, { timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
    const json = JSON.parse(stripAnsi(stdout)) as {
      data?: Array<{ id: string; text?: string; created_at?: string; author_id?: string; entities?: { urls?: Array<{ expanded_url?: string; url?: string }> } }>;
      includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
      meta?: { next_token?: string; result_count?: number };
    };
    return {
      artifacts: parseTwitterBookmarks(source, json),
      cursor: options.cursor || null,
      next_cursor: json.meta?.next_token || null,
    };
  } catch (error) {
    if (error instanceof LibrarySourceBlockedError) throw error;
    const commandError = error as Error & { stderr?: string; stdout?: string };
    const message = formatXurlFailureMessage(xurlBin, commandError);
    throw new LibrarySourceBlockedError(`xurl bookmarks failed: ${message}`, source.id);
  }
}

export async function fetchTwitterArtifacts(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<RawArtifact[] | ArtifactFetchBatch> {
  if (source.metadata.auth_provider === "xurl" || process.env.X_USE_XURL === "1") {
    return fetchTwitterArtifactsWithXurl(source, options);
  }

  const token = process.env.X_ACCESS_TOKEN || process.env.X_BEARER_TOKEN || await refreshXAccessToken();
  if (!token) throw new MissingCredentialError(source.id, "X_ACCESS_TOKEN or X_CLIENT_ID/X_REFRESH_TOKEN");
  try {
    return await fetchTwitterArtifactsWithToken(source, token, options);
  } catch (error) {
    if (!process.env.X_ACCESS_TOKEN && !process.env.X_BEARER_TOKEN) throw error;
    const refreshed = await refreshXAccessToken();
    if (!refreshed) throw error;
    return fetchTwitterArtifactsWithToken(source, refreshed, options);
  }
}
