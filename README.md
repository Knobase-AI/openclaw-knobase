# openclaw-knobase

[![npm version](https://badge.fury.io/js/openclaw-knobase.svg)](https://www.npmjs.com/package/openclaw-knobase)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Official OpenClaw skill for [Knobase](https://knobase.com) integration. Connect your OpenClaw agent to Knobase workspaces to handle `@claw` mentions, receive real-time webhooks, and read/write documents via MCP.

## Features

- **@claw mentions** — respond to mentions inside Knobase documents automatically
- **Real-time webhooks** — receive instant notifications when events occur in your workspace
- **MCP document access** — read and write Knobase documents through JSON-RPC 2.0
- **Telegram notifications** — forward mention alerts to a Telegram chat
- **HMAC signature verification** — secure webhook payloads with SHA-256 signatures

## Prerequisites

- **Node.js 18+**
- **npm** (or use `npx`)
- A **Knobase account** with an API key ([knobase.com](https://knobase.com))

## Installation

### Option 1: npx (no install)

```bash
npx openclaw-knobase
```

### Option 2: Global install

```bash
npm install -g openclaw-knobase
```

### Option 3: OpenClaw skill

```bash
openclaw skill install knobase
```

### Option 4: Clone from source

```bash
git clone https://github.com/Knobase-AI/openclaw-knobase.git
cd openclaw-knobase
npm install
```

## Quick Start

### 1. Authenticate

Run the auth command and enter your Knobase API key when prompted:

```bash
openclaw knobase auth
```

This generates a unique Agent ID, validates your API key against the Knobase API, registers the agent, and saves credentials to `.env`.

### 2. Connect to a workspace

```bash
openclaw knobase connect
```

Select a workspace from the list, or enter a workspace ID manually.

### 3. Start the webhook server

```bash
openclaw knobase webhook start
```

The server starts on port 3456 by default. Knobase will POST events to `/webhook/knobase`.

### 4. Test it

Type `@claw` followed by an instruction in any Knobase document. The webhook server receives the mention, extracts the instruction, and triggers the OpenClaw agent to process it.

## Commands

| Command | Description |
|---------|-------------|
| `openclaw knobase auth` | Authenticate with your Knobase API key and register an agent |
| `openclaw knobase connect` | Connect to a Knobase workspace |
| `openclaw knobase status` | Check authentication, workspace, and API connectivity |
| `openclaw knobase webhook start` | Start the webhook server |
| `openclaw knobase setup` | Run the full installation/setup flow |
| `openclaw knobase --help` | Show available commands |

### Webhook server options

```bash
openclaw knobase webhook start [options]

Options:
  --port <port>   Port to listen on (default: 3456)
  --help, -h      Show help
```

### Server endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhook/knobase` | POST | Receives Knobase webhook events |
| `/webhook` | POST | Legacy endpoint (redirects to `/webhook/knobase`) |
| `/health` | GET | Health check — returns agent ID and version |
| `/status` | GET | Detailed status — agent, workspace, uptime |

## Environment Variables

All configuration is stored in a `.env` file in the skill directory.

### Required

| Variable | Description |
|----------|-------------|
| `KNOBASE_API_KEY` | Your Knobase API key |
| `KNOBASE_WORKSPACE_ID` | ID of the connected workspace |

### Generated

| Variable | Description |
|----------|-------------|
| `AGENT_ID` | Unique agent identifier (auto-generated during `auth`) |
| `AGENT_NAME` | Display name for the agent |
| `KNOBASE_API_ENDPOINT` | API base URL (default: `https://api.knobase.ai`) |
| `AUTHENTICATED_AT` | Timestamp of last authentication |

### Optional

| Variable | Description |
|----------|-------------|
| `KNOBASE_WEBHOOK_SECRET` | Secret for HMAC-SHA256 webhook signature verification |
| `KNOBASE_MCP_ENDPOINT` | Default MCP endpoint (can also be provided per-webhook payload) |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token for forwarding notifications |
| `TELEGRAM_CHAT_ID` | Telegram chat ID to send notifications to |
| `WEBHOOK_PORT` | Default webhook server port (default: `3456`) |

## Example Usage with Knobase

### Mention an agent in a document

Type `@claw summarize this section` inside a Knobase document. Knobase sends a webhook to your server with the mention text and surrounding context.

### Webhook payload example

```json
{
  "event": "agent.mentioned",
  "data": {
    "mention": {
      "id": "m_abc123",
      "document_id": "doc_456",
      "block_id": "blk_789",
      "text": "@claw summarize this section",
      "context_before": "The quarterly results showed...",
      "context_after": "...across all regions."
    },
    "author": {
      "id": "user_001",
      "name": "Alice"
    },
    "mcp": {
      "endpoint": "https://app.knobase.com/api/mcp",
      "token": "short-lived-token"
    }
  }
}
```

### Programmatic API

```javascript
import { getClient, query, sendMessage } from 'openclaw-knobase';

// Check connection status
const client = await getClient();
const info = await client.status();
console.log(info);

// Query the knowledge base
const results = await query('What were Q3 results?');

// Send a message to a channel
await sendMessage({
  channel: 'general',
  message: 'Report generated successfully.'
});
```

### MCP document operations

```javascript
import { readDocument, insertAfterBlock, replaceBlock } from 'openclaw-knobase';

const endpoint = 'https://app.knobase.com/api/mcp';
const token = 'your-mcp-token';

// Read a document
const doc = await readDocument(endpoint, token, 'doc_456');

// Insert a response after a specific block
await insertAfterBlock(endpoint, token, 'doc_456', 'blk_789', {
  type: 'paragraph',
  content: [{ type: 'text', text: 'Here is the summary...' }]
});

// Replace a block's content
await replaceBlock(endpoint, token, 'doc_456', 'blk_789', {
  type: 'paragraph',
  content: [{ type: 'text', text: 'Updated content' }]
});
```

## Troubleshooting

### "Command not found"

Make sure the package is installed globally (`npm install -g openclaw-knobase`) or use `npx openclaw-knobase`.

### "Not authenticated"

Run `openclaw knobase auth` to configure your API key. The auth flow saves credentials to `.env` in the skill directory.

### Webhook not receiving events

1. Verify the server is running: `curl http://localhost:3456/health`
2. Make sure the port (default 3456) is accessible from the internet — use a tunnel like [ngrok](https://ngrok.com) for local development:
   ```bash
   ngrok http 3456
   ```
3. Register the public URL as a webhook in your Knobase workspace settings.
4. Check the `KNOBASE_WEBHOOK_SECRET` matches what Knobase has on file.

### "Invalid signature" errors

The `KNOBASE_WEBHOOK_SECRET` in your `.env` must match the secret configured in Knobase. If you don't need signature verification during development, remove the variable — the server will skip verification when no secret is set.

### API connection failures

Run `openclaw knobase status` to test connectivity. If the API check fails:
- Confirm `KNOBASE_API_KEY` is valid and not expired.
- Confirm `KNOBASE_API_ENDPOINT` is correct (default: `https://api.knobase.ai`).
- Check your network/firewall settings.

### MCP request timeouts

MCP calls have a 30-second timeout and retry up to 2 times on 5xx/429 errors. If requests consistently time out, verify the MCP endpoint URL and token provided in the webhook payload.

## License

MIT &copy; [Knobase](https://knobase.com)
