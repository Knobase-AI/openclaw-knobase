#!/usr/bin/env node

/**
 * Knobase Import - Import files or folders into agent knowledge base
 *
 * Usage: openclaw-knobase import <file|folder> [--overwrite] [--yes]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import fetch from 'node-fetch';
import { FormData, File } from 'node-fetch';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const KNOWN_WORKSPACE_FILES = ['SOUL.md', 'IDENTITY.md', 'PERSONA.md', 'INSTRUCTIONS.md', 'KNOWLEDGE.md'];

// --- Argument parsing ---

const args = process.argv.slice(2);
let targetPath = null;
let overwrite = false;
let skipConfirm = false;

if (args.includes('--help') || args.includes('-h')) {
  console.log(chalk.blue.bold('\nKnobase Import\n'));
  console.log('Import files or folders into your agent knowledge base\n');
  console.log(chalk.white('Usage:'));
  console.log(chalk.gray('  openclaw-knobase import <file|folder> [options]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --overwrite   Overwrite existing files with the same name'));
  console.log(chalk.gray('  --yes, -y     Skip confirmation prompt'));
  console.log(chalk.gray('  --help, -h    Show this help message\n'));
  console.log(chalk.white('Supported inputs:'));
  console.log(chalk.gray('  .zip          Archive containing multiple files'));
  console.log(chalk.gray('  <file>        Any individual file'));
  console.log(chalk.gray('  <folder>      Directory with .openclaw structure or workspace files\n'));
  console.log(chalk.white('Folder auto-detection:'));
  console.log(chalk.gray('  Automatically detects .openclaw folder structures:'));
  console.log(chalk.gray('    ~/.openclaw/workspace/          Direct workspace'));
  console.log(chalk.gray('    ~/folder/.openclaw/workspace/   Full .openclaw project'));
  console.log(chalk.gray('    ~/folder/SOUL.md                Loose workspace files\n'));
  console.log(chalk.white('Examples:'));
  console.log(chalk.gray('  openclaw-knobase import ./knowledge.zip'));
  console.log(chalk.gray('  openclaw-knobase import ./notes.md --overwrite'));
  console.log(chalk.gray('  openclaw-knobase import ~/.openclaw/'));
  console.log(chalk.gray('  openclaw-knobase import ~/my-agent/ --yes\n'));
  process.exit(0);
}

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--overwrite') {
    overwrite = true;
  } else if (args[i] === '--yes' || args[i] === '-y') {
    skipConfirm = true;
  } else if (!args[i].startsWith('-')) {
    targetPath = args[i];
  }
}

if (!targetPath) {
  console.error(chalk.red('\n  Missing required argument: <file|folder>'));
  console.log(chalk.gray('  Usage: openclaw-knobase import <file|folder> [--overwrite]\n'));
  process.exit(1);
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

// --- Helpers ---

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function padEnd(str, len) {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function printTable(rows, columns) {
  const widths = columns.map((col) =>
    Math.max(col.label.length, ...rows.map((r) => String(r[col.key] ?? '').length))
  );

  const header = columns.map((col, i) => padEnd(col.label, widths[i])).join('  ');
  const separator = columns.map((_, i) => '─'.repeat(widths[i])).join('──');

  console.log(chalk.white(`  ${header}`));
  console.log(chalk.gray(`  ${separator}`));

  for (const row of rows) {
    const line = columns
      .map((col, i) => {
        const val = String(row[col.key] ?? '');
        const padded = padEnd(val, widths[i]);
        if (col.color) return col.color(padded);
        return padded;
      })
      .join('  ');
    console.log(`  ${line}`);
  }
}

async function confirm(message) {
  if (skipConfirm) return true;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`  ${message} ${chalk.gray('(y/N)')} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes');
    });
  });
}

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function collectFiles(dir, baseDir = dir) {
  const results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, baseDir);
      results.push(...nested);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
      results.push({
        absolutePath: fullPath,
        relativePath: path.relative(baseDir, fullPath),
        name: entry.name,
        size: stat.size,
      });
    }
  }

  return results;
}

// --- Folder structure detection ---

async function detectStructure(folderPath) {
  const hasOpenclawJson = await pathExists(path.join(folderPath, '.openclaw.json'));
  if (hasOpenclawJson) {
    const workspaceDir = path.join(folderPath, 'workspace');
    if (await isDirectory(workspaceDir)) {
      return {
        type: 'openclaw-root',
        label: '.openclaw project root (with .openclaw.json)',
        workspacePath: workspaceDir,
        rootPath: folderPath,
      };
    }
    return {
      type: 'openclaw-root-flat',
      label: '.openclaw project root (flat, with .openclaw.json)',
      workspacePath: folderPath,
      rootPath: folderPath,
    };
  }

  const hasWorkspaceDir = await isDirectory(path.join(folderPath, 'workspace'));
  if (hasWorkspaceDir) {
    return {
      type: 'has-workspace-dir',
      label: 'Contains workspace/ subdirectory',
      workspacePath: path.join(folderPath, 'workspace'),
      rootPath: folderPath,
    };
  }

  const foundKnown = [];
  for (const knownFile of KNOWN_WORKSPACE_FILES) {
    if (await pathExists(path.join(folderPath, knownFile))) {
      foundKnown.push(knownFile);
    }
  }
  if (foundKnown.length > 0) {
    return {
      type: 'workspace-direct',
      label: `Workspace files detected (${foundKnown.join(', ')})`,
      workspacePath: folderPath,
      rootPath: folderPath,
      knownFiles: foundKnown,
    };
  }

  const hasOpenclawSubdir = await isDirectory(path.join(folderPath, '.openclaw'));
  if (hasOpenclawSubdir) {
    const nestedWorkspace = path.join(folderPath, '.openclaw', 'workspace');
    if (await isDirectory(nestedWorkspace)) {
      return {
        type: 'nested-openclaw',
        label: 'Contains .openclaw/workspace/ subdirectory',
        workspacePath: nestedWorkspace,
        rootPath: folderPath,
      };
    }
    return {
      type: 'nested-openclaw-flat',
      label: 'Contains .openclaw/ subdirectory (flat)',
      workspacePath: path.join(folderPath, '.openclaw'),
      rootPath: folderPath,
    };
  }

  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const subdir = path.join(folderPath, entry.name);
      const subEntries = await fs.readdir(subdir);
      const hasMd = subEntries.some((f) => f.endsWith('.md'));
      if (hasMd) {
        return {
          type: 'subdir-with-md',
          label: `Subdirectory "${entry.name}/" contains .md files`,
          workspacePath: subdir,
          rootPath: folderPath,
        };
      }
    }
  }

  const topLevelMd = entries.filter((e) => e.isFile() && e.name.endsWith('.md'));
  if (topLevelMd.length > 0) {
    return {
      type: 'flat-md',
      label: `Found ${topLevelMd.length} .md file(s) in directory`,
      workspacePath: folderPath,
      rootPath: folderPath,
    };
  }

  const anyFiles = entries.filter((e) => e.isFile() && !e.name.startsWith('.'));
  if (anyFiles.length > 0) {
    return {
      type: 'flat-files',
      label: `Found ${anyFiles.length} file(s) in directory`,
      workspacePath: folderPath,
      rootPath: folderPath,
    };
  }

  return null;
}

function printDetectedStructure(structure, files) {
  console.log(chalk.white('  Detected structure:\n'));

  const typeLabels = {
    'openclaw-root': '📦 .openclaw project',
    'openclaw-root-flat': '📦 .openclaw project (flat)',
    'has-workspace-dir': '📂 Workspace directory',
    'workspace-direct': '📄 Workspace files',
    'nested-openclaw': '📦 Nested .openclaw project',
    'nested-openclaw-flat': '📦 Nested .openclaw (flat)',
    'subdir-with-md': '📂 Subdirectory with markdown',
    'flat-md': '📄 Markdown files',
    'flat-files': '📄 Files',
  };

  console.log(chalk.cyan(`  Type:      ${typeLabels[structure.type] || structure.type}`));
  console.log(chalk.gray(`  Detail:    ${structure.label}`));
  console.log(chalk.gray(`  Root:      ${structure.rootPath}`));
  console.log(chalk.gray(`  Workspace: ${structure.workspacePath}`));
  console.log('');

  if (files.length === 0) {
    console.log(chalk.yellow('  No files found in workspace path.\n'));
    return;
  }

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  console.log(chalk.white(`  Files to import (${files.length}, ${formatSize(totalSize)}):\n`));

  const displayFiles = files.slice(0, 20);
  printTable(
    displayFiles.map((f) => ({
      name: f.relativePath,
      size: formatSize(f.size),
    })),
    [
      { key: 'name', label: 'File', color: chalk.cyan },
      { key: 'size', label: 'Size' },
    ]
  );

  if (files.length > 20) {
    console.log(chalk.gray(`  ... and ${files.length - 20} more files`));
  }
  console.log('');
}

// --- Upload helpers ---

async function uploadSingleFile(resolvedPath, { apiKey, baseUrl, agentId }) {
  const stat = await fs.stat(resolvedPath);
  const filename = path.basename(resolvedPath);

  console.log(chalk.gray(`  File:      ${filename}`));
  console.log(chalk.gray(`  Size:      ${formatSize(stat.size)}`));
  console.log(chalk.gray(`  Overwrite: ${overwrite ? 'yes' : 'no'}`));
  console.log('');
  console.log(chalk.gray('  Importing...'));

  const fileBuffer = await fs.readFile(resolvedPath);
  const file = new File([fileBuffer], filename);

  const form = new FormData();
  form.append('file', file, filename);
  if (overwrite) {
    form.append('overwrite', 'true');
  }

  return callImportApi(form, { apiKey, baseUrl, agentId });
}

async function uploadMultipleFiles(files, { apiKey, baseUrl, agentId }) {
  console.log(chalk.gray('  Importing...'));

  const form = new FormData();
  for (const f of files) {
    const fileBuffer = await fs.readFile(f.absolutePath);
    const file = new File([fileBuffer], f.relativePath);
    form.append('files', file, f.relativePath);
  }
  if (overwrite) {
    form.append('overwrite', 'true');
  }

  return callImportApi(form, { apiKey, baseUrl, agentId });
}

async function callImportApi(form, { apiKey, baseUrl, agentId }) {
  const url = `${baseUrl}/api/agents/${encodeURIComponent(agentId)}/import`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: form,
    });
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.type === 'system') {
      console.error(chalk.red('\n  Network error — could not reach Knobase API.'));
      console.error(chalk.gray(`  ${err.message}`));
      console.log(chalk.gray('  Check your internet connection and try again.\n'));
    } else {
      console.error(chalk.red(`\n  ${err.message}\n`));
    }
    process.exit(1);
  }

  if (response.status === 401) {
    console.error(chalk.red('\n  Not authenticated — API key is invalid or expired.'));
    console.log(chalk.gray('  Run: openclaw-knobase auth\n'));
    process.exit(1);
  }
  if (response.status === 403) {
    console.error(chalk.red('\n  Forbidden — insufficient permissions for this agent.\n'));
    process.exit(1);
  }
  if (response.status === 404) {
    console.error(chalk.red(`\n  Agent "${agentId}" not found. Check your AGENT_ID in .env\n`));
    process.exit(1);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`\n  Import API returned ${response.status}: ${body || response.statusText}\n`));
    process.exit(1);
  }

  return response.json();
}

function printResults(result) {
  const imported = result.imported || [];
  const skipped = result.skipped || [];
  const errors = result.errors || [];

  console.log('');

  if (imported.length > 0) {
    console.log(chalk.green.bold(`  Imported (${imported.length}):\n`));
    printTable(
      imported.map((f) => ({
        name: typeof f === 'string' ? f : f.name || f.filename || f,
        size: typeof f === 'object' && f.size ? formatSize(f.size) : '—',
      })),
      [
        { key: 'name', label: 'File', color: chalk.green },
        { key: 'size', label: 'Size' },
      ]
    );
    console.log('');
  }

  if (skipped.length > 0) {
    console.log(chalk.yellow.bold(`  Skipped (${skipped.length}):\n`));
    printTable(
      skipped.map((f) => ({
        name: typeof f === 'string' ? f : f.name || f.filename || f,
        reason: typeof f === 'object' && f.reason ? f.reason : 'already exists',
      })),
      [
        { key: 'name', label: 'File', color: chalk.yellow },
        { key: 'reason', label: 'Reason' },
      ]
    );
    console.log('');
  }

  if (errors.length > 0) {
    console.log(chalk.red.bold(`  Errors (${errors.length}):\n`));
    printTable(
      errors.map((e) => ({
        name: typeof e === 'string' ? e : e.name || e.filename || e.file || '—',
        error: typeof e === 'string' ? e : e.error || e.message || 'unknown error',
      })),
      [
        { key: 'name', label: 'File', color: chalk.red },
        { key: 'error', label: 'Error' },
      ]
    );
    console.log('');
  }

  if (imported.length === 0 && skipped.length === 0 && errors.length === 0) {
    console.log(chalk.gray('  No files were processed.\n'));
  } else {
    const summary = [];
    if (imported.length) summary.push(chalk.green(`${imported.length} imported`));
    if (skipped.length) summary.push(chalk.yellow(`${skipped.length} skipped`));
    if (errors.length) summary.push(chalk.red(`${errors.length} errors`));
    console.log(chalk.white(`  Summary: ${summary.join(', ')}\n`));
  }
}

// --- Main ---

async function runImport() {
  console.log(chalk.blue.bold('\nKnobase Import\n'));

  const config = await loadConfig();

  const apiKey = config.KNOBASE_API_KEY;
  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const agentId = config.AGENT_ID;

  if (!apiKey) {
    console.error(chalk.red('  KNOBASE_API_KEY not found in .env'));
    console.log(chalk.gray('  Run: openclaw-knobase connect\n'));
    process.exit(1);
  }

  if (!agentId) {
    console.error(chalk.red('  AGENT_ID not found in .env'));
    console.log(chalk.gray('  Run: openclaw-knobase connect\n'));
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), targetPath);

  let stat;
  try {
    stat = await fs.stat(resolvedPath);
  } catch {
    console.error(chalk.red(`  Path not found: ${resolvedPath}\n`));
    process.exit(1);
  }

  console.log(chalk.gray(`  Agent: ${agentId}`));

  if (stat.isFile()) {
    const result = await uploadSingleFile(resolvedPath, { apiKey, baseUrl, agentId });
    printResults(result);
    return;
  }

  if (!stat.isDirectory()) {
    console.error(chalk.red(`  Not a file or directory: ${resolvedPath}\n`));
    process.exit(1);
  }

  // --- Folder import with auto-detection ---

  console.log(chalk.gray(`  Path:  ${resolvedPath}`));
  console.log('');
  console.log(chalk.gray('  Scanning folder structure...'));
  console.log('');

  const structure = await detectStructure(resolvedPath);

  if (!structure) {
    console.error(chalk.red('  Could not detect any importable files in this folder.'));
    console.log(chalk.gray('  Expected: .openclaw.json, workspace/ folder, or .md files\n'));
    process.exit(1);
  }

  const files = await collectFiles(structure.workspacePath);

  if (files.length === 0) {
    console.error(chalk.red('  No files found in detected workspace path.'));
    console.log(chalk.gray(`  Checked: ${structure.workspacePath}\n`));
    process.exit(1);
  }

  printDetectedStructure(structure, files);

  console.log(chalk.gray(`  Overwrite: ${overwrite ? 'yes' : 'no'}`));
  console.log('');

  const proceed = await confirm('Proceed with import?');
  if (!proceed) {
    console.log(chalk.yellow('\n  Import cancelled.\n'));
    process.exit(0);
  }

  console.log('');
  const result = await uploadMultipleFiles(files, { apiKey, baseUrl, agentId });
  printResults(result);
}

runImport().catch((err) => {
  console.error(chalk.red(`\n  ${err.message}\n`));
  process.exit(1);
});
