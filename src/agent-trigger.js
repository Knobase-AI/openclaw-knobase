/**
 * Agent Trigger for OpenClaw Integration
 * 
 * This module provides the function to trigger OpenClaw agent processing
 * when a mention is received from Knobase.
 */

/**
 * Trigger the OpenClaw agent to process a mention
 * 
 * @param {string} prompt - The prompt/instruction from the mention
 * @param {object} context - Context about the mention
 * @param {string} context.mentionId - Unique mention ID
 * @param {string} context.documentId - Document ID where mention occurred
 * @param {string} context.blockId - Block ID where mention occurred
 * @param {string} context.mcpEndpoint - MCP endpoint URL
 * @param {string} context.mcpToken - MCP authentication token
 * @param {string} context.authorId - ID of the user who mentioned
 * @param {string} context.authorName - Name of the user who mentioned
 * @param {string} context.mentionText - Full text of the mention
 * @param {string} context.contextBefore - Text before the mention
 * @param {string} context.contextAfter - Text after the mention
 * @returns {Promise<object>} - Result indicating processing started
 */
export async function triggerOpenClawAgent(prompt, context) {
  const {
    mentionId,
    documentId,
    blockId,
    mcpEndpoint,
    mcpToken,
    authorId,
    authorName,
    mentionText,
    contextBefore = '',
    contextAfter = ''
  } = context;

  // Build the full prompt for the agent
  const fullPrompt = buildAgentPrompt(prompt, context);

  console.log('[Agent] Triggering OpenClaw agent for mention:', mentionId);
  console.log('[Agent] Document:', documentId);
  console.log('[Agent] Block:', blockId);
  console.log('[Agent] Author:', authorName);

  // Log the prompt for debugging
  console.log('[Agent] Prompt:\n' + '='.repeat(50));
  console.log(fullPrompt);
  console.log('='.repeat(50));

  // In a real implementation, this would call OpenClaw's internal API
  // to trigger the agent. For now, we'll return a promise that resolves
  // immediately, indicating the processing has started.
  
  // The actual agent processing happens asynchronously.
  // OpenClaw core will receive the prompt and context, then use
  // the MCP client to interact with the document.
  
  // Return immediately - processing is async
  return {
    status: 'triggered',
    mentionId,
    documentId,
    blockId,
    timestamp: new Date().toISOString(),
    message: 'Agent processing started'
  };
}

/**
 * Build the agent prompt with full context
 * 
 * @param {string} userPrompt - The user's instruction (extracted from mention)
 * @param {object} context - Full context object
 * @returns {string} - Formatted prompt for the agent
 */
function buildAgentPrompt(userPrompt, context) {
  const {
    documentId,
    blockId,
    mcpEndpoint,
    mcpToken,
    authorName,
    mentionText,
    contextBefore,
    contextAfter
  } = context;

  // Build the context section
  let contextSection = '';
  if (contextBefore || contextAfter) {
    contextSection = `
## Document Context

\`\`\`
${contextBefore}[CURSOR: mention location]${contextAfter}
\`\`\`
`;
  }

  // Build the MCP tools section
  const toolsSection = `
## Available MCP Tools

You have access to the following MCP tools on Knobase:

### read_document
Read the full document content or a specific block.
\`\`\`json
{
  "document_id": "${documentId}",
  "block_id": "${blockId}" // optional, for specific block
}
\`\`\`

### write_document
Write to the document using operations.

**Operations:**
- \`replace_block\` - Replace entire block content
- \`insert_after_block\` - Insert new block after target
- \`insert_before_block\` - Insert new block before target
- \`append\` - Add to document end
- \`prepend\` - Add to document start

**Example:**
\`\`\`json
{
  "document_id": "${documentId}",
  "operations": [
    {
      "type": "insert_after_block",
      "block_id": "${blockId}",
      "content": { "type": "paragraph", "content": [{ "type": "text", "text": "Your response here" }] }
    }
  ]
}
\`\`\`
`;

  // Build the final prompt
  const fullPrompt = `
# Mention from ${authorName || 'User'}

> "${mentionText}"

${contextSection}

${toolsSection}

## Your Task

${userPrompt || 'Help the user with their request.'}

## MCP Connection

- **Endpoint:** ${mcpEndpoint || 'Not provided'}
- **Token:** ${mcpToken ? '[PROVIDED]' : '[NOT PROVIDED]'}

---

Please process this request and respond appropriately. Use the MCP tools to read the document context if needed, and write your response to the document.
`.trim();

  return fullPrompt;
}

/**
 * Format a simple agent response for insertion into document
 * 
 * @param {string} response - The agent's response text
 * @param {string} format - Format style ('callout', 'paragraph', 'blockquote')
 * @returns {object} - TiPTap content object
 */
export function formatAgentResponse(response, format = 'callout') {
  switch (format) {
    case 'callout':
      return {
        type: 'callout',
        attrs: { emoji: '🤖' },
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: response }]
          }
        ]
      };
    
    case 'blockquote':
      return {
        type: 'blockquote',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `🤖 ${response}` }]
          }
        ]
      };
    
    case 'paragraph':
    default:
      return {
        type: 'paragraph',
        content: [{ type: 'text', text: `🤖 ${response}` }]
      };
  }
}

/**
 * Extract the instruction from a mention text
 * Removes the @agent prefix and returns the rest
 * 
 * @param {string} mentionText - Full mention text (e.g., "@claw summarize this")
 * @returns {string} - Extracted instruction
 */
export function extractInstruction(mentionText) {
  if (!mentionText) return '';
  
  // Remove @agent prefix and any extra whitespace
  const cleaned = mentionText
    .replace(/^@\w+\s*/i, '')  // Remove @agent prefix
    .trim();
  
  return cleaned;
}

export default {
  triggerOpenClawAgent,
  buildAgentPrompt,
  formatAgentResponse,
  extractInstruction
};
