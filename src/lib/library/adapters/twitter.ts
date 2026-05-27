import type { LibrarySourceConfig, RawArtifact } from "../types";
import { MissingCredentialError } from "../errors";

export async function fetchTwitterArtifacts(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  const token = process.env.X_ACCESS_TOKEN || process.env.X_BEARER_TOKEN;
  if (!token) throw new MissingCredentialError(source.id, "X_ACCESS_TOKEN");
  const userId = String(source.metadata.user_id || process.env.X_USER_ID || "");
  if (!userId) throw new MissingCredentialError(source.id, "X_USER_ID");

  const folderId = typeof source.metadata.folder_id === "string" ? source.metadata.folder_id : null;
  const url = new URL(folderId
    ? `https://api.x.com/2/users/${userId}/bookmarks/folders/${folderId}`
    : `https://api.x.com/2/users/${userId}/bookmarks`);
  url.searchParams.set("max_results", String(source.metadata.max_results || 50));
  url.searchParams.set("tweet.fields", "created_at,author_id,entities");
  url.searchParams.set("expansions", "author_id");
  url.searchParams.set("user.fields", "username,name");

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`X bookmarks fetch failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as {
    data?: Array<{ id: string; text?: string; created_at?: string; author_id?: string; entities?: { urls?: Array<{ expanded_url?: string; url?: string }> } }>;
    includes?: { users?: Array<{ id: string; username?: string; name?: string }> };
  };
  const users = new Map((json.includes?.users || []).map((user) => [user.id, user]));
  return (json.data || []).map((tweet) => {
    const user = tweet.author_id ? users.get(tweet.author_id) : undefined;
    const expandedUrl = tweet.entities?.urls?.find((item) => item.expanded_url)?.expanded_url;
    return {
      url: `https://x.com/${user?.username || "i"}/status/${tweet.id}`,
      title: (tweet.text || `X bookmark ${tweet.id}`).slice(0, 120),
      author: user?.name || user?.username,
      date: tweet.created_at || new Date().toISOString(),
      content: tweet.text,
      metadata: { tweet_id: tweet.id, expanded_url: expandedUrl, folder_id: folderId, signal: "twitter_bookmark" },
    };
  });
}
