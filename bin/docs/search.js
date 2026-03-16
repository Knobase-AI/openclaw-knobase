#!/usr/bin/env node

/**
 * Search documents in a Knobase workspace.
 *
 * Usage: knobase docs search <query>
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

async function loadConfig() {
  try {
    const content = await fs.readFile(ENV_FILE, 'utf8');
    const config = {};
    content.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        config[key.trim()] = valueParts.join('=').trim();
      }
    });
    return config;
  } catch {
    return null;
  }
}

function formatScore(score) {
  if (score == null) return '';
  const pct = typeof score === 'number' ? score : parseFloat(score);
  if (isNaN(pct)) return '';

  const normalized = pct > 1 ? pct : pct * 100;
  const rounded = Math.round(normalized);

  if (rounded >= 80) return chalk.green(`${rounded}%`);
  if (rounded >= 50) return chalk.yellow(`${rounded}%`);
  return chalk.red(`${rounded}%`);
}

function printResults(results, query) {
  const divider = chalk.gray('─'.repeat(70));

  console.log('');
  console.log(chalk.bold(`Found ${results.length} result(s) for `) + chalk.cyan(`"${query}"`));
  console.log(divider);

  for (const [i, item] of results.entries()) {
    const doc = item.document ?? item;
    const title = doc.title ?? doc.name ?? 'Untitled';
    const id = doc.id ?? '';
    const score = item.score ?? item.relevance ?? item.relevance_score;
    const snippet = item.snippet ?? item.highlight ?? item.excerpt ?? '';

    const scoreStr = formatScore(score);
    const prefix = chalk.gray(`${i + 1}.`);

    console.log(`${prefix} ${chalk.bold.white(title)}${scoreStr ? '  ' + scoreStr : ''}`);
    console.log(chalk.gray(`   ID: `) + chalk.cyan(id));

    if (snippet) {
      const trimmed = snippet.replace(/\s+/g, ' ').trim().slice(0, 200);
      console.log(chalk.gray(`   `) + chalk.dim(trimmed));
    }

    if (i < results.length - 1) {
      console.log('');
    }
  }

  console.log(divider);
  console.log('');
}

async function searchDocuments(query) {
  console.log(chalk.blue.bold('\n🔍 Knobase Search\n'));

  const config = await loadConfig();

  if (!config) {
    console.error(chalk.red('✗ Could not load .env config.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  const apiKey = config.KNOBASE_API_KEY;
  const workspaceId = config.KNOBASE_WORKSPACE_ID;

  if (!apiKey) {
    console.error(chalk.red('✗ KNOBASE_API_KEY is not set in .env'));
    process.exit(1);
  }

  if (!workspaceId) {
    console.error(chalk.red('✗ KNOBASE_WORKSPACE_ID is not set in .env'));
    process.exit(1);
  }

  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const url = `${baseUrl}/api/v1/search?q=${encodeURIComponent(query)}&workspace_id=${encodeURIComponent(workspaceId)}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    console.error(chalk.red(`✗ Network error: ${err.message}`));
    process.exit(1);
  }

  if (response.status === 401 || response.status === 403) {
    console.error(chalk.red('✗ Access denied. Check your API key and permissions.'));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const results = Array.isArray(data) ? data : data.results ?? data.documents ?? data.data ?? [];

  if (results.length === 0) {
    console.log(chalk.yellow(`No results found for "${query}".`));
    return;
  }

  printResults(results, query);
}

const query = process.argv.slice(2).join(' ').trim();

if (!query || query === '--help' || query === '-h') {
  console.log(chalk.blue.bold('Search Knobase documents\n'));
  console.log(chalk.white('Usage: knobase docs search <query>\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  knobase docs search "project roadmap"'));
  console.log(chalk.gray('  knobase docs search meeting notes'));
  console.log(chalk.gray('  knobase docs search API documentation\n'));
  process.exit(0);
}

searchDocuments(query).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
