#!/usr/bin/env node

/**
 * Knobase Authentication Script
 * 
 * Usage: openclaw knobase auth
 *        openclaw knobase auth --api-key <key>
 * 
 * Implements OAuth 2.0 Device Code Flow:
 * 1. Requests device + user codes from Knobase
 * 2. Displays user_code and verification URL
 * 3. Polls for token grant
 * 4. Connects agent and saves credentials
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');

const KNOBASE_BASE_URL = 'https://app.knobase.com';
const DEVICE_CODE_URL = `${KNOBASE_BASE_URL}/api/oauth/device/code`;
const DEVICE_TOKEN_URL = `${KNOBASE_BASE_URL}/api/oauth/device/token`;
const AGENT_CONNECT_URL = `${KNOBASE_BASE_URL}/api/v1/agents/connect`;
const POLL_INTERVAL_MS = 5000;

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

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--api-key' && args[i + 1]) {
      flags.apiKey = args[i + 1];
      i++;
    }
  }
  return flags;
}

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

async function authenticateWithDeviceFlow() {
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
  const verificationUrl = verification_uri || `${KNOBASE_BASE_URL}/activate`;

  console.log('');
  console.log(chalk.white.bold('  Open this URL in your browser:'));
  console.log(chalk.cyan.bold(`  ${verificationUrl}\n`));
  console.log(chalk.white.bold('  Enter this code:'));
  console.log(chalk.yellow.bold(`  ${user_code}\n`));
  console.log(chalk.gray(`  Code expires in ${Math.floor(expires_in / 60)} minutes.\n`));

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

  console.log(chalk.green.bold('\n✅ Authentication successful!\n'));
  console.log(chalk.white('  Agent ID:    ') + chalk.cyan(config.AGENT_ID));
  console.log(chalk.white('  Workspace:   ') + chalk.cyan(workspace_id));
  console.log(chalk.gray('\n  Run `openclaw knobase status` to verify your connection.\n'));
}

async function authenticateWithApiKey(apiKey) {
  console.log(chalk.blue.bold('\n🔌 Knobase Authentication\n'));
  console.log(chalk.gray('Using API key fallback\n'));

  const agentId = generateAgentId();
  const config = {
    AGENT_ID: agentId,
    KNOBASE_API_KEY: apiKey,
    KNOBASE_API_ENDPOINT: KNOBASE_BASE_URL,
    AUTHENTICATED_AT: new Date().toISOString(),
  };

  await saveConfig(config);

  console.log(chalk.green.bold('\n✅ API key saved!\n'));
  console.log(chalk.white('  Agent ID: ') + chalk.cyan(agentId));
  console.log(chalk.gray('\n  Run `openclaw knobase status` to verify your connection.\n'));
}

async function main() {
  const flags = parseArgs(process.argv);

  if (flags.apiKey) {
    await authenticateWithApiKey(flags.apiKey);
  } else {
    await authenticateWithDeviceFlow();
  }
}

main().catch((err) => {
  console.error(chalk.red(err.message));
  process.exit(1);
});
