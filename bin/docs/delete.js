#!/usr/bin/env node

/**
 * Delete a document from Knobase.
 *
 * Usage: knobase docs delete <document-id> [--force]
 */

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
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

function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(message, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function fetchDocumentTitle(baseUrl, apiKey, documentId) {
  const url = `${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}`;
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const doc = data.document ?? data.data ?? data;
    return doc.title ?? null;
  } catch {
    return null;
  }
}

async function deleteDocument(documentId, force) {
  console.log(chalk.blue.bold('\n🗑️  Knobase Delete Document\n'));

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

  const title = await fetchDocumentTitle(baseUrl, apiKey, documentId);

  if (!force) {
    const divider = chalk.gray('─'.repeat(50));
    console.log(divider);
    console.log(chalk.gray('Document: ') + chalk.cyan(documentId));
    if (title) {
      console.log(chalk.gray('Title:    ') + chalk.white(title));
    }
    console.log(divider);
    console.log('');
    console.log(chalk.yellow('⚠  This action is permanent and cannot be undone.'));
    console.log('');

    const answer = await confirm(chalk.bold('Are you sure you want to delete this document? (y/N) '));
    if (answer !== 'y' && answer !== 'yes') {
      console.log(chalk.gray('\nAborted. Document was not deleted.\n'));
      process.exit(0);
    }
    console.log('');
  }

  console.log(chalk.gray('Deleting document...'));

  const url = `${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'DELETE',
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
    console.log(chalk.gray('  The document may have already been deleted.'));
    process.exit(1);
  }

  if (response.status === 403 || response.status === 401) {
    console.error(chalk.red('✗ Access denied. Check your API key and permissions.'));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const divider = chalk.gray('─'.repeat(50));
  console.log('');
  console.log(chalk.green.bold('✓ Document deleted successfully'));
  console.log(divider);
  console.log(chalk.gray('Document: ') + chalk.cyan(documentId));
  if (title) {
    console.log(chalk.gray('Title:    ') + chalk.white(title));
  }
  console.log(divider);
  console.log('');
}

function showHelp() {
  console.log(chalk.blue.bold('Delete a Knobase document\n'));
  console.log(chalk.white('Usage: knobase docs delete <document-id> [--force]\n'));
  console.log(chalk.white('Options:'));
  console.log(chalk.gray('  --force    Skip confirmation prompt\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  knobase docs delete abc123'));
  console.log(chalk.gray('  knobase docs delete abc123 --force\n'));
  process.exit(0);
}

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter(a => !a.startsWith('--'));
const documentId = positional[0];

if (!documentId || documentId === '--help' || args.includes('--help') || args.includes('-h')) {
  showHelp();
}

deleteDocument(documentId, force).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
