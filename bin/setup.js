#!/usr/bin/env node

/**
 * Knobase One-Command Setup
 * 
 * Combines authentication + webhook start into a single flow.
 * 
 * Usage: openclaw knobase setup
 *        openclaw knobase setup --auto
 *        openclaw knobase setup --doc <document-url>
 *        openclaw knobase setup --auto --doc <document-url>
 * 
 * Flags:
 *   --auto   Skip prompts and auto-start the webhook server
 *   --doc    Show document context in the success message
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
const { createInterface } = readline;
import { spawn } from 'child_process';
import crypto from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import fetch from 'node-fetch';
import open from 'open';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const KNOBASE_BASE_URL = 'https://app.knobase.com';
const DEVICE_CODE_URL = `${KNOBASE_BASE_URL}/api/oauth/device/code`;
const DEVICE_TOKEN_URL = `${KNOBASE_BASE_URL}/api/oauth/device/token`;
const AGENT_CONNECT_URL = `${KNOBASE_BASE_URL}/api/v1/agents/connect`;
const POLL_INTERVAL_MS = 5000;

// ── Arg parsing ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = { auto: false, doc: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--auto') {
      flags.auto = true;
    } else if (args[i] === '--doc' && args[i + 1]) {
      flags.doc = args[i + 1];
      i++;
    }
  }
  return flags;
}

// ── Config helpers (same pattern as auth.js) ─────────────────

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

function generateAgentId() {
  const uuid = crypto.randomUUID();
  return `knobase_agent_${uuid}`;
}

async function saveConfig(config) {
  const envContent = Object.entries(config)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  await fs.writeFile(ENV_FILE, envContent, { mode: 0o600 });
  console.log(chalk.green('\n✓ Configuration saved to .env'));
}

// ── Device-code auth (reused from auth.js) ───────────────────

async function requestDeviceCode() {
  const response = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: 'openclaw-knobase-skill' }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to request device code (${response.status}): ${body}`);
  }

  return await response.json();
}

async function pollForToken(deviceCode, expiresIn) {
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

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
      continue;
    } else if (error === 'slow_down') {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    } else if (error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    } else if (error === 'access_denied') {
      throw new Error('Authorization request was denied.');
    } else {
      throw new Error(`Token request failed: ${error || response.statusText}`);
    }
  }

  throw new Error('Device code expired. Please try again.');
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

// ── Auth check ───────────────────────────────────────────────

async function isAuthenticated() {
  const config = await loadConfig();
  return config && config.KNOBASE_API_KEY && config.AGENT_ID;
}

// ── Device flow (mirrors auth.js authenticateWithDeviceFlow) ─

async function runDeviceCodeAuth() {
  console.log(chalk.blue.bold('\n🔌 Knobase Authentication\n'));
  console.log(chalk.gray('Using OAuth 2.0 Device Code Flow\n'));

  const codeSpinner = ora('Requesting device code...').start();
  let deviceData;
  try {
    deviceData = await requestDeviceCode();
    codeSpinner.succeed('Device code received');
  } catch (err) {
    codeSpinner.fail('Failed to request device code');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  const { device_code, user_code, verification_uri, expires_in } = deviceData;
  const verificationUrl = `${KNOBASE_BASE_URL}/oauth/device?code=${user_code}`;

  console.log('');
  console.log(chalk.white.bold('  Your code:'));
  console.log(chalk.yellow.bold(`  ${user_code}\n`));
  console.log(chalk.gray(`  Code expires in ${Math.floor(expires_in / 60)} minutes.\n`));

  console.log(chalk.white('  Opening browser to authorize...'));
  try {
    await open(verificationUrl);
    console.log(chalk.green(`  ✓ Opened ${verificationUrl}\n`));
  } catch {
    console.log(chalk.gray(`  Could not open browser automatically.`));
    console.log(chalk.white.bold('  Open this URL manually:'));
    console.log(chalk.cyan.bold(`  ${verificationUrl}\n`));
  }

  const tokenSpinner = ora('Waiting for authorization...').start();
  let tokenData;
  try {
    tokenData = await pollForToken(device_code, expires_in);
    tokenSpinner.succeed('Authorization granted');
  } catch (err) {
    tokenSpinner.fail('Authorization failed');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  const connectSpinner = ora('Connecting agent to workspace...').start();
  let agentData;
  try {
    agentData = await connectAgent(device_code);
    connectSpinner.succeed('Agent connected');
  } catch (err) {
    connectSpinner.fail('Failed to connect agent');
    console.error(chalk.red(err.message));
    process.exit(1);
  }

  const { agent_id, api_key, workspace_id } = agentData;

  const config = {
    AGENT_ID: agent_id || generateAgentId(),
    KNOBASE_API_KEY: api_key,
    KNOBASE_WORKSPACE_ID: workspace_id,
    KNOBASE_API_ENDPOINT: KNOBASE_BASE_URL,
    AUTHENTICATED_AT: new Date().toISOString(),
  };

  await saveConfig(config);

  return config;
}

// ── Brain mode selector (arrow keys) ─────────────────────────

function selectBrainMode() {
  const options = [
    { label: 'Knobase cloud', value: 'cloud', desc: 'Sync knowledge to cloud — access from any device' },
    { label: 'Local only',    value: 'local', desc: 'Keep everything on this machine' },
  ];

  return new Promise((resolve) => {
    let selected = 0;

    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    readline.emitKeypressEvents(process.stdin, rl);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdout.write('\x1B[?25l');

    let rendered = false;

    function render() {
      if (rendered) {
        process.stdout.write(`\x1B[${options.length}A`);
      }
      rendered = true;

      for (let i = 0; i < options.length; i++) {
        const pointer = i === selected ? chalk.cyan('▶ ') : '  ';
        const label = i === selected
          ? chalk.white.bold(options[i].label) + chalk.gray('  ' + options[i].desc)
          : chalk.gray(options[i].label + '  ' + options[i].desc);
        process.stdout.write('\x1B[2K' + pointer + label + '\n');
      }
    }

    render();

    function onKeypress(_ch, key) {
      if (!key) return;

      if (key.name === 'up') {
        selected = (selected - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down') {
        selected = (selected + 1) % options.length;
        render();
      } else if (key.name === 'return') {
        cleanup();
        resolve(options[selected].value);
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

async function promptBrainMode(auto) {
  if (auto) {
    return 'cloud';
  }

  console.log(chalk.white.bold('\n  How should your code editor connect to Knobase?\n'));
  console.log(chalk.gray('  Use ↑↓ to select, Enter to confirm\n'));

  const mode = await selectBrainMode();
  console.log(chalk.green(`\n  ✓ ${mode === 'cloud' ? 'Knobase cloud' : 'Local only'}\n`));
  return mode;
}

// ── Webhook launcher ─────────────────────────────────────────

function launchWebhook() {
  const webhookPath = path.join(__dirname, 'webhook.js');
  const child = spawn(process.execPath, [webhookPath, 'start'], {
    stdio: 'inherit',
    cwd: SKILL_DIR,
  });
  child.on('error', (err) => {
    console.error(chalk.red(`\n  Failed to start webhook server: ${err.message}`));
    console.log(chalk.gray('  You can start it manually with: openclaw knobase webhook start\n'));
  });
}

// ── Daemon launcher ──────────────────────────────────────────

function launchDaemon() {
  const daemonPath = path.join(__dirname, 'daemon.js');
  const child = spawn(process.execPath, [daemonPath, 'start'], {
    stdio: 'inherit',
    cwd: SKILL_DIR,
  });
  child.on('error', (err) => {
    console.error(chalk.red(`\n  Failed to start daemon: ${err.message}`));
    console.log(chalk.gray('  You can start it manually with: openclaw knobase daemon start\n'));
  });
}

// ── Start services (both daemon + webhook) ───────────────────

async function startServices(auto) {
  if (auto) {
    console.log(chalk.gray('\n  --auto flag detected, starting services...\n'));
    launchDaemon();
    launchWebhook();
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(chalk.white.bold('  Start daemon + webhook now? [Y/n] '), resolve);
  });
  rl.close();

  const shouldStart = !answer || answer.trim().toLowerCase() !== 'n';
  if (shouldStart) {
    console.log('');
    launchDaemon();
    launchWebhook();
  } else {
    console.log(chalk.gray('\n  You can start them later with:'));
    console.log(chalk.gray('    openclaw knobase daemon start'));
    console.log(chalk.gray('    openclaw knobase webhook start\n'));
  }
}

// ── Success banner ───────────────────────────────────────────

function showSuccess(config, docUrl) {
  console.log(chalk.green.bold('\n✅ Setup complete!\n'));
  console.log(chalk.white('  Agent ID:    ') + chalk.cyan(config.AGENT_ID));
  if (config.KNOBASE_WORKSPACE_ID) {
    console.log(chalk.white('  Workspace:   ') + chalk.cyan(config.KNOBASE_WORKSPACE_ID));
  }

  if (docUrl) {
    console.log('');
    console.log(chalk.white.bold('  Document context:'));
    console.log(chalk.cyan(`  ${docUrl}`));
    console.log(chalk.gray('  The agent will respond to @mentions in this document.'));
  }

  console.log(chalk.white.bold('\n  Try ') + chalk.cyan.bold('@openclaw') + chalk.white.bold(' in your Knobase document!\n'));
  console.log(chalk.gray('  Example commands:'));
  console.log(chalk.gray('    @openclaw summarize this page'));
  console.log(chalk.gray('    @openclaw find action items'));
  console.log(chalk.gray('    @openclaw draft a reply\n'));
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const flags = parseArgs(process.argv);

  console.log(chalk.blue.bold('\n🚀 Knobase Setup\n'));
  console.log(chalk.gray('One-command auth + webhook setup\n'));

  // Step 1: Check existing auth
  const checkSpinner = ora('Checking authentication status...').start();
  const alreadyAuthed = await isAuthenticated();
  let config;

  if (alreadyAuthed) {
    checkSpinner.succeed('Already authenticated');
    config = await loadConfig();
    console.log(chalk.white('  Agent ID:  ') + chalk.cyan(config.AGENT_ID));
    if (config.KNOBASE_WORKSPACE_ID) {
      console.log(chalk.white('  Workspace: ') + chalk.cyan(config.KNOBASE_WORKSPACE_ID));
    }
  } else {
    checkSpinner.info('Not authenticated — starting device code flow');
    config = await runDeviceCodeAuth();
  }

  // Step 2: Brain mode selection
  const brainMode = await promptBrainMode(flags.auto);

  // Step 3: Show success
  showSuccess(config, flags.doc);

  // Step 4: Start both daemon + webhook
  await startServices(flags.auto);

  // Step 5: Configure heartbeat
  await configureHeartbeat();
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});

// ── Heartbeat Auto-Configuration ─────────────────────────────

async function configureHeartbeat() {
  const os = await import('os');
  const fs = await import('fs/promises');
  
  const heartbeatPath = path.join(os.homedir(), '.openclaw', 'workspace', 'HEARTBEAT.md');
  const heartbeatCmd = `node ${SKILL_DIR}/bin/heartbeat-check.js`;
  
  try {
    let content = '';
    try {
      content = await fs.readFile(heartbeatPath, 'utf8');
    } catch {
      // File doesn't exist, will create
    }
    
    // Check if already configured
    if (content.includes('heartbeat-check.js')) {
      console.log(chalk.gray('  ✓ Heartbeat already configured'));
      return;
    }
    
    // Add the heartbeat check
    const newContent = content.trimEnd() + '\n\n## Knobase Webhook Auto-Restart\n- Check and restart webhook if needed: `' + heartbeatCmd + '`\n';
    
    await fs.writeFile(heartbeatPath, newContent, 'utf8');
    console.log(chalk.green('  ✓ Configured heartbeat for webhook auto-restart'));
  } catch (err) {
    console.log(chalk.yellow('  ⚠ Could not configure heartbeat: ' + err.message));
  }
}

async function promptBrainMode() {
  console.log(chalk.blue.bold('\n☁️  Where should your agent\'s brain live?\n'));
  console.log(chalk.gray('Use ↑↓ to select, Enter to confirm\n'));

  const options = [
    { 
      key: 'brain', 
      label: '🧠 Knobase Cloud (Recommended)',
      description: 'Edit in browser. Auto-sync. Never lose work. Access anywhere.'
    },
    { 
      key: 'local', 
      label: '📁 This computer only',
      description: 'Edit with code editor. Manual sync.'
    }
  ];

  let selectedIndex = 0;

  // Simple arrow key selection
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const render = () => {
    console.clear();
    console.log(chalk.blue.bold('\n☁️  Where should your agent\'s brain live?\n'));
    console.log(chalk.gray('Use ↑↓ to select, Enter to confirm\n'));
    
    options.forEach((opt, i) => {
      if (i === selectedIndex) {
        console.log(chalk.cyan.bold(`▶ ${opt.label}`));
        console.log(chalk.cyan(`  ${opt.description}`));
      } else {
        console.log(chalk.gray(`  ${opt.label}`));
        console.log(chalk.gray(`  ${opt.description}`));
      }
      console.log();
    });
  };

  render();

  return new Promise((resolve) => {
    process.stdin.on('keypress', (str, key) => {
      if (key.name === 'up' && selectedIndex > 0) {
        selectedIndex--;
        render();
      } else if (key.name === 'down' && selectedIndex < options.length - 1) {
        selectedIndex++;
        render();
      } else if (key.name === 'return') {
        process.stdin.removeAllListeners('keypress');
        rl.close();
        
        const choice = options[selectedIndex].key;
        
        if (choice === 'brain') {
          console.log(chalk.green('\n🚀 Enabling Knobase Brain Mode...'));
          resolve('brain');
        } else {
          console.log(chalk.yellow('\nℹ️  Local mode selected.'));
          resolve('local');
        }
      }
    });
  });
}
