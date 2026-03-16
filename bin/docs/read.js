#!/usr/bin/env node

/**
 * Read a specific document from Knobase.
 *
 * Usage: knobase docs read <document-id>
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

function printDocument(doc) {
  const divider = chalk.gray('─'.repeat(60));

  console.log('');
  console.log(divider);
  console.log(chalk.bold.white(doc.title ?? 'Untitled'));
  console.log(divider);

  console.log(chalk.gray('ID:         ') + chalk.cyan(doc.id));

  if (doc.created_at) {
    console.log(chalk.gray('Created:    ') + chalk.white(formatDate(doc.created_at)));
  }
  if (doc.updated_at) {
    console.log(chalk.gray('Updated:    ') + chalk.white(formatDate(doc.updated_at)));
  }
  if (doc.author || doc.created_by) {
    console.log(chalk.gray('Author:     ') + chalk.white(doc.author ?? doc.created_by));
  }
  if (doc.status) {
    console.log(chalk.gray('Status:     ') + chalk.white(doc.status));
  }
  if (doc.tags && doc.tags.length > 0) {
    const tags = doc.tags.map(t => chalk.blue(`#${t}`)).join(' ');
    console.log(chalk.gray('Tags:       ') + tags);
  }

  const meta = Object.entries(doc).filter(([key]) =>
    !['id', 'title', 'content', 'body', 'text', 'created_at', 'updated_at',
      'author', 'created_by', 'status', 'tags'].includes(key)
  );
  if (meta.length > 0) {
    console.log('');
    console.log(chalk.bold.gray('Metadata'));
    for (const [key, value] of meta) {
      if (value == null || (typeof value === 'object' && !Array.isArray(value))) continue;
      const display = Array.isArray(value) ? value.join(', ') : String(value);
      console.log(chalk.gray(`  ${key}: `) + chalk.white(display));
    }
  }

  const content = doc.content ?? doc.body ?? doc.text;
  if (content) {
    console.log('');
    console.log(divider);
    console.log(chalk.bold.gray('Content'));
    console.log(divider);
    console.log('');
    console.log(content);
  }

  console.log('');
  console.log(divider);
  console.log('');
}

async function readDocument(documentId) {
  console.log(chalk.blue.bold('\n📄 Knobase Document\n'));

  const config = await loadConfig();

  if (!config) {
    console.error(chalk.red('✗ Could not load .env config.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  const apiKey = config.KNOBASE_API_KEY;

  if (!apiKey) {
    console.error(chalk.red('✗ KNOBASE_API_KEY is not set in .env'));
    process.exit(1);
  }

  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const url = `${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}`;

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

  if (response.status === 404) {
    console.error(chalk.red(`✗ Document not found: ${documentId}`));
    process.exit(1);
  }

  if (response.status === 403 || response.status === 401) {
    console.error(chalk.red(`✗ Access denied. Check your API key and permissions.`));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const doc = data.document ?? data.data ?? data;

  printDocument(doc);
}

const documentId = process.argv[2];

if (!documentId || documentId === '--help' || documentId === '-h') {
  console.log(chalk.blue.bold('Read a Knobase document\n'));
  console.log(chalk.white('Usage: knobase docs read <document-id>\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  knobase docs read abc123'));
  console.log(chalk.gray('  knobase docs read "my-document-slug"\n'));
  process.exit(0);
}

readDocument(documentId).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
