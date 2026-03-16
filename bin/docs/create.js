#!/usr/bin/env node

/**
 * Create a new document in a Knobase workspace.
 *
 * Usage: knobase docs create <title> [--content <content>]
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

function parseArgs(argv) {
  const args = argv.slice(2);
  let title = null;
  let content = null;

  const titleParts = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--content') {
      const contentParts = [];
      for (let j = i + 1; j < args.length; j++) {
        contentParts.push(args[j]);
      }
      content = contentParts.join(' ') || null;
      break;
    }
    titleParts.push(args[i]);
  }

  title = titleParts.join(' ').trim() || null;
  return { title, content };
}

async function createDocument(title, content) {
  console.log(chalk.blue.bold('\n📝 Knobase Create Document\n'));

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
  const url = `${baseUrl}/api/v1/documents`;

  const body = {
    title,
    workspace_id: workspaceId,
  };
  if (content) {
    body.content = content;
  }

  console.log(chalk.gray(`Creating document: "${title}"...`));

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(chalk.red(`✗ Network error: ${err.message}`));
    process.exit(1);
  }

  if (response.status === 401 || response.status === 403) {
    console.error(chalk.red('✗ Access denied. Check your API key and permissions.'));
    process.exit(1);
  }

  if (response.status === 409) {
    console.error(chalk.red(`✗ A document with this title already exists.`));
    process.exit(1);
  }

  if (response.status === 422) {
    const errBody = await response.json().catch(() => ({}));
    const detail = errBody.message ?? errBody.error ?? 'Validation failed';
    console.error(chalk.red(`✗ Validation error: ${detail}`));
    process.exit(1);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${text || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const doc = data.document ?? data.data ?? data;

  const divider = chalk.gray('─'.repeat(50));
  console.log('');
  console.log(chalk.green.bold('✓ Document created successfully'));
  console.log(divider);
  console.log(chalk.gray('ID:    ') + chalk.cyan(doc.id));
  console.log(chalk.gray('Title: ') + chalk.white(doc.title ?? title));
  if (doc.created_at) {
    console.log(chalk.gray('Date:  ') + chalk.white(new Date(doc.created_at).toLocaleString()));
  }
  console.log(divider);
  console.log('');
}

const { title, content } = parseArgs(process.argv);

if (!title || title === '--help' || title === '-h') {
  console.log(chalk.blue.bold('Create a Knobase document\n'));
  console.log(chalk.white('Usage: knobase docs create <title> [--content <content>]\n'));
  console.log(chalk.gray('Examples:'));
  console.log(chalk.gray('  knobase docs create "Meeting Notes"'));
  console.log(chalk.gray('  knobase docs create "API Docs" --content "Initial draft"'));
  console.log(chalk.gray('  knobase docs create "Design Spec" --content "## Overview\\nThis is the spec."\n'));
  process.exit(0);
}

createDocument(title, content).catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
