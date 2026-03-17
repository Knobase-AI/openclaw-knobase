#!/usr/bin/env node

/**
 * Knobase Agent Connection — supports two workflows:
 *
 * Workflow 1 — CLI First (no --device-code):
 *   1. POST /api/oauth/device/code to generate a device_code + user_code
 *   2. Display user_code (XXXX-XXXX) and open browser
 *   3. Poll /api/oauth/device/token until authorized
 *   4. POST /api/v1/agents/connect
 *   5. Save config, sync files, launch webhook
 *
 * Workflow 2 — Knobase First (--device-code <uuid>):
 *   1. Use provided device_code directly
 *   2. Exchange for token, connect, save config, sync, launch webhook
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
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');
const OPENCLAW_CONFIG = path.join(os.homedir(), '.openclaw', 'openclaw.json');

const KNOBASE_BASE_URL = 'https://app.knobase.com';
const DEVICE_CODE_URL = `${KNOBASE_BASE_URL}/api/oauth/device/code`;
const DEVICE_TOKEN_URL = `${KNOBASE_BASE_URL}/api/oauth/device/token`;
const AGENT_CONNECT_URL = `${KNOBASE_BASE_URL}/api/v1/agents/connect`;

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function promptYesNo(question, defaultYes = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

function promptInput(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

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
  return `knobase_agent_${crypto.randomUUID()}`;
}

// ─── API calls ────────────────────────────────────────────────────────────────

async function requestDeviceCode() {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to generate device code (${response.status}): ${body}`);
  }

  return await response.json();
}

async function pollForToken(deviceCode) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await fetch(DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (response.ok) {
      return await response.json();
    }

    const body = await response.json().catch(() => ({}));
    const error = body.error;

    if (error === 'authorization_pending') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (error === 'slow_down') {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS * 2));
      continue;
    }

    if (error === 'expired_token') {
      throw new Error('Device code expired. Please run the command again.');
    }

    if (error === 'access_denied') {
      throw new Error('Authorization was denied by the user.');
    }

    throw new Error(`Token exchange failed (${response.status}): ${body.error_description || body.error || 'unknown error'}`);
  }

  throw new Error('Timed out waiting for authorization. Please try again.');
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

// ─── OpenClaw agent selection ─────────────────────────────────────────────────

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

function selectWithArrowKeys(agents, defaultId) {
  return new Promise((resolve) => {
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

// ─── File selection ───────────────────────────────────────────────────────────

function selectFilesWithCheckboxes(files) {
  return new Promise((resolve) => {
    const checked = files.map(() => true);
    let cursor = 0;

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    readline.emitKeypressEvents(process.stdin, rl);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdout.write('\x1B[?25l');

    const headerLines = 2;
    const footerLines = 2;
    let rendered = false;

    function render() {
      const totalLines = headerLines + files.length + footerLines;
      if (rendered) {
        process.stdout.write(`\x1B[${totalLines}A`);
      }
      rendered = true;

      process.stdout.write('\x1B[2K' + chalk.white.bold('  Select files to sync:\n'));
      process.stdout.write('\x1B[2K\n');

      for (let i = 0; i < files.length; i++) {
        const pointer = i === cursor ? chalk.cyan('▶ ') : '  ';
        const box = checked[i] ? chalk.green('[x]') : chalk.gray('[ ]');
        const label = i === cursor
          ? chalk.white.bold(` ${files[i]}`)
          : chalk.gray(` ${files[i]}`);
        process.stdout.write('\x1B[2K' + pointer + box + label + '\n');
      }

      process.stdout.write('\x1B[2K\n');
      process.stdout.write('\x1B[2K' + chalk.gray('  All files selected by default. Press Space to uncheck, Enter to confirm') + '\n');
    }

    render();

    function onKeypress(_ch, key) {
      if (!key) return;

      if (key.name === 'up') {
        cursor = (cursor - 1 + files.length) % files.length;
        render();
      } else if (key.name === 'down') {
        cursor = (cursor + 1) % files.length;
        render();
      } else if (key.name === 'space') {
        checked[cursor] = !checked[cursor];
        render();
      } else if (key.name === 'return') {
        cleanup();
        const selected = files.filter((_, i) => checked[i]);
        console.log(chalk.green(`\n  ✓ ${selected.length} file(s) selected\n`));
        resolve(selected);
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

// ─── Config persistence ──────────────────────────────────────────────────────

async function saveConfig(config) {
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await fs.writeFile(ENV_FILE, envContent, { mode: 0o600 });
  console.log(chalk.green('\n✓ Configuration saved to .env'));
}

// ─── Webhook launcher ─────────────────────────────────────────────────────────

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

// ─── Shared steps (agent selection, file sync prompt, connect, save, finish) ─

async function promptFileSync() {
  console.log(chalk.white.bold('  Sync agent personality files to cloud? ') + chalk.gray('[Y/n]\n'));
  console.log('  ' + chalk.green('Yes') + ': ☁️  Backup your agent config, ✏️  edit files online, 🔄 sync across devices');
  console.log('  ' + chalk.gray('No') + ':  Connect without files (you can sync later)\n');

  const wantsSync = await promptYesNo(chalk.white('  Sync files? ') + chalk.gray('[Y/n] '), true);

  if (!wantsSync) {
    console.log(chalk.gray('\n  Skipping file sync — you can run ') + chalk.cyan('openclaw-knobase sync') + chalk.gray(' later.\n'));
    return [];
  }

  const allFiles = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'AGENTS.md', 'TOOLS.md', 'MEMORY.md', 'HEARTBEAT.md'];
  const syncFiles = await selectFilesWithCheckboxes(allFiles);

  if (syncFiles.length === 0) {
    console.log(chalk.yellow('\n  No files selected — connecting without file sync.\n'));
  }

  return syncFiles;
}

async function connectAndFinish({ deviceCode, flags, openclawAgent, syncFiles }) {
  if (syncFiles.length > 0) {
    console.log(chalk.white('  Syncing:     ') + chalk.cyan(syncFiles.join(', ')) + '\n');
  }

  console.log(chalk.white('  Device Code: ') + chalk.yellow.bold(deviceCode) + '\n');

  // Connect agent to workspace
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

  // Save config
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

  // Success output
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

  // Auto-start webhook
  console.log(chalk.gray('  Starting webhook server...\n'));
  launchWebhook();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs(process.argv);

  console.log(chalk.blue.bold('\n⚡ Knobase Quick Connect\n'));

  // Select OpenClaw agent (shared by both workflows)
  const openclawAgent = await selectOpenClawAgent(flags.agent);

  // Prompt for file sync (shared by both workflows)
  const syncFiles = await promptFileSync();

  if (flags.deviceCode) {
    // ── Workflow 2: Knobase First (--device-code provided) ──────────────────
    console.log(chalk.gray('  Using provided device code.\n'));

    const tokenSpinner = ora('Exchanging device code for token...').start();
    try {
      await exchangeCodeForToken(flags.deviceCode);
      tokenSpinner.succeed('Token received');
    } catch (err) {
      tokenSpinner.fail('Token exchange failed');
      console.error(chalk.red(`\n  ${err.message}\n`));
      process.exit(1);
    }

    await connectAndFinish({
      deviceCode: flags.deviceCode,
      flags,
      openclawAgent,
      syncFiles,
    });
  } else {
    // ── Workflow 1: CLI First (generate device code) ────────────────────────
    const codeSpinner = ora('Requesting device code...').start();
    let deviceData;
    try {
      deviceData = await requestDeviceCode();
      codeSpinner.succeed('Device code generated');
    } catch (err) {
      codeSpinner.fail('Failed to generate device code');
      console.error(chalk.red(`\n  ${err.message}\n`));
      process.exit(1);
    }

    const { device_code, user_code, verification_uri } = deviceData;

    console.log('');
    console.log(chalk.white.bold('  Your code: ') + chalk.cyan.bold.underline(user_code));
    console.log('');
    console.log(chalk.gray('  Enter this code on the Knobase authorization page.'));
    console.log(chalk.gray('  Opening your browser now...\n'));

    const authUrl = verification_uri || `${KNOBASE_BASE_URL}/oauth/device?code=${user_code}`;

    try {
      await open(authUrl);
    } catch {
      console.log(chalk.yellow('  Could not open browser automatically.'));
      console.log(chalk.white('  Open this URL manually: ') + chalk.cyan.underline(authUrl) + '\n');
    }

    const pollSpinner = ora('Waiting for authorization...').start();
    let tokenData;
    try {
      tokenData = await pollForToken(device_code);
      pollSpinner.succeed('Authorization complete');
    } catch (err) {
      pollSpinner.fail('Authorization failed');
      console.error(chalk.red(`\n  ${err.message}\n`));
      process.exit(1);
    }

    await connectAndFinish({
      deviceCode: device_code,
      flags,
      openclawAgent,
      syncFiles,
    });
  }
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
