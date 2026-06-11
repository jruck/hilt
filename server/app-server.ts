/**
 * Hilt web service entrypoint: one http.Server that
 *
 *   1. delegates ordinary HTTP to the Next request handler (App Router and
 *      API routes unchanged), and
 *   2. owns the WebSocket upgrade for `${basePath}/events` and proxies the
 *      upgraded socket to the internal ws-server (server/ws-server.ts) on
 *      127.0.0.1. The ws-server keeps all file-watch/broadcast logic and
 *      /navigate stays a localhost-only POST on it.
 *
 * This is what lets real-time events ride the single Tailscale Serve route
 * (/hilt -> :3000) instead of a second open port. Run unprefixed for ordinary
 * local dev (`npm run dev`, replaces `next dev`) and with
 * NEXT_PUBLIC_BASE_PATH=/hilt + HILT_DIST_DIR=.next-gateway for the
 * launchd-managed gateway service (`npm run start:gateway`).
 */
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import type { Duplex } from "stream";
import next from "next";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

// Electron spawns `npm run dev -- --port <n>`; honor that alongside PORT/HOST.
function portFromArgv(): number | null {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" || argv[i] === "-p") {
      const n = parseInt(argv[i + 1] ?? "", 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = portFromArgv() ?? parseInt(process.env.PORT || "3000", 10);

// Normalized like next.config.ts / src/lib/base-path.ts: leading slash, no
// trailing slash, "" when unset.
const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const basePath =
  rawBasePath && rawBasePath !== "/"
    ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
    : "";

const WS_PORT_FILE = path.join(process.env.HOME || "~", ".hilt-ws-port");

/** The internal ws-server's current port (it probes and writes the file). */
function readWsPort(): number | null {
  try {
    const wsPort = parseInt(fs.readFileSync(WS_PORT_FILE, "utf-8").trim(), 10);
    return Number.isFinite(wsPort) ? wsPort : null;
  } catch {
    return null;
  }
}

/**
 * Proxy a WebSocket upgrade to the internal ws-server's /events endpoint on
 * loopback. Raw socket splice — the ws-server's own `ws` instance still does
 * the protocol work, so no event logic is re-implemented here.
 */
function proxyEventsUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
  const wsPort = readWsPort();
  if (!wsPort) {
    // ws-server not running (no port file) — drop the upgrade; the client
    // hook reconnects with backoff once it comes up.
    socket.destroy();
    return;
  }

  const query = (req.url || "").split("?")[1];
  const proxyReq = http.request({
    host: "127.0.0.1",
    port: wsPort,
    path: query ? `/events?${query}` : "/events",
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${wsPort}` },
  });

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    const headerLines: string[] = [];
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) {
      headerLines.push(`${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}`);
    }
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n${headerLines.join("\r\n")}\r\n\r\n`
    );
    if (proxyHead.length) proxySocket.unshift(proxyHead);

    proxySocket.on("error", () => socket.destroy());
    socket.on("error", () => proxySocket.destroy());
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  // Upstream answered with a plain response instead of 101 — refuse.
  proxyReq.on("response", (res) => {
    console.error(`[events-proxy] upstream refused upgrade: HTTP ${res.statusCode}`);
    socket.destroy();
  });
  proxyReq.on("error", (err) => {
    console.error(`[events-proxy] upstream error: ${err.message}`);
    socket.destroy();
  });

  if (head.length) socket.unshift(head);
  proxyReq.end();
}

const app = next({ dev, hostname, port });
const handleRequest = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  const eventsPath = `${basePath}/events`;
  const isEventsUpgrade = (url: string) =>
    url === eventsPath || url.startsWith(`${eventsPath}?`);

  const rawOn = server.on.bind(server);

  rawOn("upgrade", (req, socket, head) => {
    if (isEventsUpgrade(req.url || "")) {
      proxyEventsUpgrade(req, socket, head);
    } else if (server.listenerCount("upgrade") === 1) {
      // Production: Next attaches no upgrade listener of its own, so nothing
      // else will answer — refuse instead of leaving the socket hanging.
      socket.destroy();
    }
    // Otherwise Next's own (guarded, see below) listener handles it — dev HMR.
  });

  // Next's custom-server integration lazily attaches its own `upgrade`
  // listener (grabbed via req.socket.server on the first request) and ends
  // sockets on paths it doesn't own — which would kill the /events proxy.
  // Guard any upgrade listener registered after ours so it never sees the
  // /events upgrades we proxy; everything else (dev HMR) passes through.
  const guardedOn = ((event: string, listener: (...args: never[]) => void) => {
    if (event !== "upgrade") return rawOn(event as "upgrade", listener as never);
    return rawOn("upgrade", (req, socket, head) => {
      if (isEventsUpgrade(req.url || "")) return;
      (listener as (...args: unknown[]) => void)(req, socket, head);
    });
  }) as typeof server.on;
  server.on = guardedOn;
  server.addListener = guardedOn;

  server.listen(port, hostname, () => {
    console.log(
      `Hilt web service listening on http://${hostname}:${port}${basePath} (${dev ? "dev" : "production"})`
    );
    console.log(
      `  ${eventsPath} upgrades proxied to ws-server on 127.0.0.1 (port file: ${WS_PORT_FILE})`
    );
  });
});
