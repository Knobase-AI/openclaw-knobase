#!/usr/bin/env node

/**
 * Knobase Sync - Two-way sync with cloud workspace
 *
 * Usage: openclaw-knobase sync [--agent <id>] [--direction <up|down|both>]
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import fetch from 'node-fetch';
import chalk from 'chalk';
import ora from 'ora';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const WORKSPACE_DIR = path.join(os.homedir(), '.openclaw', 'workspace');

const SYNCABLE_EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.toml']);

// --- Argument parsing ---

const args = process.argv.slice(2);
let direction = 'both';
let agentId = null;
let dryRun = false;
let forceDirection = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--direction' && args[i + 1]) {
    direction = args[i + 1];
    i++;
  } else if (args[i] === '--agent' && args[i + 1]) {
    agentId = args[i + 1];
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--force' && args[i + 1]) {
    forceDirection = args[i + 1]; // 'local' or 'remote'
    i++;
  }
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(chalk.blue.bold('\n🔄 Knobase Sync\n'));
  console.log('Sync your local OpenClaw workspace with Knobase cloud\n');
  console.log(chalk.white('Usage:'));
  console.log(chalk.gray('  openclaw-knobase sync [options]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --agent <id>         Specific agent to sync'));
  console.log(chalk.gray('  --direction <dir>    Sync direction: up, down, or both (default: both)'));
  console.log(chalk.gray('  --dry-run            Preview changes without applying them'));
  console.log(chalk.gray('  --force <side>       Auto-resolve conflicts: local or remote\n'));
  console.log(chalk.white('Examples:'));
  console.log(chalk.gray('  openclaw-knobase sync'));
  console.log(chalk.gray('  openclaw-knobase sync --direction up'));
  console.log(chalk.gray('  openclaw-knobase sync --agent abc-123 --direction both'));
  console.log(chalk.gray('  openclaw-knobase sync --dry-run'));
  console.log(chalk.gray('  openclaw-knobase sync --force remote\n'));
  process.exit(0);
}

// --- Config ---

async function loadConfig() {
  try {
    const content = await fs.readFile(ENV_FILE, 'utf8');
    const config = {};
    for (const line of content.split('\n')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    }
    return config;
  } catch {
    return {};
  }
}

// --- Local file reading ---

async function readLocalFiles(workspaceDir) {
  const files = {};

  async function walk(dir, prefix = '') {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile() && SYNCABLE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        try {
          const content = await fs.readFile(fullPath, 'utf8');
          const stat = await fs.stat(fullPath);
          files[relativePath] = {
            content,
            modified_at: stat.mtime.toISOString(),
            size: stat.size,
          };
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(workspaceDir);
  return files;
}

// --- API call ---

async function callSyncApi(baseUrl, syncAgentId, apiKey, localFiles, syncDirection) {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(syncAgentId)}/sync`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      direction: syncDirection,
      files: localFiles,
    }),
  });

  if (response.status === 401) {
    throw new Error('Not authenticated — API key is invalid or expired. Run: openclaw knobase auth');
  }
  if (response.status === 403) {
    throw new Error('Forbidden — insufficient permissions for this agent.');
  }
  if (response.status === 404) {
    throw new Error(`Agent "${syncAgentId}" not found. Check your AGENT_ID in .env`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Sync API returned ${response.status}: ${body || response.statusText}`);
  }

  const data = await response.json();
  return data;
}

// --- Conflict resolution ---

function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

async function resolveConflicts(conflicts) {
  if (!conflicts || conflicts.length === 0) return [];

  if (forceDirection) {
    const side = forceDirection === 'local' ? 'local' : 'remote';
    console.log(chalk.yellow(`  Auto-resolving ${conflicts.length} conflict(s) with --force ${forceDirection}\n`));
    return conflicts.map((c) => ({ ...c, resolution: side }));
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const resolved = [];

  for (const conflict of conflicts) {
    console.log(chalk.yellow.bold(`\n  ⚠ Conflict: ${conflict.path}`));
    if (conflict.local_modified) {
      console.log(chalk.gray(`    Local modified:  ${new Date(conflict.local_modified).toLocaleString()}`));
    }
    if (conflict.remote_modified) {
      console.log(chalk.gray(`    Remote modified: ${new Date(conflict.remote_modified).toLocaleString()}`));
    }
    console.log('');
    console.log(chalk.white('    [l] Keep local version'));
    console.log(chalk.white('    [r] Keep remote version'));
    console.log(chalk.white('    [s] Skip this file'));
    console.log('');

    let answer = '';
    while (!['l', 'r', 's'].includes(answer.toLowerCase())) {
      answer = await askQuestion(rl, chalk.cyan('    Choose (l/r/s): '));
      answer = answer.trim().toLowerCase();
    }

    if (answer === 'l') {
      resolved.push({ ...conflict, resolution: 'local' });
      console.log(chalk.green('    → Keeping local version'));
    } else if (answer === 'r') {
      resolved.push({ ...conflict, resolution: 'remote' });
      console.log(chalk.blue('    → Keeping remote version'));
    } else {
      console.log(chalk.gray('    → Skipped'));
    }
  }

  rl.close();
  return resolved;
}

// --- File writing ---

async function saveDownloadedFiles(workspaceDir, downloads) {
  let saved = 0;
  for (const file of downloads) {
    const filePath = path.join(workspaceDir, file.path);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, file.content, 'utf8');
    saved++;
  }
  return saved;
}

// --- Display helpers ---

function printFileList(label, files, color) {
  if (!files || files.length === 0) return;
  console.log(chalk[color].bold(`\n  ${label}:`));
  for (const file of files) {
    const size = file.size != null ? chalk.gray(` (${formatSize(file.size)})`) : '';
    console.log(chalk[color](`    ${color === 'green' ? '↑' : color === 'blue' ? '↓' : '⚠'} ${file.path}`) + size);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function printSummary(stats) {
  console.log(chalk.white.bold('\n  Summary'));
  console.log(chalk.gray('  ' + '─'.repeat(36)));
  console.log(chalk.green(`  ↑ Uploaded:    ${stats.uploaded} file(s)`));
  console.log(chalk.blue(`  ↓ Downloaded:  ${stats.downloaded} file(s)`));
  if (stats.conflicts > 0) {
    console.log(chalk.yellow(`  ⚠ Conflicts:   ${stats.conflicts} file(s)`));
  }
  if (stats.skipped > 0) {
    console.log(chalk.gray(`  ○ Skipped:     ${stats.skipped} file(s)`));
  }
  if (stats.unchanged > 0) {
    console.log(chalk.gray(`  ─ Unchanged:   ${stats.unchanged} file(s)`));
  }
  console.log('');
}

// --- Main sync ---

async function sync() {
  console.log(chalk.blue.bold('\n🔄 Knobase Sync\n'));

  // Load config
  const configSpinner = ora('Loading configuration...').start();
  const config = await loadConfig();

  const apiKey = config.KNOBASE_API_KEY;
  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const syncAgentId = agentId || config.AGENT_ID;
  const workspaceDir = config.OPENCLAW_AGENT_WORKSPACE || WORKSPACE_DIR;

  if (!apiKey) {
    configSpinner.fail('Not authenticated');
    console.error(chalk.red('\n  KNOBASE_API_KEY not found in .env'));
    console.log(chalk.gray('  Run: openclaw-knobase connect\n'));
    process.exit(1);
  }

  if (!syncAgentId) {
    configSpinner.fail('No agent ID');
    console.error(chalk.red('\n  AGENT_ID not found in .env and no --agent flag provided'));
    console.log(chalk.gray('  Run: openclaw-knobase connect\n'));
    process.exit(1);
  }

  configSpinner.succeed('Configuration loaded');
  console.log(chalk.gray(`  Agent:     ${syncAgentId}`));
  console.log(chalk.gray(`  Workspace: ${workspaceDir}`));
  console.log(chalk.gray(`  Direction: ${direction}`));
  if (dryRun) {
    console.log(chalk.yellow('  Mode:      DRY RUN (no changes will be applied)'));
  }
  console.log('');

  // Read local files
  const readSpinner = ora('Reading local files...').start();
  let localFiles = {};

  if (direction !== 'down') {
    try {
      localFiles = await readLocalFiles(workspaceDir);
      const fileCount = Object.keys(localFiles).length;
      readSpinner.succeed(`Found ${fileCount} local file(s)`);
    } catch (err) {
      readSpinner.warn('Could not read local workspace');
      console.log(chalk.gray(`  ${err.message}\n`));
    }
  } else {
    readSpinner.succeed('Skipping local read (download only)');
  }

  // Call sync API
  const syncSpinner = ora('Syncing with Knobase...').start();
  let syncResult;

  try {
    syncResult = await callSyncApi(baseUrl, syncAgentId, apiKey, localFiles, direction);
    syncSpinner.succeed('Sync response received');
  } catch (err) {
    syncSpinner.fail('Sync failed');
    console.error(chalk.red(`\n  ${err.message}\n`));
    process.exit(1);
  }

  const uploaded = syncResult.uploaded || [];
  const downloads = syncResult.downloads || [];
  const conflicts = syncResult.conflicts || [];
  const unchanged = syncResult.unchanged || [];

  // Display uploaded files
  printFileList('Uploaded to Knobase', uploaded, 'green');

  // Display downloaded files
  printFileList('Available from Knobase', downloads, 'blue');

  // Handle conflicts
  let resolvedConflicts = [];
  let skippedCount = 0;

  if (conflicts.length > 0) {
    printFileList('Conflicts detected', conflicts, 'yellow');

    if (!dryRun) {
      resolvedConflicts = await resolveConflicts(conflicts);
      skippedCount = conflicts.length - resolvedConflicts.length;

      const remoteWins = resolvedConflicts.filter((c) => c.resolution === 'remote');
      if (remoteWins.length > 0) {
        downloads.push(...remoteWins.map((c) => ({
          path: c.path,
          content: c.remote_content,
          size: c.remote_content?.length,
        })));
      }

      const localWins = resolvedConflicts.filter((c) => c.resolution === 'local');
      if (localWins.length > 0) {
        uploaded.push(...localWins.map((c) => ({
          path: c.path,
          size: c.local_content?.length,
        })));
      }
    }
  }

  // Save downloads to local workspace
  let savedCount = 0;
  if (downloads.length > 0 && !dryRun) {
    const downloadFiles = downloads.filter((d) => d.content != null);
    if (downloadFiles.length > 0) {
      const saveSpinner = ora('Saving downloaded files...').start();
      try {
        savedCount = await saveDownloadedFiles(workspaceDir, downloadFiles);
        saveSpinner.succeed(`Saved ${savedCount} file(s) to ${workspaceDir}`);
      } catch (err) {
        saveSpinner.fail('Failed to save some files');
        console.error(chalk.red(`  ${err.message}`));
      }
    }
  }

  if (dryRun) {
    console.log(chalk.yellow.bold('\n  Dry run complete — no changes were applied.'));
  }

  // Summary
  printSummary({
    uploaded: uploaded.length,
    downloaded: dryRun ? downloads.length : savedCount,
    conflicts: conflicts.length,
    skipped: skippedCount,
    unchanged: unchanged.length,
  });

  console.log(chalk.gray(`  Last synced: ${new Date().toLocaleString()}\n`));
}

sync().catch((err) => {
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.type === 'system') {
    console.error(chalk.red('\n  Network error — could not reach Knobase API.'));
    console.error(chalk.gray(`  ${err.message}`));
    console.log(chalk.gray('  Check your internet connection and try again.\n'));
  } else {
    console.error(chalk.red(`\n  ${err.message}\n`));
  }
  process.exit(1);
});
