"use strict";
/**
 * Shared app-server mode + supervisor protocol (docs/plans/supervisor-v1.md).
 *
 * ONE implementation consumed by three parties:
 *  - electron/main.ts        — Electron-as-supervisor (laptops / fallback servers)
 *  - server/supervisor.ts    — the headless launchd daemon (server machines)
 *  - src/lib/system/*        — the Next server reporting its own supervision state
 *
 * The protocol is four JSON files under DATA_DIR:
 *  - app-mode.json                 durable mode choice ("dev" | "prod")
 *  - app-mode-intent.json          switch request written by POST /api/system/app-mode
 *  - app-supervisor.json           supervisor heartbeat (freshness gates the switch UI)
 *  - app-supervisor-children.json  child pids for crash re-adoption (daemon only)
 *
 * Everything here is plain Node — no Electron, no Next imports — so all three
 * consumers (tsc for electron, Next's bundler, tsx) can share it.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEARTBEAT_FRESH_MS = exports.HEARTBEAT_INTERVAL_MS = exports.REBUILD_STAMP_RELPATH = exports.PROD_DIST_DIR = void 0;
exports.defaultDataDir = defaultDataDir;
exports.appModeStatePath = appModeStatePath;
exports.appModeIntentPath = appModeIntentPath;
exports.supervisorHeartbeatPath = supervisorHeartbeatPath;
exports.supervisorChildrenPath = supervisorChildrenPath;
exports.readPersistedAppMode = readPersistedAppMode;
exports.persistAppMode = persistAppMode;
exports.initialAppMode = initialAppMode;
exports.prodBuildAvailable = prodBuildAvailable;
exports.resolveServerMode = resolveServerMode;
exports.nextSpawnSpec = nextSpawnSpec;
exports.writeSupervisorHeartbeat = writeSupervisorHeartbeat;
exports.readSupervisorHeartbeat = readSupervisorHeartbeat;
exports.isHeartbeatFresh = isHeartbeatFresh;
exports.clearSupervisorHeartbeat = clearSupervisorHeartbeat;
exports.writeAppModeIntent = writeAppModeIntent;
exports.readAppModeIntent = readAppModeIntent;
exports.readChildrenRecord = readChildrenRecord;
exports.writeChildrenRecord = writeChildrenRecord;
exports.clearChildrenRecord = clearChildrenRecord;
exports.isPidAlive = isPidAlive;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
exports.PROD_DIST_DIR = ".next-prod";
exports.REBUILD_STAMP_RELPATH = path.join(exports.PROD_DIST_DIR, ".hilt-rebuild-stamp");
/** Heartbeat cadence; a supervisor must beat at least this often. */
exports.HEARTBEAT_INTERVAL_MS = 30000;
/** Heartbeat older than this (3 missed beats) ⇒ unsupervised. */
exports.HEARTBEAT_FRESH_MS = 90000;
// ─── Paths ───
function defaultDataDir() {
    return process.env.DATA_DIR || path.join(os.homedir(), ".hilt", "data");
}
function appModeStatePath(dataDir = defaultDataDir()) {
    return path.join(dataDir, "app-mode.json");
}
function appModeIntentPath(dataDir = defaultDataDir()) {
    return path.join(dataDir, "app-mode-intent.json");
}
function supervisorHeartbeatPath(dataDir = defaultDataDir()) {
    return path.join(dataDir, "app-supervisor.json");
}
function supervisorChildrenPath(dataDir = defaultDataDir()) {
    return path.join(dataDir, "app-supervisor-children.json");
}
function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}
function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
    catch {
        return null;
    }
}
// ─── Mode state ───
function readPersistedAppMode(dataDir = defaultDataDir()) {
    const data = readJson(appModeStatePath(dataDir));
    if (data?.mode === "prod" || data?.mode === "dev")
        return data.mode;
    return null;
}
function persistAppMode(mode, dataDir = defaultDataDir()) {
    writeJson(appModeStatePath(dataDir), { mode, updated_at: new Date().toISOString() });
}
/** Resolution order: persisted state file > HILT_APP_MODE env > dev. */
function initialAppMode(dataDir = defaultDataDir(), env = process.env) {
    return readPersistedAppMode(dataDir) ?? (env.HILT_APP_MODE === "prod" ? "prod" : "dev");
}
function prodBuildAvailable(projectDir) {
    return fs.existsSync(path.join(projectDir, exports.PROD_DIST_DIR, "BUILD_ID"));
}
/** Effective server mode: prod requires a completed `npm run rebuild` build. */
function resolveServerMode(projectDir, currentMode) {
    if (currentMode !== "prod")
        return "dev";
    if (prodBuildAvailable(projectDir))
        return "prod";
    console.warn(`App mode is prod but ${exports.PROD_DIST_DIR}/BUILD_ID is missing — run \`npm run rebuild\`. Falling back to the dev server.`);
    return "dev";
}
function nextSpawnSpec(projectDir, port, currentMode) {
    if (resolveServerMode(projectDir, currentMode) === "prod") {
        return {
            args: ["run", "start", "--", "--port", String(port)],
            env: { HILT_DIST_DIR: exports.PROD_DIST_DIR, NODE_ENV: "production" },
            label: "production",
        };
    }
    return { args: ["run", "dev", "--", "--port", String(port)], env: {}, label: "dev" };
}
// ─── Supervisor heartbeat ───
function writeSupervisorHeartbeat(heartbeat, dataDir = defaultDataDir()) {
    writeJson(supervisorHeartbeatPath(dataDir), { ...heartbeat, beat_at: new Date().toISOString() });
}
function readSupervisorHeartbeat(dataDir = defaultDataDir()) {
    const data = readJson(supervisorHeartbeatPath(dataDir));
    if (!data || (data.kind !== "electron" && data.kind !== "daemon"))
        return null;
    return data;
}
function isHeartbeatFresh(heartbeat, now = Date.now()) {
    if (!heartbeat)
        return false;
    const beat = new Date(heartbeat.beat_at).getTime();
    if (!Number.isFinite(beat) || now - beat > exports.HEARTBEAT_FRESH_MS)
        return false;
    // Belt and braces: a fresh-looking file from a dead supervisor must not
    // enable the switch. Signal 0 = existence check only.
    try {
        process.kill(heartbeat.pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function clearSupervisorHeartbeat(dataDir = defaultDataDir()) {
    try {
        fs.unlinkSync(supervisorHeartbeatPath(dataDir));
    }
    catch {
        // Already gone.
    }
}
// ─── Mode-switch intent ───
function writeAppModeIntent(mode, requestedBy, dataDir = defaultDataDir()) {
    writeJson(appModeIntentPath(dataDir), {
        mode,
        ts: Date.now(),
        ...(requestedBy ? { requested_by: requestedBy } : {}),
    });
}
function readAppModeIntent(dataDir = defaultDataDir()) {
    const data = readJson(appModeIntentPath(dataDir));
    if (!data || (data.mode !== "dev" && data.mode !== "prod") || typeof data.ts !== "number")
        return null;
    return data;
}
// ─── Children record (daemon re-adoption) ───
function readChildrenRecord(dataDir = defaultDataDir()) {
    return readJson(supervisorChildrenPath(dataDir)) ?? {};
}
function writeChildrenRecord(children, dataDir = defaultDataDir()) {
    writeJson(supervisorChildrenPath(dataDir), children);
}
function clearChildrenRecord(dataDir = defaultDataDir()) {
    try {
        fs.unlinkSync(supervisorChildrenPath(dataDir));
    }
    catch {
        // Already gone.
    }
}
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
