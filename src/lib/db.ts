import * as fs from "fs";
import * as path from "path";
import { SessionStatus } from "./types";

// Use DATA_DIR env var if set, otherwise use local ./data
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const STATUS_FILE = path.join(DATA_DIR, "session-status.json");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");

// Ensure data directory exists
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Status storage
interface StatusRecord {
  status: SessionStatus;
  sortOrder: number;
  starred?: boolean;
  updatedAt: string;
}

interface StatusData {
  [sessionId: string]: StatusRecord;
}

function readStatusFile(): StatusData {
  ensureDataDir();
  if (!fs.existsSync(STATUS_FILE)) {
    return {};
  }
  try {
    const content = fs.readFileSync(STATUS_FILE, "utf-8");
    const data = JSON.parse(content) as StatusData;

    // Migrate old statuses to new "recent" status
    let needsWrite = false;
    for (const [sessionId, record] of Object.entries(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = record.status as any;
      if (status === "inactive") {
        // Saved sessions become starred in recent
        record.status = "recent";
        record.starred = true;
        needsWrite = true;
      } else if (status === "done") {
        // Done sessions become unstarred in recent
        record.status = "recent";
        record.starred = false;
        needsWrite = true;
      }
    }

    // Write back migrated data
    if (needsWrite) {
      writeStatusFile(data);
    }

    return data;
  } catch {
    return {};
  }
}

function writeStatusFile(data: StatusData) {
  ensureDataDir();
  fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
}

export async function getSessionStatus(
  sessionId: string
): Promise<{ status: SessionStatus; sortOrder: number; starred?: boolean } | null> {
  const data = readStatusFile();
  const record = data[sessionId];
  if (!record) return null;
  return { status: record.status, sortOrder: record.sortOrder, starred: record.starred };
}

export async function setSessionStatus(
  sessionId: string,
  status?: SessionStatus,
  sortOrder?: number,
  starred?: boolean
): Promise<void> {
  const data = readStatusFile();
  const existing = data[sessionId];

  data[sessionId] = {
    status: status ?? existing?.status ?? "recent",
    sortOrder: sortOrder ?? existing?.sortOrder ?? 0,
    starred: starred !== undefined ? starred : existing?.starred,
    updatedAt: new Date().toISOString(),
  };

  writeStatusFile(data);
}

export async function getAllSessionStatuses(): Promise<
  Map<string, { status: SessionStatus; sortOrder: number; starred?: boolean }>
> {
  const data = readStatusFile();
  const map = new Map<string, { status: SessionStatus; sortOrder: number; starred?: boolean }>();

  for (const [sessionId, record] of Object.entries(data)) {
    map.set(sessionId, { status: record.status, sortOrder: record.sortOrder, starred: record.starred });
  }

  return map;
}

// Inbox storage
interface InboxItem {
  id: string;
  prompt: string;
  projectPath: string | null;
  createdAt: string;
  sortOrder: number;
}

function readInboxFile(): InboxItem[] {
  ensureDataDir();
  if (!fs.existsSync(INBOX_FILE)) {
    return [];
  }
  try {
    const content = fs.readFileSync(INBOX_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

function writeInboxFile(items: InboxItem[]) {
  ensureDataDir();
  fs.writeFileSync(INBOX_FILE, JSON.stringify(items, null, 2));
}

export async function createInboxItem(
  id: string,
  prompt: string,
  projectPath?: string,
  sortOrder?: number
): Promise<void> {
  const items = readInboxFile();
  // Add new items at the beginning so they appear at the top
  items.unshift({
    id,
    prompt,
    projectPath: projectPath ?? null,
    createdAt: new Date().toISOString(),
    sortOrder: sortOrder ?? 0,
  });
  writeInboxFile(items);
}

export async function getInboxItems(): Promise<
  Array<{
    id: string;
    prompt: string;
    projectPath: string | null;
    createdAt: string;
    sortOrder: number;
  }>
> {
  return readInboxFile();
}

export async function updateInboxItem(
  id: string,
  prompt?: string,
  sortOrder?: number
): Promise<void> {
  const items = readInboxFile();
  const index = items.findIndex((item) => item.id === id);

  if (index === -1) return;

  if (prompt !== undefined) {
    items[index].prompt = prompt;
  }
  if (sortOrder !== undefined) {
    items[index].sortOrder = sortOrder;
  }

  writeInboxFile(items);
}

export async function deleteInboxItem(id: string): Promise<void> {
  const items = readInboxFile();
  const filtered = items.filter((item) => item.id !== id);
  writeInboxFile(filtered);
}
