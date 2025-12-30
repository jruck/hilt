#!/usr/bin/env node
/**
 * Patches the Electron.app bundle in node_modules to show
 * "Claude Kanban" name and icon during development.
 */

import { execSync } from 'child_process';
import { copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const electronApp = join(rootDir, 'node_modules/electron/dist/Electron.app');
const plist = join(electronApp, 'Contents/Info.plist');
const iconSrc = join(rootDir, 'build/icon.icns');
const iconDest = join(electronApp, 'Contents/Resources/electron.icns');

if (!existsSync(electronApp)) {
  console.log('Electron.app not found, skipping patch');
  process.exit(0);
}

console.log('Patching Electron.app for Claude Kanban...');

try {
  // Patch bundle name
  execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleName 'Claude Kanban'" "${plist}"`, { stdio: 'inherit' });

  // Patch display name
  try {
    execSync(`/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName 'Claude Kanban'" "${plist}"`, { stdio: 'pipe' });
  } catch {
    execSync(`/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string 'Claude Kanban'" "${plist}"`, { stdio: 'inherit' });
  }

  // Copy icon
  if (existsSync(iconSrc)) {
    copyFileSync(iconSrc, iconDest);
    console.log('Copied Claude Kanban icon');
  }

  console.log('Electron.app patched successfully!');
} catch (err) {
  console.error('Failed to patch Electron.app:', err.message);
  process.exit(1);
}
