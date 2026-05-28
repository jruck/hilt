interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) body.set(key, value);
  }
  return body;
}

async function parseTokenResponse(response: Response, provider: string): Promise<string> {
  const json = await response.json().catch(() => ({})) as TokenResponse;
  if (!response.ok || !json.access_token) {
    const message = json.error_description || json.error || response.statusText;
    throw new Error(`${provider} token refresh failed: ${response.status} ${message}`);
  }
  return json.access_token;
}

export function hasGoogleRefreshCredentials(): boolean {
  return Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);
}

export async function refreshGoogleAccessToken(): Promise<string | null> {
  if (!hasGoogleRefreshCredentials()) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formBody({
      client_id: process.env.YOUTUBE_CLIENT_ID || "",
      client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN || "",
      grant_type: "refresh_token",
    }),
  });
  return parseTokenResponse(response, "Google OAuth");
}

export function hasXRefreshCredentials(): boolean {
  return Boolean(process.env.X_CLIENT_ID && process.env.X_REFRESH_TOKEN);
}

export async function refreshXAccessToken(): Promise<string | null> {
  if (!hasXRefreshCredentials()) return null;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (process.env.X_CLIENT_SECRET) {
    const encoded = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  }
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers,
    body: formBody({
      refresh_token: process.env.X_REFRESH_TOKEN || "",
      grant_type: "refresh_token",
      client_id: process.env.X_CLIENT_ID || "",
    }),
  });
  return parseTokenResponse(response, "X OAuth");
}
