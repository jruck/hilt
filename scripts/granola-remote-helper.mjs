#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const API_BASE = "https://api.granola.ai";
const USER_AGENT = "HiltGranolaSync/0.1";
const TRANSCRIPT_CONCURRENCY = 4;

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
});

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command !== "fetch") {
    throw new Error("Usage: granola-remote-helper.mjs fetch [--days N] [--limit N] [--transcripts] [--ids id1,id2]");
  }
  const options = parseArgs(argv);
  const tokens = await loadTokens();
  const accessToken = await validAccessToken(tokens);
  const docs = options.ids.length
    ? await fetchDocumentsBatch(accessToken, options.ids)
    : await fetchRecentDocuments(accessToken, options.days, options.limit);
  const liveDocs = docs.filter((rawDoc) => rawDoc && !rawDoc.deleted_at);
  const [folderMap, transcripts] = await Promise.all([
    fetchFolderMap(accessToken).catch(() => new Map()),
    options.transcripts
      ? mapLimit(liveDocs, TRANSCRIPT_CONCURRENCY, (rawDoc) => fetchTranscript(accessToken, rawDoc.id).catch(() => []))
      : Promise.resolve(liveDocs.map(() => [])),
  ]);

  const output = [];
  for (let i = 0; i < liveDocs.length; i++) {
    const rawDoc = liveDocs[i];
    const folders = folderMap.get(rawDoc.id);
    if (folders?.length) rawDoc._hilt_folders = folders;
    output.push({ raw: rawDoc, transcript: transcripts[i] || [] });
  }
  process.stdout.write(JSON.stringify({ ok: true, docs: output }) + "\n");
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function parseArgs(argv) {
  const options = { days: 7, limit: 0, transcripts: false, ids: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--days") options.days = Number(argv[++i] || "7");
    else if (arg === "--limit") options.limit = Number(argv[++i] || "0");
    else if (arg === "--transcripts") options.transcripts = true;
    else if (arg === "--ids") options.ids = String(argv[++i] || "").split(",").map((id) => id.trim()).filter(Boolean);
  }
  return options;
}

async function loadTokens() {
  const dir = path.join(os.homedir(), "Library", "Application Support", "Granola");
  const clearStored = path.join(dir, "stored-accounts.json");
  const encStored = path.join(dir, "stored-accounts.json.enc");
  const clearSupabase = path.join(dir, "supabase.json");

  for (const filePath of [clearStored, clearSupabase]) {
    if (!fs.existsSync(filePath)) continue;
    const tokens = findTokens(JSON.parse(fs.readFileSync(filePath, "utf-8")));
    if (tokens) return tokens;
  }

  if (fs.existsSync(encStored)) {
    const plaintext = decryptStoredAccounts(dir);
    const tokens = findTokens(JSON.parse(plaintext));
    if (tokens) return tokens;
  }

  throw new Error(`Could not find Granola credentials in ${dir}`);
}

function findTokens(value) {
  if (!value) return null;
  if (typeof value === "string") {
    try { return findTokens(JSON.parse(value)); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTokens(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (typeof value.access_token === "string") return value;
  if (value.tokens) {
    const found = findTokens(value.tokens);
    if (found) return found;
  }
  if (value.accounts) {
    const found = findTokens(value.accounts);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = findTokens(child);
    if (found) return found;
  }
  return null;
}

async function validAccessToken(tokens) {
  if (!isExpired(tokens)) return tokens.access_token;
  const refreshed = await apiPost("/v1/refresh-access-token", tokens.access_token, {
    refresh_token: tokens.refresh_token,
    provider: "workos",
  });
  return refreshed.access_token;
}

function isExpired(tokens) {
  if (!tokens?.obtained_at || !tokens?.expires_in) return false;
  return Date.now() >= Number(tokens.obtained_at) + Number(tokens.expires_in) * 1000 - 5 * 60 * 1000;
}

function decryptStoredAccounts(dir) {
  const encPath = path.join(dir, "stored-accounts.json.enc");
  const dekPath = path.join(dir, "storage.dek");
  const password = execFileSync("/usr/bin/security", [
    "find-generic-password",
    "-s",
    "Granola Safe Storage",
    "-a",
    "Granola Key",
    "-w",
  ], { encoding: "utf-8" }).trim();
  const dekBlob = fs.readFileSync(dekPath);
  const dek = decryptKeychainDek(password, dekBlob);
  return decryptPayload(dek, fs.readFileSync(encPath)).toString("utf-8");
}

function decryptKeychainDek(password, dekBlob) {
  const prefix = dekBlob.subarray(0, 3).toString("utf-8");
  if (prefix !== "v10") throw new Error("Granola storage.dek is not v10-wrapped");
  const wrappingKey = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const decipher = crypto.createDecipheriv("aes-128-cbc", wrappingKey, Buffer.alloc(16, 0x20));
  const plaintext = Buffer.concat([decipher.update(dekBlob.subarray(3)), decipher.final()]);
  const dek = Buffer.from(plaintext.toString("utf-8"), "base64");
  if (dek.length !== 32) throw new Error(`Granola DEK had unexpected length ${dek.length}`);
  return dek;
}

function decryptPayload(key, blob) {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(blob.length - 16);
  const ciphertext = blob.subarray(12, blob.length - 16);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function fetchRecentDocuments(accessToken, days, limit) {
  const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
  const docs = [];
  let offset = 0;
  const pageSize = 100;
  while (true) {
    const page = await fetchDocumentsPage(accessToken, pageSize, offset);
    if (!page.length) break;
    docs.push(...page);
    const oldEnough = cutoff && page.some((doc) => Date.parse(doc.created_at || doc.updated_at || "") < cutoff);
    if (limit && docs.length >= limit) break;
    if (oldEnough || page.length < pageSize) break;
    offset += pageSize;
  }
  const filtered = cutoff ? docs.filter((doc) => Date.parse(doc.created_at || doc.updated_at || "") >= cutoff) : docs;
  return limit ? filtered.slice(0, limit) : filtered;
}

async function fetchDocumentsPage(accessToken, limit, offset) {
  const json = await apiPost("/v2/get-documents", accessToken, {
    limit,
    offset,
    include_last_viewed_panel: true,
  });
  return Array.isArray(json.docs) ? json.docs : Array.isArray(json.documents) ? json.documents : [];
}

async function fetchDocumentsBatch(accessToken, ids) {
  const json = await apiPost("/v1/get-documents-batch", accessToken, { document_ids: ids });
  return Array.isArray(json.docs) ? json.docs : Array.isArray(json.documents) ? json.documents : [];
}

async function fetchTranscript(accessToken, documentId) {
  const json = await apiPost("/v1/get-document-transcript", accessToken, { document_id: documentId });
  return Array.isArray(json) ? json : Array.isArray(json.transcript) ? json.transcript : [];
}

async function fetchFolderMap(accessToken) {
  const metadata = await apiPost("/v1/get-document-lists-metadata", accessToken, {});
  const lists = metadata.lists && typeof metadata.lists === "object" ? metadata.lists : {};
  const map = new Map();
  for (const [listId, meta] of Object.entries(lists)) {
    const list = await apiPost("/v1/get-document-list", accessToken, { list_id: listId }).catch(() => null);
    const docs = Array.isArray(list?.documents) ? list.documents : [];
    const label = meta?.title || meta?.name || list?.title || listId;
    for (const entry of docs) {
      const docId = typeof entry === "string" ? entry : entry?.id || entry?.document_id;
      if (!docId) continue;
      const folders = map.get(docId) || [];
      folders.push(label);
      map.set(docId, folders);
    }
  }
  return map;
}

async function apiPost(endpoint, accessToken, body) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "*/*",
      "User-Agent": USER_AGENT,
      "X-Client-Version": USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${endpoint} failed with ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}
