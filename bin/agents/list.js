#!/usr/bin/env node

/**
 * List all agents in a Knobase workspace.
 *
 * Usage: knobase agents list
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

function typeLabel(agent) {
  const kind = (agent.type ?? agent.kind ?? '').toLowerCase();
  if (kind === 'human' || agent.is_human) {
    return chalk.blue('Human');
  }
  if (kind === 'ai' || kind === 'bot' || kind === 'agent') {
    return chalk.magenta('Agent');
  }
  return chalk.white(kind || 'Unknown');
}

function statusBadge(agent) {
  const status = (agent.status ?? '').toLowerCase();
  if (status === 'active' || status === 'online') return chalk.green('● Active');
  if (status === 'inactive' || status === 'offline') return chalk.gray('○ Inactive');
  if (status === 'error') return chalk.red('✗ Error');
  return chalk.yellow(status || '—');
}

function formatCapabilities(agent) {
  const caps = agent.capabilities ?? agent.skills ?? [];
  if (!Array.isArray(caps) || caps.length === 0) return chalk.gray('—');
  return caps.map(c => (typeof c === 'string' ? c : c.name ?? c.id ?? '')).join(', ');
}

function printTable(agents) {
  const nameWidth = 28;
  const typeWidth = 12;
  const statusWidth = 16;
  const capWidth = 40;

  const header =
    chalk.bold('Name'.padEnd(nameWidth)) +
    chalk.bold('Type'.padEnd(typeWidth)) +
    chalk.bold('Status'.padEnd(statusWidth)) +
    chalk.bold('Capabilities');

  const separator = chalk.gray('─'.repeat(nameWidth + typeWidth + statusWidth + capWidth));

  console.log('');
  console.log(header);
  console.log(separator);

  const humans = [];
  const bots = [];

  for (const agent of agents) {
    const kind = (agent.type ?? agent.kind ?? '').toLowerCase();
    if (kind === 'human' || agent.is_human) {
      humans.push(agent);
    } else {
      bots.push(agent);
    }
  }

  const sorted = [...bots, ...humans];

  for (const agent of sorted) {
    const name = (agent.name ?? agent.display_name ?? 'Unnamed')
      .slice(0, nameWidth - 2)
      .padEnd(nameWidth);
    const type = typeLabel(agent).padEnd(typeWidth + 10); // +10 accounts for chalk ANSI codes
    const status = statusBadge(agent).padEnd(statusWidth + 10);
    const caps = formatCapabilities(agent);

    console.log(chalk.cyan(name) + type + status + caps);
  }

  console.log(separator);

  const agentCount = bots.length;
  const humanCount = humans.length;
  console.log(
    chalk.gray(`\n${agents.length} member(s): `) +
    chalk.magenta(`${agentCount} agent(s)`) +
    chalk.gray(' · ') +
    chalk.blue(`${humanCount} human(s)`) +
    chalk.gray('\n')
  );
}

async function listAgents() {
  console.log(chalk.blue.bold('\n🤖 Knobase Workspace Agents\n'));

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
  const url = `${baseUrl}/api/v1/agents?workspace_id=${encodeURIComponent(workspaceId)}`;

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
  const agents = Array.isArray(data) ? data : data.agents ?? data.members ?? data.data ?? [];

  if (agents.length === 0) {
    console.log(chalk.yellow('No agents found in this workspace.'));
    return;
  }

  printTable(agents);
}

listAgents().catch(err => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
