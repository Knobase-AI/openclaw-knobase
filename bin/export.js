#!/usr/bin/env node

/**
 * Knobase Export - Export agent knowledge base
 *
 * Usage: openclaw-knobase export [--format openclaw|claude|markdown] [--output <path>]
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const VALID_FORMATS = ['openclaw', 'claude', 'markdown'];

const FORMAT_EXTENSIONS = {
  openclaw: '.json',
  claude: '.md',
  markdown: '.md',
};

// --- Argument parsing ---

const args = process.argv.slice(2);
let format = 'openclaw';
let outputPath = null;

for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--format' || args[i] === '-f') && args[i + 1]) {
    format = args[i + 1];
    i++;
  } else if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
    outputPath = args[i + 1];
    i++;
  }
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(chalk.blue.bold('\nKnobase Export\n'));
  console.log('Export your agent knowledge base in various formats\n');
  console.log(chalk.white('Usage:'));
  console.log(chalk.gray('  openclaw-knobase export [options]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --format, -f <fmt>   Export format: openclaw, claude, or markdown (default: openclaw)'));
  console.log(chalk.gray('  --output, -o <path>  Output file path (default: current directory)\n'));
  console.log(chalk.white('Formats:'));
  console.log(chalk.gray('  openclaw   JSON with all files'));
  console.log(chalk.gray('  claude     Markdown formatted for Claude projects'));
  console.log(chalk.gray('  markdown   Simple concatenated markdown\n'));
  console.log(chalk.white('Examples:'));
  console.log(chalk.gray('  openclaw-knobase export'));
  console.log(chalk.gray('  openclaw-knobase export --format claude'));
  console.log(chalk.gray('  openclaw-knobase export --format markdown --output ./export.md'));
  console.log(chalk.gray('  openclaw-knobase export -f openclaw -o /tmp/backup.json\n'));
  process.exit(0);
}

if (!VALID_FORMATS.includes(format)) {
  console.error(chalk.red(`\n  Invalid format: ${format}`));
  console.log(chalk.gray(`  Valid formats: ${VALID_FORMATS.join(', ')}\n`));
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

function defaultFilename(fmt) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `knobase-export-${timestamp}${FORMAT_EXTENSIONS[fmt]}`;
}

// --- Main ---

async function runExport() {
  console.log(chalk.blue.bold('\nKnobase Export\n'));

  // Load config
  const config = await loadConfig();

  const apiKey = config.KNOBASE_API_KEY;
  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const exportAgentId = config.AGENT_ID;

  if (!apiKey) {
    console.error(chalk.red('  KNOBASE_API_KEY not found in .env'));
    console.log(chalk.gray('  Run: openclaw-knobase connect\n'));
    process.exit(1);
  }

  if (!exportAgentId) {
    console.error(chalk.red('  AGENT_ID not found in .env'));
    console.log(chalk.gray('  Run: openclaw-knobase connect\n'));
    process.exit(1);
  }

  console.log(chalk.gray(`  Agent:  ${exportAgentId}`));
  console.log(chalk.gray(`  Format: ${format}`));
  console.log('');

  // Call export API
  const url = `${baseUrl}/api/agents/${encodeURIComponent(exportAgentId)}/export`;

  console.log(chalk.gray('  Exporting...'));

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ format }),
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
    console.error(chalk.red(`\n  Agent "${exportAgentId}" not found. Check your AGENT_ID in .env\n`));
    process.exit(1);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`\n  Export API returned ${response.status}: ${body || response.statusText}\n`));
    process.exit(1);
  }

  const data = await response.text();

  // Determine output file path
  const resolvedOutput = outputPath
    ? path.resolve(process.cwd(), outputPath)
    : path.join(process.cwd(), defaultFilename(format));

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });

  // Write file
  await fs.writeFile(resolvedOutput, data, 'utf8');

  const stat = await fs.stat(resolvedOutput);

  console.log(chalk.green.bold('\n  Export complete!\n'));
  console.log(chalk.white(`  File:   ${resolvedOutput}`));
  console.log(chalk.white(`  Format: ${format}`));
  console.log(chalk.white(`  Size:   ${formatSize(stat.size)}`));
  console.log('');
}

runExport().catch((err) => {
  console.error(chalk.red(`\n  ${err.message}\n`));
  process.exit(1);
});
