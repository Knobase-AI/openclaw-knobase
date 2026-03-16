#!/usr/bin/env node

/**
 * Find collaborators by capability or expertise.
 *
 * Usage: knobase agents find <query>
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

function typeLabel(type) {
  const kind = (type ?? '').toLowerCase();
  if (kind === 'human') return chalk.blue('Human');
  if (kind === 'ai' || kind === 'bot' || kind === 'agent') return chalk.magenta('Agent');
  return chalk.white(kind || 'Unknown');
}

function confidenceBar(score) {
  const pct = Math.round((score ?? 0) * 100);
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `${bar} ${chalk.bold.white(pct + '%')}`;
}

function formatList(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items
    .map(item => (typeof item === 'string' ? item : item.name ?? item.id ?? ''))
    .filter(Boolean);
}

function printResult(result, index) {
  const agent = result.agent ?? result.collaborator ?? result;
  const name = agent.name ?? agent.display_name ?? 'Unnamed';
  const type = agent.type ?? agent.kind ?? '';
  const description = agent.description ?? agent.bio ?? '';
  const mention = agent.mention ?? agent.mention_syntax ?? (agent.username ? `@${agent.username}` : null);
  const score = result.confidence ?? result.score ?? result.relevance ?? null;

  const capabilities = formatList(agent.capabilities ?? agent.skills ?? []);
  const expertise = formatList(agent.expertise ?? agent.domains ?? []);

  console.log(chalk.gray('  ' + '─'.repeat(56)));
  console.log(`  ${chalk.bold.cyan(`${index + 1}. ${name}`)}  ${typeLabel(type)}`);

  if (score !== null && score !== undefined) {
    console.log(`     ${chalk.gray('Confidence:')} ${confidenceBar(score)}`);
  }

  if (description) {
    console.log(`     ${chalk.gray('Description:')} ${chalk.white(description)}`);
  }

  if (capabilities && capabilities.length > 0) {
    console.log(`     ${chalk.gray('Capabilities:')} ${capabilities.map(c => chalk.cyan(c)).join(chalk.gray(', '))}`);
  }

  if (expertise && expertise.length > 0) {
    console.log(`     ${chalk.gray('Expertise:')} ${expertise.map(e => chalk.yellow(e)).join(chalk.gray(', '))}`);
  }

  if (mention) {
    console.log(`     ${chalk.gray('Mention:')} ${chalk.green(mention)}`);
  }
}

async function findCollaborators() {
  const query = process.argv.slice(2).join(' ').trim();

  if (!query || query === '--help' || query === '-h') {
    console.log(chalk.blue.bold('\n🔍 Find Collaborators\n'));
    console.log(chalk.white('Usage: knobase agents find <query>\n'));
    console.log(chalk.white('Search for collaborators by capability or expertise.\n'));
    console.log(chalk.white('Examples:'));
    console.log(chalk.gray('  knobase agents find "code review"'));
    console.log(chalk.gray('  knobase agents find python backend'));
    console.log(chalk.gray('  knobase agents find "data analysis"'));
    console.log(chalk.gray('  knobase agents find design UI\n'));
    process.exit(query ? 0 : 1);
  }

  console.log(chalk.blue.bold('\n🔍 Find Collaborators\n'));
  console.log(chalk.gray(`  Searching for: "${query}"\n`));

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
        tool: 'collaborators/discover',
        arguments: {
          workspace_id: workspaceId,
          query,
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
    console.error(chalk.red('✗ Forbidden — insufficient permissions.'));
    process.exit(1);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(chalk.red(`✗ API returned ${response.status}: ${body || response.statusText}`));
    process.exit(1);
  }

  const data = await response.json();
  const results = Array.isArray(data)
    ? data
    : data.results ?? data.collaborators ?? data.matches ?? data.data ?? [];

  if (results.length === 0) {
    console.log(chalk.yellow('  No collaborators found matching your query.'));
    console.log(chalk.gray('  Try broadening your search terms.\n'));
    return;
  }

  const sorted = [...results].sort((a, b) => {
    const sa = a.confidence ?? a.score ?? a.relevance ?? 0;
    const sb = b.confidence ?? b.score ?? b.relevance ?? 0;
    return sb - sa;
  });

  console.log(chalk.white(`  Found ${chalk.bold(sorted.length)} collaborator(s):\n`));

  for (let i = 0; i < sorted.length; i++) {
    printResult(sorted[i], i);
  }

  console.log(chalk.gray('\n  ' + '─'.repeat(56)));
  console.log(chalk.gray(`  Tip: Use the mention syntax to collaborate in documents.\n`));
}

findCollaborators().catch(err => {
  console.error(chalk.red(`✗ ${err.message}`));
  process.exit(1);
});
