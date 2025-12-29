import * as fs from "fs";
import * as path from "path";
import { SessionStatus } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
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
    return JSON.parse(content);
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
): Promise<{ status: SessionStatus; sortOrder: number } | null> {
  const data = readStatusFile();
  const record = data[sessionId];
  if (!record) return null;
  return { status: record.status, sortOrder: record.sortOrder };
}

export async function setSessionStatus(
  sessionId: string,
  status: SessionStatus,
  sortOrder?: number
): Promise<void> {
  const data = readStatusFile();
  const existing = data[sessionId];

  data[sessionId] = {
    status,
    sortOrder: sortOrder ?? existing?.sortOrder ?? 0,
    updatedAt: new Date().toISOString(),
  };

  writeStatusFile(data);
}

export async function getAllSessionStatuses(): Promise<
  Map<string, { status: SessionStatus; sortOrder: number }>
> {
  const data = readStatusFile();
  const map = new Map<string, { status: SessionStatus; sortOrder: number }>();

  for (const [sessionId, record] of Object.entries(data)) {
    map.set(sessionId, { status: record.status, sortOrder: record.sortOrder });
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
