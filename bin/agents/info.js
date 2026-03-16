#!/usr/bin/env node

/**
 * Get current agent's profile information.
 *
 * Usage: knobase agents info
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

function section(title) {
  console.log(chalk.blue.bold(`\n  ${title}`));
  console.log(chalk.gray('  ' + '─'.repeat(44)));
}

function field(label, value, color = 'white') {
  const displayValue = value || chalk.gray('—');
  console.log(`  ${chalk.gray(label.padEnd(18))} ${chalk[color](displayValue)}`);
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items
    .map(item => (typeof item === 'string' ? item : item.name ?? item.id ?? ''))
    .filter(Boolean)
    .join(', ');
}

function statusBadge(status) {
  const s = (status ?? '').toLowerCase();
  if (s === 'active' || s === 'online') return chalk.green('● Active');
  if (s === 'inactive' || s === 'offline') return chalk.gray('○ Inactive');
  if (s === 'error') return chalk.red('✗ Error');
  return chalk.yellow(s || '—');
}

function typeLabel(agent) {
  const kind = (agent.type ?? agent.kind ?? '').toLowerCase();
  if (kind === 'human' || agent.is_human) return chalk.blue('Human');
  if (kind === 'ai' || kind === 'bot' || kind === 'agent') return chalk.magenta('AI Agent');
  return chalk.white(kind || 'Unknown');
}

function printAgentProfile(agent) {
  const name = agent.name ?? agent.display_name ?? 'Unnamed Agent';
  const id = agent.id ?? agent.agent_id ?? '—';

  console.log('');
  console.log(chalk.bold.cyan(`  🤖 ${name}`));
  console.log(chalk.gray(`  ID: ${id}`));

  // Overview
  section('Overview');
  field('Type', typeLabel(agent));
  field('Status', statusBadge(agent.status));
  if (agent.description) {
    field('Description', agent.description);
  }
  if (agent.email) {
    field('Email', agent.email);
  }
  if (agent.avatar || agent.avatar_url) {
    field('Avatar', agent.avatar ?? agent.avatar_url);
  }

  // Capabilities & Expertise
  const capabilities = formatList(agent.capabilities ?? agent.skills ?? []);
  const expertise = formatList(agent.expertise ?? agent.domains ?? []);

  if (capabilities || expertise) {
    section('Capabilities & Expertise');
    if (capabilities) {
      field('Capabilities', capabilities, 'cyan');
    }
    if (expertise) {
      field('Expertise', expertise, 'cyan');
    }
  }

  // Workspace
  const workspaceId = agent.workspace_id ?? agent.school_id ?? null;
  const workspaceName = agent.workspace_name ?? agent.school_name ?? null;
  if (workspaceId || workspaceName) {
    section('Workspace');
    if (workspaceName) field('Name', workspaceName);
    if (workspaceId) field('Workspace ID', workspaceId);
  }

  // Stats
  const stats = agent.stats ?? agent.usage ?? null;
  if (stats && typeof stats === 'object') {
    section('Stats');
    for (const [key, value] of Object.entries(stats)) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      field(label, String(value));
    }
  }

  // Timestamps
  const createdAt = agent.created_at ?? agent.createdAt ?? null;
  const updatedAt = agent.updated_at ?? agent.updatedAt ?? null;
  if (createdAt || updatedAt) {
    section('Timestamps');
    if (createdAt) field('Created', new Date(createdAt).toLocaleString());
    if (updatedAt) field('Updated', new Date(updatedAt).toLocaleString());
  }

  console.log('');
}

async function agentInfo() {
  console.log(chalk.blue.bold('\n🤖 Agent Profile\n'));

  const config = await loadConfig();

  if (!config) {
    console.error(chalk.red('✗ Could not load .env config.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  const apiKey = config.KNOBASE_API_KEY;

  if (!apiKey) {
    console.error(chalk.red('✗ KNOBASE_API_KEY is not set in .env'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  const baseUrl = config.KNOBASE_API_ENDPOINT || 'https://app.knobase.com';
  const agentId = config.AGENT_ID || config.KNOBASE_AGENT_ID;
  const url = agentId
    ? `${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}`
    : `${baseUrl}/api/v1/agents/me`;

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

  if (response.status === 401) {
    console.error(chalk.red('✗ Not authenticated — API key is invalid or expired.'));
    console.log(chalk.gray('  Run: openclaw knobase auth'));
    process.exit(1);
  }

  if (response.status === 403) {
    console.error(chalk.red('✗ Forbidden — insufficient permissions to view agent profile.'));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const agent = data.agent ?? data.data ?? data;

  printAgentProfile(agent);
}

agentInfo().catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
