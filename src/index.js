/**
 * OpenClaw Knobase Integration - Main Module
 * 
 * Provides programmatic API for OpenClaw to interact with Knobase
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(SKILL_DIR, '.env');
const DEFAULT_API_ENDPOINT = 'https://api.knobase.ai';

class KnobaseClient {
  constructor() {
    this.config = null;
    this.baseUrl = 'https://api.knobase.ai';
  }

  async init() {
    await this.loadConfig();
    if (this.config?.KNOBASE_API_ENDPOINT) {
      this.baseUrl = this.config.KNOBASE_API_ENDPOINT;
    }
  }

  async loadConfig() {
    try {
      const content = await fs.readFile(ENV_FILE, 'utf8');
      this.config = {};
      content.split('\n').forEach(line => {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          this.config[key.trim()] = valueParts.join('=').trim();
        }
      });
      return this.config;
    } catch {
      this.config = null;
      return null;
    }
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.config?.KNOBASE_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Agent-ID': this.config?.AGENT_ID
    };
  }

  async request(endpoint, options = {}) {
    if (!this.config?.KNOBASE_API_KEY) {
      throw new Error('Not authenticated. Run: openclaw knobase auth');
    }

    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers
      }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Status
  async status() {
    await this.init();
    return {
      authenticated: !!this.config?.AGENT_ID,
      agentId: this.config?.AGENT_ID,
      workspaceId: this.config?.KNOBASE_WORKSPACE_ID,
      connected: !!this.config?.KNOBASE_WORKSPACE_ID
    };
  }

  // Get mentions
  async getMentions(options = {}) {
    await this.init();
    const { limit = 10, unreadOnly = false } = options;
    return this.request(`/v1/agents/${this.config.AGENT_ID}/mentions?limit=${limit}&unread=${unreadOnly}`);
  }

  // Mark mention as read
  async markMentionRead(mentionId) {
    await this.init();
    return this.request(`/v1/mentions/${mentionId}/read`, { method: 'POST' });
  }

  // Send message to Knobase
  async sendMessage({ channel, message, threadId = null }) {
    await this.init();
    return this.request('/v1/messages', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: this.config.KNOBASE_WORKSPACE_ID,
        channel,
        message,
        thread_id: threadId,
        agent_id: this.config.AGENT_ID
      })
    });
  }

  // Get workspace channels
  async getChannels() {
    await this.init();
    return this.request(`/v1/workspaces/${this.config.KNOBASE_WORKSPACE_ID}/channels`);
  }

  // Sync context with Knobase
  async syncContext(context) {
    await this.init();
    return this.request('/v1/context/sync', {
      method: 'POST',
      body: JSON.stringify({
        agent_id: this.config.AGENT_ID,
        workspace_id: this.config.KNOBASE_WORKSPACE_ID,
        context
      })
    });
  }

  // Query Knobase knowledge
  async query(query, options = {}) {
    await this.init();
    return this.request('/v1/query', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: this.config.KNOBASE_WORKSPACE_ID,
        query,
        agent_id: this.config.AGENT_ID,
        ...options
      })
    });
  }
}

// Singleton instance
let client = null;

export async function getClient() {
  if (!client) {
    client = new KnobaseClient();
    await client.init();
  }
  return client;
}

// Convenience exports
export async function status() {
  const c = await getClient();
  return c.status();
}

export async function getMentions(options) {
  const c = await getClient();
  return c.getMentions(options);
}

export async function sendMessage(params) {
  const c = await getClient();
  return c.sendMessage(params);
}

export async function query(q, options) {
  const c = await getClient();
  return c.query(q, options);
}

export async function syncContext(context) {
  const c = await getClient();
  return c.syncContext(context);
}

// ---------------------------------------------------------------------------
// Auto-configuration helpers
// ---------------------------------------------------------------------------

import {
  configureWithApiKey,
  registerWebhook as registerWebhookApi,
} from './agent-config.js';

/**
 * Read existing .env values so we can detect prior config state.
 */
async function readEnvFile() {
  try {
    const content = await fs.readFile(ENV_FILE, 'utf8');
    const env = {};
    for (const line of content.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    }
    return env;
  } catch {
    return {};
  }
}

/**
 * Persist config values to the project .env file (mode 0o600).
 * Merges with any existing values so unrelated keys are preserved.
 */
async function writeEnvFile(values) {
  const existing = await readEnvFile();
  const merged = { ...existing, ...values };
  const content = Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  await fs.writeFile(ENV_FILE, content + '\n', { mode: 0o600 });
}

/**
 * Interactive CLI command: auto-configure the Knobase integration.
 *
 * 1. Prompts for API key (or reads KNOBASE_API_KEY from env)
 * 2. Calls configureWithApiKey to verify and retrieve config
 * 3. Saves config to .env (KNOBASE_API_KEY, KNOBASE_WORKSPACE_ID, AGENT_USER_ID)
 * 4. Optionally registers a webhook if not already done
 * 5. Tests the connection and confirms success
 */
export async function runConfigure() {
  const chalk = (await import('chalk')).default;
  const inquirer = (await import('inquirer')).default;
  const ora = (await import('ora')).default;

  console.log(chalk.blue.bold('\n  Knobase Auto-Configuration\n'));

  // ---- 1. Prompt for API key (or read from env) --------------------------
  const envApiKey = process.env.KNOBASE_API_KEY || '';
  const existingEnv = await readEnvFile();
  const defaultKey = envApiKey || existingEnv.KNOBASE_API_KEY || '';

  const { apiKey } = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Knobase API Key:',
      mask: '*',
      default: defaultKey || undefined,
      validate: (v) => (v && v.length > 0) || 'API key is required',
    },
  ]);

  const { endpoint } = await inquirer.prompt([
    {
      type: 'input',
      name: 'endpoint',
      message: 'API endpoint:',
      default: existingEnv.KNOBASE_API_ENDPOINT || DEFAULT_API_ENDPOINT,
    },
  ]);

  // ---- 2. Verify key & get config via configureWithApiKey ----------------
  const verifySpinner = ora('Verifying API key...').start();
  let agentData;
  try {
    agentData = await configureWithApiKey(apiKey, { baseUrl: endpoint });
    verifySpinner.succeed(
      `Verified — agent ${chalk.cyan(agentData.agent_id)}`,
    );
  } catch (err) {
    verifySpinner.fail('API key verification failed');
    console.error(chalk.red(`  ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // ---- 3. Save to .env ---------------------------------------------------
  const agentUserId =
    agentData.user_id || existingEnv.AGENT_USER_ID || `agent_${crypto.randomUUID()}`;
  const workspaceId =
    agentData.school_id || existingEnv.KNOBASE_WORKSPACE_ID || '';

  const envValues = {
    KNOBASE_API_KEY: apiKey,
    KNOBASE_API_ENDPOINT: endpoint,
    KNOBASE_WORKSPACE_ID: workspaceId,
    AGENT_USER_ID: agentUserId,
    AGENT_ID: agentData.agent_id || existingEnv.AGENT_ID || '',
    CONFIGURED_AT: new Date().toISOString(),
  };

  const saveSpinner = ora('Saving configuration to .env...').start();
  try {
    await writeEnvFile(envValues);
    saveSpinner.succeed('Configuration saved to .env');
  } catch (err) {
    saveSpinner.fail('Failed to save .env');
    console.error(chalk.red(`  ${err.message}`));
    process.exitCode = 1;
    return;
  }

  // ---- 4. Optional webhook registration -----------------------------------
  const webhookAlreadyRegistered = !!existingEnv.KNOBASE_WEBHOOK_SECRET;

  if (webhookAlreadyRegistered) {
    console.log(chalk.gray('  Webhook already registered — skipping.'));
  } else {
    const { setupWebhook } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupWebhook',
        message: 'Register a webhook for real-time events?',
        default: true,
      },
    ]);

    if (setupWebhook) {
      const { webhookUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'webhookUrl',
          message: 'Public webhook URL:',
          default: 'https://example.com/webhook/knobase',
          validate: (v) =>
            v.startsWith('http://') || v.startsWith('https://')
              ? true
              : 'Must be a valid HTTP(S) URL',
        },
      ]);

      const whSpinner = ora('Registering webhook...').start();
      try {
        const whResult = await registerWebhookApi(webhookUrl, apiKey, {
          baseUrl: endpoint,
        });
        await writeEnvFile({
          KNOBASE_WEBHOOK_SECRET: whResult.secret,
          KNOBASE_WEBHOOK_ID: whResult.webhook_id,
          WEBHOOK_URL: webhookUrl,
        });
        whSpinner.succeed('Webhook registered');
      } catch (err) {
        whSpinner.fail('Webhook registration failed');
        console.error(chalk.yellow(`  ${err.message}`));
        console.log(chalk.gray('  You can register a webhook later via the Knobase dashboard.'));
      }
    }
  }

  // ---- 5. Test connection -------------------------------------------------
  const testSpinner = ora('Testing connection...').start();
  try {
    const testClient = new KnobaseClient();
    await testClient.init();
    const statusResult = await testClient.status();

    if (statusResult.connected) {
      testSpinner.succeed('Connection verified');
    } else {
      testSpinner.warn('Connection partially configured — workspace ID may be missing');
    }
  } catch (err) {
    testSpinner.fail('Connection test failed');
    console.error(chalk.yellow(`  ${err.message}`));
  }

  // ---- Done ---------------------------------------------------------------
  console.log(chalk.green.bold('\n  Configuration complete!\n'));
  console.log(chalk.white('  KNOBASE_API_KEY:      ') + chalk.gray(apiKey.slice(0, 8) + '...'));
  console.log(chalk.white('  KNOBASE_WORKSPACE_ID: ') + chalk.cyan(workspaceId));
  console.log(chalk.white('  AGENT_USER_ID:        ') + chalk.cyan(agentUserId));
  console.log();
  console.log(chalk.gray('  Next: start the webhook server with'));
  console.log(chalk.cyan('    openclaw knobase webhook start\n'));
}

// Re-export webhook handler components
export {
  handleWebhook,
  verifySignature,
  parseWebhookPayload,
  handleAgentMentioned,
  createWebhookHandler,
  mountWebhookHandler
} from './webhook-handler.js';

// Re-export MCP client components
export {
  callMCPTool,
  readDocument,
  writeDocument,
  insertAfterBlock,
  replaceBlock,
  appendToDocument,
  MCPError
} from './mcp-client.js';

// Re-export agent trigger components
export {
  triggerOpenClawAgent,
  buildAgentPrompt,
  formatAgentResponse,
  extractInstruction
} from './agent-trigger.js';

// Re-export agent config components
export {
  configureWithApiKey,
  registerWebhook,
  updateProfile,
  testConnection
} from './agent-config.js';

export default KnobaseClient;
