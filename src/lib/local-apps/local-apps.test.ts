import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";
import { classify, groupServices, inferKind } from "./classifier";
import { localAppsDisabledResponseSchema } from "./contracts";
import { parseEndpoint, parseLsof } from "./adapters/macos";
import { probeServices } from "./probe";
import { PREVIEW_VIEWPORT_HEIGHT, PREVIEW_VIEWPORT_WIDTH, attachCachedPreviews, isPreviewableService, isSafePreviewFilename, previewCaptureUrls, previewPathForService, recordPreviewCaptureError } from "./preview";
import { preserveLocalAppsPreviews } from "./preview-merge";
import { redactSensitiveArgs } from "./redact";
import { defaultSettings, loadSettings } from "./settings";
import { stableId } from "./stable-id";
import { parseTailnetStatus, previewUrlForHost } from "./tailnet";
import type { LocalAppsEnabledResponse, ObservedService, ServiceGroup, Settings } from "./types";

const originalDataDir = process.env.DATA_DIR;
const originalPreviewCacheMs = process.env.HILT_LOCAL_APPS_PREVIEW_CACHE_MS;

afterEach(() => {
  if (originalDataDir === undefined) {
    delete process.env.DATA_DIR;
  } else {
    process.env.DATA_DIR = originalDataDir;
  }
  if (originalPreviewCacheMs === undefined) {
    delete process.env.HILT_LOCAL_APPS_PREVIEW_CACHE_MS;
  } else {
    process.env.HILT_LOCAL_APPS_PREVIEW_CACHE_MS = originalPreviewCacheMs;
  }
});

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...defaultSettings(),
    dev_roots: ["/Users/jane/work"],
    rules: [],
    ai: {
      enabled: false,
      endpoint: "http://127.0.0.1:11434",
      model: "llama3.2",
    },
    ...overrides,
  };
}

function observed(command: string, args: string, cwd: string | null, port: number): ObservedService {
  return {
    listener: {
      protocol: "TCP",
      host: "127.0.0.1",
      port,
      pid: port,
      command,
      user: "jane",
      parent_pid: 1,
    },
    process: {
      pid: port,
      parent_pid: 1,
      parent_chain: [1],
      cwd,
      executable: `/usr/local/bin/${command}`,
      args,
      start_time: "2026-05-21T12:00:00.000Z",
    },
  };
}

function localAppsResponse(groups: ServiceGroup[]): LocalAppsEnabledResponse {
  return {
    app: "hilt-local-apps",
    enabled: true,
    machine: {
      hostname: "test.local",
      tailscale_dns: "test.tail.ts.net",
      tailscale_ip4: "100.64.0.1",
      origin: "local",
    },
    groups,
    diagnostics: {
      scanned_at: "2026-05-21T12:00:00.000Z",
      is_scanning: false,
      duration_ms: 1,
      listener_count: 1,
      group_count: groups.length,
      visible_group_count: groups.length,
      errors: [],
    },
  };
}

describe("local apps macOS collector parsing", () => {
  test("parses lsof records", () => {
    const raw = "p397\ncDia\nLjruck\nPTCP\nn127.0.0.1:9222\nTST=LISTEN\np7118\ncmysqld\nLjruck\nPTCP\nn127.0.0.1:3306\n";
    const listeners = parseLsof(raw);
    assert.equal(listeners.length, 2);
    assert.equal(listeners[0].pid, 397);
    assert.equal(listeners[0].host, "127.0.0.1");
    assert.equal(listeners[0].port, 9222);
    assert.equal(listeners[1].command, "mysqld");
  });

  test("parses IPv6 endpoints", () => {
    assert.deepEqual(parseEndpoint("[::1]:42050"), ["::1", 42050]);
  });
});

describe("local apps identity and classification", () => {
  test("stable ID matches Port Authority FNV-1a", () => {
    assert.equal(stableId("svc:123:127.0.0.1:3000:npm run dev"), "e7af83764e7b9df0");
    assert.equal(stableId("group:/Users/jane/work/hilt:main:next-server"), "faab51f3e960ee8a");
  });

  test("classifies key service kinds", () => {
    assert.equal(inferKind(3000, "next-server npm run dev"), "fullstack");
    assert.equal(inferKind(3001, "tsx server/ws-server.ts"), "backend");
    assert.equal(inferKind(11434, "ollama serve"), "infra");
  });

  test("keeps browser debug noise hidden", () => {
    const service = classify(observed("Dia", "Dia --remote-debugging-port=9222", "/Applications/Dia.app", 9222), settings());
    assert.equal(service.kind, "browser_debug");
    assert.equal(service.visible, false);
  });

  test("groups same repo and branch into one app", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-local-apps-"));
    fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ name: "@jruck/hilt" }));
    fs.mkdirSync(path.join(temp, ".git"));
    const services = [
      classify(observed("next-server", "next dev", temp, 3000), settings({ dev_roots: [os.tmpdir()] })),
      classify(observed("node", "tsx server/ws-server.ts", temp, 3001), settings({ dev_roots: [os.tmpdir()] })),
    ];
    services.forEach((service) => {
      service.project.git_root = temp;
      service.project.branch = "main";
      service.project.package_name = "jruck / hilt";
    });
    const groups = groupServices(services, settings({ dev_roots: [os.tmpdir()] }));
    assert.equal(groups.length, 1);
    assert.equal(groups[0].services.length, 2);
    assert.equal(groups[0].title, "jruck / hilt / main");
  });

  test("groups package-manager infrastructure by service command", () => {
    const services = [
      classify(observed("nginx", "nginx: worker process", "/opt/homebrew", 80), settings()),
      classify(observed("mysqld", "/opt/homebrew/opt/mysql/bin/mysqld", "/opt/homebrew/var/mysql", 3306), settings()),
      classify(observed("mysqld", "/opt/homebrew/opt/mysql/bin/mysqld", "/opt/homebrew/var/mysql", 33060), settings()),
    ];
    services.forEach((service) => {
      service.project.git_root = "/opt/homebrew";
      service.project.branch = "main";
      service.project.package_name = "homebrew";
      service.visible = true;
    });

    const groups = groupServices(services, settings());
    assert.deepEqual(groups.map((group) => group.title).sort(), ["mysql", "nginx"]);
    assert.deepEqual(groups.find((group) => group.title === "mysql")?.ports, [3306, 33060]);
  });
});

describe("local apps settings, health, and safety", () => {
  test("loads default settings into Hilt data dir", () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-local-apps-settings-"));
    process.env.DATA_DIR = temp;
    const loaded = loadSettings();
    assert.equal(loaded.scan_interval_ms, 5000);
    assert.equal(fs.existsSync(path.join(temp, "local-apps", "settings.json")), true);
  });

  test("redacts common secret forms", () => {
    const redacted = redactSensitiveArgs("node server.js --token abc123 api_key=xyz Authorization: Bearer hello");
    assert.match(redacted, /--token \[redacted\]/);
    assert.match(redacted, /api_key=\[redacted\]/);
    assert.doesNotMatch(redacted, /abc123|xyz|hello/);
  });

  test("marks infra as listening without HTTP probing", async () => {
    const service = classify(observed("ollama", "ollama serve", null, 11434), settings());
    await probeServices([service]);
    assert.equal(service.health.status, "up");
    assert.equal(service.health.label, "Listening");
  });

  test("builds tailnet preview URL with IPv6-safe host formatting", () => {
    assert.equal(previewUrlForHost("xochipilli.tailc0acaa.ts.net", 3000), "http://xochipilli.tailc0acaa.ts.net:3000");
    assert.equal(previewUrlForHost("fd7a:115c:a1e0::1", 3000), "http://[fd7a:115c:a1e0::1]:3000");
  });

  test("parses tailnet peers for remote Hilt discovery", () => {
    const parsed = parseTailnetStatus(JSON.stringify({
      Self: {
        HostName: "Xochipilli",
        DNSName: "xochipilli.tailc0acaa.ts.net.",
        TailscaleIPs: ["100.104.52.2"],
        OS: "macOS",
      },
      Peer: {
        "node-1": {
          HostName: "Mercury-V",
          DNSName: "mercury-v.tailc0acaa.ts.net.",
          Online: true,
          OS: "macOS",
          TailscaleIPs: ["100.80.0.95"],
        },
      },
    }));

    assert.equal(parsed?.self?.dns_name, "xochipilli.tailc0acaa.ts.net");
    assert.equal(parsed?.peers[0].hostname, "Mercury-V");
    assert.equal(parsed?.peers[0].ip4, "100.80.0.95");
    assert.equal(parsed?.peers[0].online, true);
  });

  test("validates disabled API contract", () => {
    const parsed = localAppsDisabledResponseSchema.parse({
      app: "hilt-local-apps",
      enabled: false,
      reason: "HILT_LOCAL_APPS_ENABLED is not true",
    });
    assert.equal(parsed.enabled, false);
  });

  test("rejects unsafe preview filenames", () => {
    assert.equal(isSafePreviewFilename("abc123.png"), true);
    assert.equal(isSafePreviewFilename("../abc123.png"), false);
    assert.equal(isSafePreviewFilename("nested\\abc123.png"), false);
    assert.equal(isSafePreviewFilename("abc123.jpg"), false);
  });

  test("captures previews from tailnet URL first for healthy web services", () => {
    const service = classify(observed("next-server", "next dev", "/Users/jane/work/hilt", 3000), settings());
    service.visible = true;
    service.preview_url = "http://hilt.tail.ts.net:3000";
    service.url_candidates = ["http://127.0.0.1:3000", "http://0.0.0.0:3000"];
    service.health = {
      status: "up",
      label: "200 OK",
      http_status: 200,
      latency_ms: 10,
      checked_at: "2026-05-21T12:00:00.000Z",
      error: null,
      url: "http://127.0.0.1:3000/",
    };

    assert.equal(isPreviewableService(service), true);
    assert.deepEqual(previewCaptureUrls(service), [
      "http://hilt.tail.ts.net:3000",
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:3000",
    ]);
  });

  test("captures previews in the same 16:9 shape as app cards", () => {
    assert.equal(PREVIEW_VIEWPORT_WIDTH, 1280);
    assert.equal(PREVIEW_VIEWPORT_HEIGHT, 720);
    assert.equal(PREVIEW_VIEWPORT_WIDTH / PREVIEW_VIEWPORT_HEIGHT, 16 / 9);
  });

  test("only previews healthy HTTP services", () => {
    const notFound = classify(observed("node", "tsx server/ws-server.ts", "/Users/jane/work/hilt", 3001), settings());
    notFound.visible = true;
    notFound.health = {
      status: "down",
      label: "404 Not Found",
      http_status: 404,
      latency_ms: 10,
      checked_at: "2026-05-21T12:00:00.000Z",
      error: null,
      url: "http://127.0.0.1:3001/",
    };

    const infra = classify(observed("ollama", "ollama serve", null, 11434), settings());
    infra.visible = true;
    infra.health = {
      status: "up",
      label: "Listening",
      http_status: null,
      latency_ms: null,
      checked_at: "2026-05-21T12:00:00.000Z",
      error: null,
      url: null,
    };

    assert.equal(isPreviewableService(notFound), false);
    assert.equal(isPreviewableService(infra), false);
  });

  test("keeps the last good preview when a refresh capture fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-local-apps-preview-"));
    process.env.DATA_DIR = dir;
    process.env.HILT_LOCAL_APPS_PREVIEW_CACHE_MS = "0";

    const service = classify(observed("next-server", "next dev", "/Users/jane/work/hilt", 3000), settings());
    service.visible = true;
    const previewPath = previewPathForService(service.id);
    fs.mkdirSync(path.dirname(previewPath), { recursive: true });
    fs.writeFileSync(previewPath, "png");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(previewPath, old, old);

    attachCachedPreviews([service]);
    assert.equal(service.preview?.path, previewPath);
    assert.equal(service.preview?.stale, true);

    recordPreviewCaptureError(service, "Preview capture failed");
    assert.equal(service.preview?.path, previewPath);
    assert.ok(Math.abs(Date.parse(service.preview?.captured_at || "") - old.getTime()) < 1000);
    assert.equal(service.preview?.error, "Preview capture failed");
    assert.ok(service.preview?.error_at);
  });

  test("preserves preview metadata when a newer snapshot omits the screenshot path", () => {
    const previousService = classify(observed("next-server", "next dev", "/Users/jane/work/hilt", 3000), settings());
    previousService.visible = true;
    previousService.preview = {
      path: "/tmp/hilt-preview.png",
      captured_at: "2026-05-21T12:00:00.000Z",
      error: null,
    };
    const [previousGroup] = groupServices([previousService], settings());

    const incomingService = classify(observed("next-server", "next dev", "/Users/jane/work/hilt", 3000), settings());
    incomingService.id = "new-process-id";
    incomingService.visible = true;
    incomingService.preview = null;
    const [incomingGroup] = groupServices([incomingService], settings());

    const merged = preserveLocalAppsPreviews(
      localAppsResponse([incomingGroup]),
      localAppsResponse([previousGroup]),
    );

    assert.equal(merged.groups[0].services[0].preview?.path, "/tmp/hilt-preview.png");
  });
});
