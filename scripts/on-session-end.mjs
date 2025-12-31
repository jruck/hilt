#!/usr/bin/env node

/**
 * Hook script called by Claude Code on SessionEnd.
 * Updates the Kanban session status from "active" to "inactive".
 *
 * Environment variables provided by Claude Code:
 * - SESSION_ID: The session UUID
 * - CWD: Working directory of the session
 * - DURATION_MS: Session duration in milliseconds
 * - NUM_TURNS: Number of conversation turns
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', 'data');
const STATUS_FILE = join(DATA_DIR, 'session-status.json');

const sessionId = process.env.SESSION_ID;

if (!sessionId) {
  console.error('[on-session-end] No SESSION_ID provided');
  process.exit(0); // Don't fail the hook
}

try {
  // Read existing status data
  let statusData = {};
  if (existsSync(STATUS_FILE)) {
    const content = readFileSync(STATUS_FILE, 'utf-8');
    statusData = JSON.parse(content);
  }

  // Only update if session was active
  if (statusData[sessionId]?.status === 'active') {
    statusData[sessionId] = {
      ...statusData[sessionId],
      status: 'inactive',
      updatedAt: new Date().toISOString(),
    };

    writeFileSync(STATUS_FILE, JSON.stringify(statusData, null, 2));
    console.log(`[on-session-end] Session ${sessionId.slice(0, 8)}... moved to inactive`);
  }
} catch (error) {
  console.error('[on-session-end] Error:', error.message);
  // Don't fail the hook
}
