/**
 * Webhook Handler for Knobase Integration
 * 
 * Handles incoming webhooks from Knobase, specifically the 'agent.mentioned' event
 */

import crypto from 'crypto';
import { triggerOpenClawAgent, extractInstruction } from './agent-trigger.js';

/**
 * Verify HMAC-SHA256 signature from Knobase
 * 
 * @param {string|object} payload - The webhook payload
 * @param {string} signature - The X-Knobase-Signature header value
 * @param {string} secret - The webhook secret
 * @returns {boolean} - Whether the signature is valid
 */
export function verifySignature(payload, signature, secret) {
  if (!signature || !secret) {
    console.warn('[Webhook] Missing signature or secret, skipping verification');
    return true; // Allow if no secret configured
  }

  // Convert payload to string if needed
  const payloadString = typeof payload === 'string' 
    ? payload 
    : JSON.stringify(payload);

  // Calculate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payloadString, 'utf8')
    .digest('hex');

  try {
    // Use timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch (error) {
    console.error('[Webhook] Signature comparison error:', error.message);
    return false;
  }
}

/**
 * Parse and validate the webhook payload
 * 
 * @param {object} payload - The webhook payload
 * @returns {object} - Parsed and validated event data
 */
export function parseWebhookPayload(payload) {
  const { event, data } = payload;

  if (!event) {
    throw new Error('Missing event type in webhook payload');
  }

  if (!data) {
    throw new Error('Missing data in webhook payload');
  }

  return { event, data };
}

/**
 * Handle the 'agent.mentioned' event
 * 
 * @param {object} data - Event data from Knobase
 * @returns {Promise<object>} - Result of processing
 */
export async function handleAgentMentioned(data) {
  const {
    mention,
    author,
    mcp
  } = data;

  if (!mention) {
    throw new Error('Missing mention data in agent.mentioned event');
  }

  const {
    id: mentionId,
    document_id: documentId,
    block_id: blockId,
    text: mentionText,
    context_before: contextBefore,
    context_after: contextAfter
  } = mention;

  const {
    id: authorId,
    name: authorName
  } = author || {};

  const {
    endpoint: mcpEndpoint,
    token: mcpToken
  } = mcp || {};

  console.log('[Webhook] Processing agent.mentioned event');
  console.log('[Webhook] Mention ID:', mentionId);
  console.log('[Webhook] Document:', documentId);
  console.log('[Webhook] Block:', blockId);
  console.log('[Webhook] Text:', mentionText);
  console.log('[Webhook] Author:', authorName);

  // Extract instruction from mention text
  const instruction = extractInstruction(mentionText);

  // Build context for agent
  const context = {
    mentionId,
    documentId,
    blockId,
    mcpEndpoint,
    mcpToken,
    authorId,
    authorName,
    mentionText,
    contextBefore,
    contextAfter
  };

  // Trigger the OpenClaw agent
  const result = await triggerOpenClawAgent(instruction, context);

  return {
    success: true,
    mentionId,
    instruction,
    agentTriggered: true,
    timestamp: new Date().toISOString()
  };
}

/**
 * Create the Express webhook handler
 * 
 * @param {object} options - Configuration options
 * @param {string} options.webhookSecret - Secret for HMAC verification
 * @returns {Function} - Express middleware function
 */
export function createWebhookHandler(options = {}) {
  const { webhookSecret } = options;

  return async function webhookHandler(req, res, next) {
    const startTime = Date.now();

    try {
      // Log incoming webhook
      console.log('[Webhook] Received request');
      console.log('[Webhook] Headers:', JSON.stringify(req.headers, null, 2));
      console.log('[Webhook] Body:', JSON.stringify(req.body, null, 2));

      // Get signature from header
      const signature = req.headers['x-knobase-signature'];

      // Verify signature
      if (!verifySignature(req.body, signature, webhookSecret)) {
        console.error('[Webhook] Invalid signature');
        return res.status(401).json({
          error: 'Invalid signature',
          code: 'UNAUTHORIZED'
        });
      }

      // Parse payload
      const { event, data } = parseWebhookPayload(req.body);

      console.log('[Webhook] Event type:', event);

      // Handle different event types
      let result;
      switch (event) {
        case 'agent.mentioned':
          result = await handleAgentMentioned(data);
          break;

        case 'notification':
          console.log('[Webhook] Notification event (not implemented)');
          result = { success: true, message: 'Notification received' };
          break;

        case 'ping':
          console.log('[Webhook] Ping received');
          result = { success: true, pong: true };
          break;

        default:
          console.log(`[Webhook] Unknown event type: ${event}`);
          result = { success: true, message: `Event ${event} acknowledged` };
      }

      const processingTime = Date.now() - startTime;
      console.log(`[Webhook] Processed in ${processingTime}ms`);

      // Return 200 OK immediately - processing is async
      res.status(200).json({
        success: true,
        event,
        processingTime,
        ...result
      });

    } catch (error) {
      console.error('[Webhook] Error processing webhook:', error);
      console.error('[Webhook] Stack:', error.stack);

      // Still return 200 to avoid retries for expected errors
      // (Webhook has been received, even if processing failed)
      res.status(200).json({
        success: false,
        error: error.message,
        code: 'PROCESSING_ERROR'
      });
    }
  };
}

/**
 * Standalone webhook handler that processes a raw request.
 * Can be used outside of Express (e.g. in serverless functions or tests).
 *
 * @param {object} params
 * @param {object} params.body - Parsed JSON body of the webhook request
 * @param {string} [params.signature] - Value of the X-Knobase-Signature header
 * @param {string} [params.webhookSecret] - Secret used for HMAC verification
 * @returns {Promise<{statusCode: number, body: object}>}
 */
export async function handleWebhook({ body, signature, webhookSecret }) {
  const startTime = Date.now();

  try {
    if (!verifySignature(body, signature, webhookSecret)) {
      return {
        statusCode: 401,
        body: { error: 'Invalid signature', code: 'UNAUTHORIZED' }
      };
    }

    const { event, data } = parseWebhookPayload(body);

    let result;
    switch (event) {
      case 'agent.mentioned':
        result = await handleAgentMentioned(data);
        break;

      case 'notification':
        result = { success: true, message: 'Notification received' };
        break;

      case 'ping':
        result = { success: true, pong: true };
        break;

      default:
        result = { success: true, message: `Event ${event} acknowledged` };
    }

    const processingTime = Date.now() - startTime;

    return {
      statusCode: 200,
      body: { success: true, event, processingTime, ...result }
    };
  } catch (error) {
    console.error('[Webhook] Error processing webhook:', error);

    return {
      statusCode: 200,
      body: { success: false, error: error.message, code: 'PROCESSING_ERROR' }
    };
  }
}

/**
 * Mount the webhook handler on an Express app
 * 
 * @param {object} app - Express app instance
 * @param {string} path - Path to mount the webhook (default: '/webhook/knobase')
 * @param {object} options - Configuration options
 */
export function mountWebhookHandler(app, path = '/webhook/knobase', options = {}) {
  const handler = createWebhookHandler(options);
  
  app.post(path, handler);
  
  console.log(`[Webhook] Handler mounted at POST ${path}`);
}

export default {
  handleWebhook,
  verifySignature,
  parseWebhookPayload,
  handleAgentMentioned,
  createWebhookHandler,
  mountWebhookHandler
};
