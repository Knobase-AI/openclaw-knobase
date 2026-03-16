#!/usr/bin/env node

/**
 * Create a @mention in a Knobase document.
 *
 * Usage: knobase mention <document-id> <target-user-id> <message>
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
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

function showHelp() {
  console.log(chalk.blue.bold('Create a @mention in a Knobase document\n'));
  console.log(chalk.white('Usage: knobase mention <document-id> <target-user-id> <message>\n'));
  console.log(chalk.white('Arguments:'));
  console.log(chalk.gray('  document-id      ID of the document to add the mention to'));
  console.log(chalk.gray('  target-user-id   ID of the user to mention'));
  console.log(chalk.gray('  message          The mention message text\n'));
  console.log(chalk.white('Examples:'));
  console.log(chalk.gray('  knobase mention doc123 user456 "Can you review this section?"'));
  console.log(chalk.gray('  knobase mention abc-doc agent-01 "Please update the summary"'));
  console.log(chalk.gray('  knobase mention meeting-notes jdoe "FYI — action items updated"\n'));
  process.exit(0);
}

async function createMention(documentId, targetUserId, message) {
  console.log(chalk.blue.bold('\n💬 Knobase Create Mention\n'));

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
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  if (!workspaceId) {
    console.error(chalk.red('✗ KNOBASE_WORKSPACE_ID is not set in .env'));
    process.exit(1);
  }

  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const url = `${baseUrl}/api/v1/mcp/tools/call`;

  console.log(chalk.gray(`  Document:    ${documentId}`));
  console.log(chalk.gray(`  Target user: ${targetUserId}`));
  console.log(chalk.gray(`  Message:     "${message}"`));
  console.log('');

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        tool: 'create_mention',
        arguments: {
          workspace_id: workspaceId,
          document_id: documentId,
          target_user_id: targetUserId,
          message,
        },
      }),
    });
  } catch (err) {
    console.error(chalk.red(`✗ Network error: ${err.message}`));
    process.exit(1);
  }

  if (response.status === 401) {
    console.error(chalk.red('✗ Not authenticated — API key is invalid or expired.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  if (response.status === 403) {
    console.error(chalk.red('✗ Forbidden — insufficient permissions for this document.'));
    process.exit(1);
  }

  if (response.status === 404) {
    const body = await response.json().catch(() => ({}));
    const detail = body.message ?? body.error ?? '';
    const lowerDetail = detail.toLowerCase();
    if (lowerDetail.includes('user') || lowerDetail.includes('agent')) {
      console.error(chalk.red(`✗ User not found: ${targetUserId}`));
      console.log(chalk.gray('  Verify the target user ID exists in this workspace.'));
    } else if (lowerDetail.includes('document')) {
      console.error(chalk.red(`✗ Document not found: ${documentId}`));
      console.log(chalk.gray('  Run "knobase docs list" to see available documents.'));
    } else {
      console.error(chalk.red(`✗ Not found: ${detail || 'document or user does not exist'}`));
    }
    process.exit(1);
  }

  if (response.status === 422) {
    const body = await response.json().catch(() => ({}));
    const detail = body.message ?? body.error ?? 'Validation failed';
    console.error(chalk.red(`✗ Validation error: ${detail}`));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const mention = data.mention ?? data.data ?? data;

  const divider = chalk.gray('─'.repeat(50));
  console.log(chalk.green.bold('✓ Mention created successfully'));
  console.log(divider);
  if (mention.id) {
    console.log(chalk.gray('Mention ID:  ') + chalk.cyan(mention.id));
  }
  console.log(chalk.gray('Document:    ') + chalk.cyan(documentId));
  console.log(chalk.gray('Target user: ') + chalk.cyan(targetUserId));
  console.log(chalk.gray('Message:     ') + chalk.white(message));
  if (mention.created_at) {
    console.log(chalk.gray('Created:     ') + chalk.white(new Date(mention.created_at).toLocaleString()));
  }
  console.log(divider);
  console.log('');
}

const documentId = process.argv[2];
const targetUserId = process.argv[3];
const message = process.argv.slice(4).join(' ').trim();

if (!documentId || documentId === '--help' || documentId === '-h') {
  showHelp();
}

if (!targetUserId) {
  console.error(chalk.red('✗ Missing required argument: <target-user-id>'));
  console.log(chalk.gray('  Usage: knobase mention <document-id> <target-user-id> <message>\n'));
  process.exit(1);
}

if (!message) {
  console.error(chalk.red('✗ Missing required argument: <message>'));
  console.log(chalk.gray('  Usage: knobase mention <document-id> <target-user-id> <message>\n'));
  process.exit(1);
}

createMention(documentId, targetUserId, message).catch(err => {
  console.error(chalk.red(`✗ ${err.message}`));
  process.exit(1);
});
