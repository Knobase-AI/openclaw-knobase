/**
 * Agent Auto-Configuration Module
 *
 * Provides self-service configuration for Knobase agents:
 * API key verification, webhook registration, profile updates,
 * and MCP connectivity testing.
 */

import fetch from 'node-fetch';

const DEFAULT_BASE_URL = 'https://api.knobase.ai';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Internal helper: fetch with an AbortController timeout.
 */
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Internal helper: make an authenticated JSON request and return parsed body.
 * Throws a descriptive error on non-OK responses.
 */
async function jsonRequest(url, apiKey, options = {}) {
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...options.headers,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.message || body?.error || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

/**
 * Verify an API key against the Knobase /api/agents/self endpoint.
 *
 * On success returns the agent identity:
 *   { agent_id, user_id, school_id, scopes, name, ... }
 *
 * @param {string} apiKey - Knobase API key to verify
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Override the default API base URL
 * @returns {Promise<object>} Agent identity payload
 */
export async function configureWithApiKey(apiKey, options = {}) {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/api/agents/self`;

  console.log('[AgentConfig] Verifying API key against', url);

  try {
    const data = await jsonRequest(url, apiKey);

    console.log('[AgentConfig] Verified — agent_id:', data.agent_id);
    console.log('[AgentConfig] school_id:', data.school_id);
    console.log('[AgentConfig] scopes:', data.scopes);

    return data;
  } catch (error) {
    if (error.status === 401) {
      throw new Error('Invalid API key — authentication failed');
    }
    if (error.status === 403) {
      throw new Error('API key does not have sufficient permissions');
    }
    throw new Error(`Failed to verify API key: ${error.message}`);
  }
}

/**
 * Register a webhook URL with Knobase so the agent receives mention events.
 *
 * @param {string} webhookUrl - The publicly-reachable URL Knobase should POST to
 * @param {string} apiKey     - Knobase API key for authentication
 * @param {object} [options]
 * @param {string}   [options.baseUrl]  - Override the default API base URL
 * @param {string[]} [options.events]   - Event types to subscribe to (default: ['agent.mentioned'])
 * @returns {Promise<object>} Registration result (webhook_id, secret, etc.)
 */
export async function registerWebhook(webhookUrl, apiKey, options = {}) {
  if (!webhookUrl) {
    throw new Error('Webhook URL is required');
  }
  if (!apiKey) {
    throw new Error('API key is required');
  }

  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const events = options.events || ['agent.mentioned'];
  const url = `${baseUrl}/api/webhooks/register`;

  console.log('[AgentConfig] Registering webhook at', webhookUrl);
  console.log('[AgentConfig] Events:', events.join(', '));

  try {
    const data = await jsonRequest(url, apiKey, {
      method: 'POST',
      body: JSON.stringify({ url: webhookUrl, events }),
    });

    console.log('[AgentConfig] Webhook registered — id:', data.webhook_id);

    return data;
  } catch (error) {
    if (error.status === 409) {
      throw new Error('A webhook is already registered for this URL. Unregister it first or use a different URL.');
    }
    throw new Error(`Failed to register webhook: ${error.message}`);
  }
}

/**
 * Update the agent's profile (name, description, avatar).
 *
 * @param {string} agentId   - The agent's ID (returned by configureWithApiKey)
 * @param {object} profile   - Fields to update
 * @param {string} [profile.name]        - Display name
 * @param {string} [profile.description] - Short description
 * @param {string} [profile.avatar]      - URL to avatar image
 * @param {string} apiKey    - Knobase API key for authentication
 * @param {object} [options]
 * @param {string} [options.baseUrl] - Override the default API base URL
 * @returns {Promise<object>} Updated agent profile
 */
export async function updateProfile(agentId, profile, apiKey, options = {}) {
  if (!agentId) {
    throw new Error('Agent ID is required');
  }
  if (!apiKey) {
    throw new Error('API key is required');
  }
  if (!profile || (!profile.name && !profile.description && !profile.avatar)) {
    throw new Error('At least one profile field (name, description, avatar) is required');
  }

  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const url = `${baseUrl}/api/agents/${agentId}`;

  const payload = {};
  if (profile.name !== undefined) payload.name = profile.name;
  if (profile.description !== undefined) payload.description = profile.description;
  if (profile.avatar !== undefined) payload.avatar = profile.avatar;

  console.log('[AgentConfig] Updating profile for agent', agentId);

  try {
    const data = await jsonRequest(url, apiKey, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    console.log('[AgentConfig] Profile updated successfully');

    return data;
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`Agent ${agentId} not found`);
    }
    throw new Error(`Failed to update profile: ${error.message}`);
  }
}

/**
 * Test that the MCP endpoint is accessible and responding.
 *
 * Sends a JSON-RPC 2.0 'ping' request to the endpoint and checks for a
 * valid response. Returns a status object rather than throwing on failure.
 *
 * @param {string} mcpEndpoint - The MCP endpoint URL to test
 * @param {string} [token]     - Optional bearer token for authenticated endpoints
 * @returns {Promise<{ok: boolean, latencyMs: number, error?: string}>}
 */
export async function testConnection(mcpEndpoint, token) {
  if (!mcpEndpoint) {
    return { ok: false, latencyMs: 0, error: 'MCP endpoint URL is required' };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: `ping-${Date.now()}`,
    method: 'ping',
    params: {},
  });

  console.log('[AgentConfig] Testing MCP connection to', mcpEndpoint);

  const start = Date.now();

  try {
    const response = await fetchWithTimeout(mcpEndpoint, {
      method: 'POST',
      headers,
      body,
    });

    const latencyMs = Date.now() - start;

    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        error: `MCP endpoint returned HTTP ${response.status}`,
      };
    }

    const result = await response.json().catch(() => null);

    if (result?.error) {
      return {
        ok: false,
        latencyMs,
        error: result.error.message || 'MCP endpoint returned an error',
      };
    }

    console.log(`[AgentConfig] MCP connection OK (${latencyMs}ms)`);

    return { ok: true, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - start;
    return {
      ok: false,
      latencyMs,
      error: error.message,
    };
  }
}

export default {
  configureWithApiKey,
  registerWebhook,
  updateProfile,
  testConnection,
};
