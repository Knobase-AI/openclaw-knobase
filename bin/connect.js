#!/usr/bin/env node

/**
 * Knobase One-Click Agent Connection
 * 
 * Usage: openclaw-knobase connect --device-code <device_code> [--name <agent_name>] [--agent <agent_id>]
 * 
 * Implements a streamlined connection flow:
 * 1. Reads ~/.openclaw/openclaw.json and lets user select which OpenClaw agent to connect
 * 2. Takes a device_code (UUID) from the --device-code flag
 * 3. Exchanges it for a token via the device token endpoint
 * 4. Connects the agent to the workspace
 * 5. Saves credentials (including OPENCLAW_AGENT_ID) and starts the webhook server
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');
const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

const KNOBASE_BASE_URL = 'https://app.knobase.com';
const DEVICE_TOKEN_URL = `${KNOBASE_BASE_URL}/api/oauth/device/token`;
const AGENT_CONNECT_URL = `${KNOBASE_BASE_URL}/api/v1/agents/connect`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { deviceCode: null, name: null, agent: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--device-code' && args[i + 1]) {
      flags.deviceCode = args[i + 1];
      i++;
    } else if (args[i] === '--name' && args[i + 1]) {
      flags.name = args[i + 1];
      i++;
    } else if (args[i] === '--agent' && args[i + 1]) {
      flags.agent = args[i + 1];
      i++;
    }
  }
  return flags;
}

function generateAgentId() {
  const uuid = crypto.randomUUID();
  return `knobase_agent_${uuid}`;
}

function selectWithArrowKeys(agents, defaultId) {
  return new Promise((resolve, reject) => {
    const defaultIndex = defaultId ? agents.findIndex(a => a.id === defaultId) : 0;
    let selected = defaultIndex >= 0 ? defaultIndex : 0;

    const idWidth = 20;
    const nameWidth = 30;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    readline.emitKeypressEvents(process.stdin, rl);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdout.write('\x1B[?25l');

    let rendered = false;

    function renderList() {
      if (rendered) {
        process.stdout.write(`\x1B[${agents.length}A`);
      }
      rendered = true;

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i];
        const isDefault = agent.id === defaultId;
        const pointer = i === selected ? chalk.cyan('▶ ') : '  ';
        const id = agent.id.slice(0, idWidth - 2).padEnd(idWidth);
        const name = (agent.name || 'Unnamed').slice(0, nameWidth - 2).padEnd(nameWidth);
        const model = formatModelName(agent.model);
        const badge = isDefault ? chalk.yellow(' (default)') : '';

        let line;
        if (i === selected) {
          line = pointer + chalk.bgBlue.white.bold(` ${id}${name}`) + ' ' + model + badge;
        } else {
          line = pointer + chalk.gray(id) + chalk.gray(name) + ' ' + model + badge;
        }

        process.stdout.write('\x1B[2K' + line + '\n');
      }
    }

    renderList();

    function onKeypress(_ch, key) {
      if (!key) return;

      if (key.name === 'up') {
        selected = (selected - 1 + agents.length) % agents.length;
        renderList();
      } else if (key.name === 'down') {
        selected = (selected + 1) % agents.length;
        renderList();
      } else if (key.name === 'return') {
        cleanup();
        resolve(agents[selected]);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        console.log(chalk.yellow('\n  Selection cancelled.'));
        process.exit(0);
      }
    }

    function cleanup() {
      process.stdout.write('\x1B[?25h');
      process.stdin.removeListener('keypress', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    }

    process.stdin.on('keypress', onKeypress);
  });
}

async function loadOpenClawConfig() {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatModelName(model) {
  if (!model) return chalk.gray('—');
  const parts = model.split('/');
  return chalk.white(parts[parts.length - 1]);
}

async function selectOpenClawAgent(flagAgentId) {
  const config = await loadOpenClawConfig();

  if (!config) {
    console.log(chalk.yellow('  No ~/.openclaw/openclaw.json found — skipping agent selection.\n'));
    return null;
  }

  const agents = config.agents?.list;
  if (!Array.isArray(agents) || agents.length === 0) {
    console.log(chalk.yellow('  No OpenClaw agents found in openclaw.json — skipping agent selection.\n'));
    return null;
  }

  const defaultId = agents.find(a => a.default)?.id ?? null;

  if (flagAgentId) {
    const match = agents.find(a => a.id === flagAgentId);
    if (!match) {
      console.error(chalk.red(`  Error: Agent "${flagAgentId}" not found in openclaw.json.\n`));
      console.log(chalk.gray('  Available agents: ' + agents.map(a => a.id).join(', ') + '\n'));
      process.exit(1);
    }
    console.log(chalk.white('  OpenClaw Agent: ') + chalk.cyan.bold(match.name || match.id) + '\n');
    return match;
  }

  if (agents.length === 1) {
    const only = agents[0];
    console.log(chalk.white('  OpenClaw Agent: ') + chalk.cyan.bold(only.name || only.id) + chalk.gray(' (only agent)') + '\n');
    return only;
  }

  console.log(chalk.white.bold('  Select which OpenClaw agent to connect to Knobase:\n'));
  console.log(chalk.gray('  Use ↑/↓ arrow keys to navigate, Enter to select\n'));

  const selected = await selectWithArrowKeys(agents, defaultId);
  console.log(chalk.green(`\n  ✓ Selected: ${selected.name || selected.id}\n`));
  return selected;
}

async function saveConfig(config) {
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await fs.writeFile(ENV_FILE, envContent, { mode: 0o600 });
  console.log(chalk.green('\n✓ Configuration saved to .env'));
}

async function exchangeCodeForToken(deviceCode) {
  const response = await fetch(DEVICE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token exchange failed (${response.status}): ${body}`);
  }

  return await response.json();
}

async function connectAgent(deviceCode) {
  const response = await fetch(AGENT_CONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to connect agent (${response.status}): ${body}`);
  }

  return await response.json();
}

function launchWebhook() {
  console.log('');
  const webhookPath = path.join(__dirname, 'webhook.js');
  const child = spawn(process.execPath, [webhookPath, 'start'], {
    stdio: ['inherit', 'inherit', 'pipe'],
    cwd: SKILL_DIR,
  });

  let stderrBuf = '';
  child.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });

  child.on('error', (err) => {
    console.error(chalk.red(`\n  Failed to start webhook server: ${err.message}`));
    console.log(chalk.gray('  You can start it manually with: openclaw knobase webhook start\n'));
  });

  child.on('exit', (code) => {
    if (code !== 0 && stderrBuf.includes('EADDRINUSE')) {
      console.log(chalk.green('  ✓ Webhook already running'));
    } else if (code !== 0) {
      process.stderr.write(stderrBuf);
      console.error(chalk.red(`\n  Webhook server exited with code ${code}`));
      console.log(chalk.gray('  You can start it manually with: openclaw knobase webhook start\n'));
    }
  });
}

async function main() {
  const flags = parseArgs(process.argv);

  console.log(chalk.blue.bold('\n⚡ Knobase Quick Connect\n'));

  if (!flags.deviceCode) {
    console.error(chalk.red('  Error: --device-code flag is required.\n'));
    console.log(chalk.white('  Usage:'));
    console.log(chalk.gray('    openclaw-knobase connect --device-code <device_code> [--name <agent_name>] [--agent <agent_id>]\n'));
    console.log(chalk.gray('  Get your device code from the Knobase app or run:'));
    console.log(chalk.gray('    openclaw knobase auth\n'));
    process.exit(1);
  }

  // Step 1: Select OpenClaw agent
  const openclawAgent = await selectOpenClawAgent(flags.agent);

  const deviceCode = flags.deviceCode;
  console.log(chalk.white('  Device Code: ') + chalk.yellow.bold(deviceCode) + '\n');

  // Step 2: Exchange device_code for token
  const tokenSpinner = ora('Exchanging device code for token...').start();
  let tokenData;
  try {
    tokenData = await exchangeCodeForToken(deviceCode);
    tokenSpinner.succeed('Token received');
  } catch (err) {
    tokenSpinner.fail('Token exchange failed');
    console.error(chalk.red(`\n  ${err.message}\n`));
    process.exit(1);
  }

  // Step 3: Connect agent to workspace
  const connectSpinner = ora('Connecting agent to workspace...').start();
  let agentData;
  try {
    agentData = await connectAgent(deviceCode);
    connectSpinner.succeed('Agent connected');
  } catch (err) {
    connectSpinner.fail('Failed to connect agent');
    console.error(chalk.red(`\n  ${err.message}\n`));
    process.exit(1);
  }

  // Step 4: Save config
  const { agent_id, api_key, workspace_id } = agentData;

  const agentName = flags.name || agentData.name || null;

  const config = {
    AGENT_ID: agent_id || generateAgentId(),
    ...(agentName && { AGENT_NAME: agentName }),
    KNOBASE_API_KEY: api_key,
    KNOBASE_WORKSPACE_ID: workspace_id,
    KNOBASE_API_ENDPOINT: KNOBASE_BASE_URL,
    AUTHENTICATED_AT: new Date().toISOString(),
  };

  if (openclawAgent) {
    config.OPENCLAW_AGENT_ID = openclawAgent.id;
    if (openclawAgent.workspace) {
      config.OPENCLAW_AGENT_WORKSPACE = openclawAgent.workspace;
    }
  }

  await saveConfig(config);

  // Step 5: Success message
  const successLabel = agentName
    ? `\n✅ ${agentName} connected successfully!\n`
    : '\n✅ Connected successfully!\n';
  console.log(chalk.green.bold(successLabel));
  if (agentName) {
    console.log(chalk.white('  Agent Name:  ') + chalk.cyan.bold(agentName));
  }
  console.log(chalk.white('  Agent ID:    ') + chalk.cyan(config.AGENT_ID));
  console.log(chalk.white('  Workspace:   ') + chalk.cyan(workspace_id));

  if (openclawAgent) {
    console.log('');
    console.log(chalk.white('  OpenClaw Agent:     ') + chalk.cyan.bold(openclawAgent.name || openclawAgent.id));
    console.log(chalk.white('  OpenClaw Agent ID:  ') + chalk.cyan(openclawAgent.id));
    if (openclawAgent.workspace) {
      console.log(chalk.white('  OpenClaw Workspace: ') + chalk.cyan(openclawAgent.workspace));
    }
  }

  console.log(chalk.white.bold('\n  Try ') + chalk.cyan.bold('@openclaw') + chalk.white.bold(' in your Knobase document!\n'));
  console.log(chalk.gray('  Example commands:'));
  console.log(chalk.gray('    @openclaw summarize this page'));
  console.log(chalk.gray('    @openclaw find action items'));
  console.log(chalk.gray('    @openclaw draft a reply\n'));

  // Step 6: Auto-start webhook server
  console.log(chalk.gray('  Starting webhook server...\n'));
  launchWebhook();
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
