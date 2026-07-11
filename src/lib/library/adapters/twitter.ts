import { execFile } from "child_process";
import { promisify } from "util";
import type { ArtifactFetchBatch, FetchArtifactsOptions, LibrarySourceConfig, RawArtifact } from "../types";
import { LibrarySourceBlockedError, MissingCredentialError } from "../errors";
import { refreshXAccessToken } from "../oauth";
import { isXVideoUrl, looksLikeThreadRoot } from "../media";

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

function stripUrls(input: string): string {
  return input.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
}

function cleanTweetTitle(text: string, tweetId: string, author?: string): string {
  const withoutUrls = stripUrls(text).replace(/[ \t:;,-]+$/g, "").trim();
  if (withoutUrls) return withoutUrls.slice(0, 120);
  return author ? `X bookmark by ${author}` : `X bookmark ${tweetId}`;
}

interface XArticlePayload {
  title?: string;
  plain_text?: string;
  preview_text?: string;
  cover_media?: string;
}

interface TwitterTweetPayload {
  id: string;
  text?: string;
  created_at?: string;
  author_id?: string;
  conversation_id?: string;
  note_tweet?: { text?: string };
  article?: XArticlePayload;
  attachments?: { media_keys?: string[] };
  entities?: { urls?: Array<{ expanded_url?: string; unwound_url?: string; url?: string }> };
}

interface TwitterBookmarksPayload {
  data?: TwitterTweetPayload[];
  includes?: {
    users?: Array<{ id: string; username?: string; name?: string }>;
    media?: Array<{ media_key: string; type?: string; url?: string; preview_image_url?: string; duration_ms?: number }>;
  };
  meta?: { next_token?: string; result_count?: number };
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

export function parseTwitterBookmarks(source: LibrarySourceConfig, json: TwitterBookmarksPayload): RawArtifact[] {
  const folderId = typeof source.metadata.folder_id === "string" ? source.metadata.folder_id : null;
  const folderName = typeof source.metadata.folder_name === "string" ? source.metadata.folder_name : null;
  const users = new Map((json.includes?.users || []).map((user) => [user.id, user]));
  const mediaByKey = new Map((json.includes?.media || []).map((media) => [media.media_key, media]));
  return (json.data || []).map((tweet) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const canonicalUrl = `https://x.com/${user?.username || "i"}/status/${tweet.id}`;
    const expandedUrl = tweet.entities?.urls?.find((item) => item.expanded_url || item.unwound_url)?.expanded_url
      || tweet.entities?.urls?.find((item) => item.unwound_url)?.unwound_url;
    const media = (tweet.attachments?.media_keys || [])
      .map((key) => mediaByKey.get(key))
      .filter((item): item is NonNullable<ReturnType<typeof mediaByKey.get>> => Boolean(item))
      .map((item) => ({
        link: item.url || item.preview_image_url,
        ...(item.preview_image_url ? { preview_image_url: item.preview_image_url } : {}),
        type: item.type === "photo" ? "image" : item.type,
        source: "x_bookmark",
      }))
      .filter((item) => typeof item.link === "string" && item.link.length > 0);
    const thumbnail = media.find((item) => item.type === "image")?.link || media.find((item) => item.type === "video")?.link;
    const attachedVideo = (tweet.attachments?.media_keys || [])
      .map((key) => mediaByKey.get(key))
      .find((item) => item?.type === "video" || item?.type === "animated_gif");
    const videoUrl = expandedUrl && isXVideoUrl(expandedUrl)
      ? expandedUrl
      : attachedVideo
        ? `${canonicalUrl}/video/1`
        : undefined;
    const articleTitle = sanitizeUnicode(tweet.article?.title || "").trim();
    const articleText = sanitizeUnicode(tweet.article?.plain_text || "").trim();
    // X Articles are the canonical long-form source. For ordinary posts, prefer note_tweet (up to
    // 25k chars) over the 280-character public text field.
    const text = articleText || sanitizeUnicode(tweet.note_tweet?.text || tweet.text || `X bookmark ${tweet.id}`);
    // conversation_id === id means the tweet is the root of its own thread; without a note_tweet body
    // and with thread markers, its continuation is in reply tweets we can't fetch (no search access).
    const partialThread = Boolean(
      tweet.conversation_id && tweet.conversation_id === tweet.id && !tweet.note_tweet?.text && !articleText && looksLikeThreadRoot(text),
    );
    const author = user?.name ? sanitizeUnicode(user.name) : user?.username;
    return {
      url: canonicalUrl,
      title: articleTitle || cleanTweetTitle(text, tweet.id, author),
      author,
      date: tweet.created_at || new Date().toISOString(),
      thumbnail,
      content: text,
      metadata: {
        tweet_id: tweet.id,
        expanded_url: expandedUrl,
        x_article_title: articleTitle || undefined,
        x_article_preview: tweet.article?.preview_text || undefined,
        x_article_cover_media: tweet.article?.cover_media || undefined,
        x_article_captured: articleText ? true : undefined,
        video_url: videoUrl,
        video_duration_seconds: typeof attachedVideo?.duration_ms === "number" ? Math.round(attachedVideo.duration_ms / 1000) : undefined,
        folder_id: folderId,
        source_folder_id: folderId,
        source_folder: folderName,
        signal: "twitter_bookmark",
        media,
        ...(partialThread ? { partial_thread: true } : {}),
      },
    };
  });
}

async function enrichXurlArticleFields(
  xurlBin: string,
  json: TwitterBookmarksPayload,
  username?: string,
): Promise<TwitterBookmarksPayload> {
  const articleIds = (json.data || [])
    .filter((tweet) => !tweet.article?.plain_text && tweet.entities?.urls?.some((item) =>
      /^https?:\/\/(?:www\.)?x\.com\/i\/article\/\d+/i.test(item.expanded_url || item.unwound_url || ""),
    ))
    .map((tweet) => tweet.id);
  if (!articleIds.length) return json;

  try {
    const apiPath = `/2/tweets?ids=${articleIds.join(",")}&tweet.fields=article`;
    const args = ["-X", "GET", apiPath, "--auth", "oauth2"];
    if (username) args.push("--username", username);
    const { stdout } = await execFileAsync(xurlBin, args, { timeout: 30000, maxBuffer: 1024 * 1024 * 16 });
    const enriched = JSON.parse(stripAnsi(stdout)) as { data?: Array<{ id: string; article?: XArticlePayload }> };
    const byId = new Map((enriched.data || []).map((tweet) => [tweet.id, tweet.article]));
    return {
      ...json,
      data: (json.data || []).map((tweet) => ({ ...tweet, article: byId.get(tweet.id) || tweet.article })),
    };
  } catch (error) {
    console.warn(`[library] X Article enrichment failed; keeping bookmark metadata: ${error instanceof Error ? error.message : String(error)}`);
    return json;
  }
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
  url.searchParams.set("tweet.fields", "created_at,author_id,entities,attachments,note_tweet,conversation_id,article");
  url.searchParams.set("expansions", "author_id,attachments.media_keys");
  url.searchParams.set("user.fields", "username,name");
  url.searchParams.set("media.fields", "media_key,type,url,preview_image_url,duration_ms");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`X bookmarks fetch failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as TwitterBookmarksPayload;
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
    const parsed = JSON.parse(stripAnsi(stdout)) as TwitterBookmarksPayload;
    const json = await enrichXurlArticleFields(
      xurlBin,
      parsed,
      typeof source.metadata.xurl_username === "string" ? source.metadata.xurl_username : undefined,
    );
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
