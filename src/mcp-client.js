/**
 * MCP Client for Knobase Integration
 *
 * Implements JSON-RPC 2.0 client for calling MCP tools on Knobase.
 * Handles authentication, retries on transient failures, and request timeouts.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Custom error class for MCP errors.
 * Carries an HTTP or JSON-RPC error code and an optional root cause.
 */
export class MCPError extends Error {
  constructor(message, code, cause = null) {
    super(message);
    this.name = 'MCPError';
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Call an MCP tool on the Knobase server using JSON-RPC 2.0.
 *
 * @param {string} endpoint - The MCP endpoint URL (e.g., https://app.knobase.com/api/mcp)
 * @param {string} token    - Short-lived authentication token
 * @param {string} toolName - Name of the tool to call (e.g., 'read_document', 'write_document')
 * @param {object} args     - Arguments to pass to the tool
 * @returns {Promise<object>} Tool result payload
 */
export async function callMCPTool(endpoint, token, toolName, args = {}) {
  if (!endpoint) throw new MCPError('MCP endpoint is required', 0);
  if (!token) throw new MCPError('MCP token is required', 0);
  if (!toolName) throw new MCPError('MCP tool name is required', 0);

  const requestId = generateRequestId();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: requestId,
    method: toolName,
    params: args,
  });

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.log(`[MCP] Retrying ${toolName} (attempt ${attempt + 1}) after ${delay}ms`);
      await sleep(delay);
    }

    try {
      const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
      }, DEFAULT_TIMEOUT_MS);

      handleHttpStatus(response);

      const result = await response.json();

      if (result.error) {
        throw new MCPError(
          result.error.message || 'Unknown MCP error',
          result.error.code || -1,
        );
      }

      console.log(`[MCP] ${toolName} succeeded (request ${requestId})`);
      return result.result;
    } catch (error) {
      lastError = error;

      if (error instanceof MCPError && isRetryable(error.code)) {
        continue;
      }

      throw error instanceof MCPError
        ? error
        : new MCPError(`Network error: ${error.message}`, 0, error);
    }
  }

  throw lastError;
}

/**
 * Read a document from Knobase.
 *
 * @param {string} endpoint   - MCP endpoint URL
 * @param {string} token      - Authentication token
 * @param {string} documentId - Document ID to read
 * @param {object} [options]  - Additional options (block_id, include_context)
 * @returns {Promise<object>} Document content
 */
export async function readDocument(endpoint, token, documentId, options = {}) {
  if (!documentId) throw new MCPError('Document ID is required', 0);

  const args = { document_id: documentId };
  if (options.block_id) args.block_id = options.block_id;
  if (options.include_context) args.include_context = options.include_context;

  return callMCPTool(endpoint, token, 'read_document', args);
}

/**
 * Write to a document in Knobase.
 *
 * @param {string}       endpoint   - MCP endpoint URL
 * @param {string}       token      - Authentication token
 * @param {string}       documentId - Document ID to write to
 * @param {object|array} operations - Operation or array of operations to perform
 * @returns {Promise<object>} Write result
 */
export async function writeDocument(endpoint, token, documentId, operations) {
  if (!documentId) throw new MCPError('Document ID is required', 0);
  if (!operations) throw new MCPError('At least one operation is required', 0);

  const args = {
    document_id: documentId,
    operations: Array.isArray(operations) ? operations : [operations],
  };

  return callMCPTool(endpoint, token, 'write_document', args);
}

/**
 * Insert content after a specific block.
 */
export async function insertAfterBlock(endpoint, token, documentId, blockId, content) {
  return writeDocument(endpoint, token, documentId, [{
    type: 'insert_after_block',
    block_id: blockId,
    content,
  }]);
}

/**
 * Replace a block's content.
 */
export async function replaceBlock(endpoint, token, documentId, blockId, content) {
  return writeDocument(endpoint, token, documentId, [{
    type: 'replace_block',
    block_id: blockId,
    content,
  }]);
}

/**
 * Append content to the end of a document.
 */
export async function appendToDocument(endpoint, token, documentId, content) {
  return writeDocument(endpoint, token, documentId, [{
    type: 'append',
    content,
  }]);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function generateRequestId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch() wrapper that aborts after `timeoutMs` milliseconds.
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new MCPError(`Request timed out after ${timeoutMs}ms`, 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Translate non-OK HTTP responses into descriptive MCPError instances.
 */
function handleHttpStatus(response) {
  if (response.ok) return;

  switch (response.status) {
    case 401:
      throw new MCPError(
        'Authentication failed — token is expired or invalid. Re-authenticate and retry.',
        401,
      );
    case 403:
      throw new MCPError(
        'Forbidden — token does not have permission for this resource.',
        403,
      );
    case 404:
      throw new MCPError(
        'Resource not found — verify the document ID and endpoint URL.',
        404,
      );
    case 429:
      throw new MCPError('Rate limited — too many requests. Back off and retry.', 429);
    default:
      if (response.status >= 500) {
        throw new MCPError(`Server error (HTTP ${response.status})`, response.status);
      }
      throw new MCPError(`Unexpected HTTP ${response.status}`, response.status);
  }
}

/** 500-level and 429 (rate-limit) errors are worth retrying. */
function isRetryable(code) {
  return code >= 500 || code === 429;
}

export default {
  callMCPTool,
  readDocument,
  writeDocument,
  insertAfterBlock,
  replaceBlock,
  appendToDocument,
  MCPError,
};
