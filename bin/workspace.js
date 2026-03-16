#!/usr/bin/env node

/**
 * Show Knobase workspace information.
 *
 * Usage: knobase workspace
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

function section(title) {
  console.log(chalk.blue.bold(`\n  ${title}`));
  console.log(chalk.gray('  ' + '─'.repeat(44)));
}

function field(label, value, color = 'white') {
  const displayValue = value != null && value !== '' ? String(value) : chalk.gray('—');
  console.log(`  ${chalk.gray(label.padEnd(18))} ${chalk[color](displayValue)}`);
}

async function fetchWorkspace(baseUrl, workspaceId, apiKey) {
  const url = `${baseUrl}/api/v1/workspaces/${encodeURIComponent(workspaceId)}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
    },
  });

  if (response.status === 401) {
    console.error(chalk.red('✗ Not authenticated — API key is invalid or expired.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  if (response.status === 403) {
    console.error(chalk.red('✗ Forbidden — insufficient permissions to view this workspace.'));
    process.exit(1);
  }

  if (response.status === 404) {
    console.error(chalk.red('✗ Workspace not found — check KNOBASE_WORKSPACE_ID in .env'));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  return data.workspace ?? data.data ?? data;
}

async function fetchAgentInfo(baseUrl, agentId, apiKey) {
  const url = agentId
    ? `${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}`
    : `${baseUrl}/api/v1/agents/me`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data.agent ?? data.data ?? data;
  } catch {
    return null;
  }
}

function printWorkspace(workspace, agent) {
  const name = workspace.name ?? workspace.display_name ?? 'Unnamed Workspace';
  const id = workspace.id ?? workspace.workspace_id ?? '—';

  console.log('');
  console.log(chalk.bold.cyan(`  🏢 ${name}`));
  console.log(chalk.gray(`  ID: ${id}`));

  section('Details');
  if (workspace.description) {
    field('Description', workspace.description);
  }
  if (workspace.slug) {
    field('Slug', workspace.slug);
  }
  if (workspace.plan ?? workspace.tier) {
    field('Plan', workspace.plan ?? workspace.tier);
  }

  section('Counts');
  const memberCount = workspace.member_count
    ?? workspace.members_count
    ?? (Array.isArray(workspace.members) ? workspace.members.length : null);
  const docCount = workspace.document_count
    ?? workspace.documents_count
    ?? workspace.doc_count
    ?? (Array.isArray(workspace.documents) ? workspace.documents.length : null);
  const agentCount = workspace.agent_count
    ?? workspace.agents_count
    ?? (Array.isArray(workspace.agents) ? workspace.agents.length : null);

  field('Members', memberCount != null ? String(memberCount) : null, 'cyan');
  field('Documents', docCount != null ? String(docCount) : null, 'cyan');
  field('Agents', agentCount != null ? String(agentCount) : null, 'cyan');

  const createdAt = workspace.created_at ?? workspace.createdAt ?? null;
  const updatedAt = workspace.updated_at ?? workspace.updatedAt ?? null;
  if (createdAt || updatedAt) {
    section('Timestamps');
    if (createdAt) field('Created', new Date(createdAt).toLocaleString());
    if (updatedAt) field('Updated', new Date(updatedAt).toLocaleString());
  }

  if (agent) {
    section('Connected Agent');
    const agentName = agent.name ?? agent.display_name ?? 'Unnamed';
    const agentId = agent.id ?? agent.agent_id ?? '—';
    const status = (agent.status ?? '').toLowerCase();
    const statusLabel = status === 'active' || status === 'online'
      ? chalk.green('● Active')
      : status === 'inactive' || status === 'offline'
        ? chalk.gray('○ Inactive')
        : status === 'error'
          ? chalk.red('✗ Error')
          : chalk.yellow(status || '—');

    field('Name', agentName, 'cyan');
    field('Agent ID', agentId);
    field('Status', statusLabel);

    const capabilities = agent.capabilities ?? agent.skills ?? [];
    if (Array.isArray(capabilities) && capabilities.length > 0) {
      const caps = capabilities
        .map(c => (typeof c === 'string' ? c : c.name ?? c.id ?? ''))
        .filter(Boolean)
        .join(', ');
      if (caps) field('Capabilities', caps);
    }
  }

  console.log('');
}

async function showWorkspace() {
  console.log(chalk.blue.bold('\n🏢 Knobase Workspace Info\n'));

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
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';

  let workspace;
  try {
    workspace = await fetchWorkspace(baseUrl, workspaceId, apiKey);
  } catch (err) {
    console.error(chalk.red(`✗ Network error: ${err.message}`));
    process.exit(1);
  }

  const agentId = config.AGENT_ID || config.KNOBASE_AGENT_ID;
  const agent = await fetchAgentInfo(baseUrl, agentId, apiKey);

  printWorkspace(workspace, agent);

  console.log(chalk.gray('  ─'.repeat(15)));
  console.log(chalk.gray('  Config: ') + ENV_FILE);
  console.log('');
}

showWorkspace().catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
