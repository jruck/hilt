import { loadEnvConfig } from "@next/env";
import crypto from "crypto";
import fs from "fs";
import http from "http";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const SCOPE = "https://www.googleapis.com/auth/youtube.readonly";

interface OAuthClientFile {
  installed?: {
    client_id?: string;
    client_secret?: string;
  };
  web?: {
    client_id?: string;
    client_secret?: string;
  };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function readClient(filePath: string): { clientId: string; clientSecret: string } {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as OAuthClientFile;
  const client = parsed.installed || parsed.web;
  if (!client?.client_id || !client.client_secret) {
    throw new Error("OAuth client file must contain installed.client_id/client_secret or web.client_id/client_secret.");
  }
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

function updateEnvFile(values: Record<string, string>): void {
  const envPath = path.join(process.cwd(), ".env.local");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";
  const lines = existing.split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const index = lines.findIndex((line) => line === `${key}=` || line.startsWith(`${key}=`) || line === `# ${key}=` || line.startsWith(`# ${key}=`));
    if (index >= 0) {
      lines[index] = `${key}=${value}`;
    } else {
      lines.push(`${key}=${value}`);
    }
  }
  fs.writeFileSync(envPath, lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", "utf-8");
}

async function waitForCode(server: http.Server): Promise<{ code: string; redirectUri: string }> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OAuth callback server did not bind to a TCP port.");
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for YouTube OAuth callback.")), 180000);
    server.on("request", (request, response) => {
      try {
        const url = new URL(request.url || "/", redirectUri);
        if (url.pathname !== "/oauth2callback") {
          response.writeHead(404).end("Not found");
          return;
        }
        const error = url.searchParams.get("error");
        if (error) throw new Error(`OAuth error: ${error}`);
        const code = url.searchParams.get("code");
        if (!code) throw new Error("OAuth callback did not include a code.");
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end("<html><body><h1>YouTube OAuth complete</h1><p>You can close this tab.</p></body></html>");
        clearTimeout(timer);
        resolve({ code, redirectUri });
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  });
}

async function main() {
  const clientFile = argValue("--client-file") || process.env.YOUTUBE_OAUTH_CLIENT_FILE;
  if (!clientFile) {
    throw new Error("Pass --client-file /path/to/client_secret.json or set YOUTUBE_OAUTH_CLIENT_FILE.");
  }
  const { clientId, clientSecret } = readClient(clientFile);
  const state = crypto.randomBytes(16).toString("hex");
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const pendingCode = waitForCode(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("OAuth callback server did not bind to a TCP port.");
  const redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  console.log(`Opening Google OAuth approval for scope: ${SCOPE}`);
  await execFileAsync("open", [authUrl.toString()]);
  const { code } = await pendingCode.finally(() => server.close());

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = await response.json() as TokenResponse;
  if (!response.ok || !json.access_token) {
    throw new Error(`Token exchange failed: ${response.status} ${json.error_description || json.error || response.statusText}`);
  }

  updateEnvFile({
    YOUTUBE_CLIENT_ID: clientId,
    YOUTUBE_CLIENT_SECRET: clientSecret,
    YOUTUBE_OAUTH_ACCESS_TOKEN: json.access_token,
    ...(json.refresh_token ? { YOUTUBE_REFRESH_TOKEN: json.refresh_token } : {}),
  });

  console.log(JSON.stringify({
    ok: true,
    wrote_env_keys: [
      "YOUTUBE_CLIENT_ID",
      "YOUTUBE_CLIENT_SECRET",
      "YOUTUBE_OAUTH_ACCESS_TOKEN",
      ...(json.refresh_token ? ["YOUTUBE_REFRESH_TOKEN"] : []),
    ],
    token_values_printed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
