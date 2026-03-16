#!/usr/bin/env node

/**
 * List all documents in a Knobase workspace.
 *
 * Usage: node bin/docs/list.js
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

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleString();
}

function printTable(documents) {
  const idWidth = 26;
  const titleWidth = 40;
  const dateWidth = 24;

  const header =
    chalk.bold('ID'.padEnd(idWidth)) +
    chalk.bold('Title'.padEnd(titleWidth)) +
    chalk.bold('Updated At'.padEnd(dateWidth));

  const separator = chalk.gray('─'.repeat(idWidth + titleWidth + dateWidth));

  console.log('');
  console.log(header);
  console.log(separator);

  for (const doc of documents) {
    const id = (doc.id ?? '').toString().slice(0, idWidth - 2).padEnd(idWidth);
    const title = (doc.title ?? 'Untitled').slice(0, titleWidth - 2).padEnd(titleWidth);
    const updated = formatDate(doc.updated_at).padEnd(dateWidth);

    console.log(chalk.cyan(id) + chalk.white(title) + chalk.gray(updated));
  }

  console.log(separator);
  console.log(chalk.gray(`\n${documents.length} document(s) found.\n`));
}

async function listDocuments() {
  console.log(chalk.blue.bold('\n📄 Knobase Documents\n'));

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
  const url = `${baseUrl}/api/v1/documents?workspace_id=${encodeURIComponent(workspaceId)}`;

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

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const documents = Array.isArray(data) ? data : data.documents ?? data.data ?? [];

  if (documents.length === 0) {
    console.log(chalk.yellow('No documents found in this workspace.'));
    return;
  }

  printTable(documents);
}

listDocuments().catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
