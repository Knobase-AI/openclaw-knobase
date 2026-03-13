# Knobase Integration for OpenClaw

Official OpenClaw skill to connect your agent with Knobase workspaces. Receive @mentions, notifications, and sync context between OpenClaw and Knobase.

## Quick Start

### 1. Install the Skill

```bash
# Via OpenClaw CLI
openclaw skill install knobase

# Or manually clone
git clone https://github.com/Knobase/openclaw-knobase.git ~/.openclaw/skills/knobase
cd ~/.openclaw/skills/knobase
npm install
```

### 2. Authenticate

There are two ways to authenticate with Knobase:

#### Method 1: Device Code Flow (Recommended)

```bash
openclaw knobase auth
```

This starts an interactive device code flow:
1. The CLI displays a URL and a one-time code
2. Open the URL in your browser (e.g. `https://knobase.com/device`)
3. Enter the code shown in your terminal
4. Approve the connection in your browser
5. The CLI automatically completes authentication once approved

The device code flow generates a unique **Agent ID**, registers the agent with your workspace, and stores credentials securely — no need to manually copy API keys.

#### Method 2: API Key (Advanced)

For CI/CD pipelines or headless environments where a browser is not available:

```bash
openclaw knobase auth --api-key kb_xxxx...
```

Pass your Knobase API key directly. This skips the interactive flow and authenticates immediately using the provided key.

### 3. Connect to Workspace

```bash
openclaw knobase connect
```

Select which Knobase workspace to connect to.

### 4. Start Webhook Receiver

```bash
openclaw knobase webhook start
```

Or run in background:
```bash
openclaw knobase webhook start --daemon
```

## Features

### ✅ @claw Mentions
When someone mentions @claw in Knobase, you receive a Telegram notification with:
- Who mentioned you
- The message content
- Channel/context
- Direct link to the conversation

### ✅ Notifications
Receive important notifications from Knobase:
- Task assignments
- Mention summaries
- System alerts

### ✅ Bidirectional Context
- Knobase can query OpenClaw for context
- OpenClaw can update Knobase with session data
- Shared memory across platforms

## Commands

| Command | Description |
|---------|-------------|
| `openclaw knobase auth` | Authenticate via device code flow |
| `openclaw knobase auth --api-key` | Authenticate with an API key (CI/CD) |
| `openclaw knobase connect` | Connect to a workspace |
| `openclaw knobase status` | Check connection status |
| `openclaw knobase disconnect` | Disconnect from workspace |
| `openclaw knobase webhook start` | Start webhook receiver |
| `openclaw knobase webhook stop` | Stop webhook receiver |
| `openclaw knobase logs` | View recent activity |

## Configuration

Configuration is stored in `~/.openclaw/skills/knobase/.env`:

```env
# Required
KNOBASE_API_KEY=your_api_key_here
KNOBASE_WORKSPACE_ID=your_workspace_id
AGENT_ID=auto_generated_unique_id

# Optional
KNOBASE_WEBHOOK_SECRET=webhook_verification_secret
KNOBASE_WEBHOOK_URL=https://your-webhook-url.com/webhook
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Webhook Server
WEBHOOK_PORT=3456
WEBHOOK_HOST=0.0.0.0
```

## Agent Identification

Each OpenClaw instance gets a unique **Agent ID** during authentication:

- Format: `knobase_agent_{uuid}`
- Stored in: `~/.openclaw/skills/knobase/.env`
- Used for: Usage tracking, context isolation, security

Example: `knobase_agent_a1b2c3d4-e5f6-7890-abcd-ef1234567890`

## API Usage

### From OpenClaw Session

```javascript
// Check if Knobase is connected
const knobase = require('openclaw-knobase');
await knobase.status();

// Send message to Knobase channel
await knobase.sendMessage({
  channel: 'general',
  message: 'Hello from OpenClaw!'
});

// Get unread mentions
const mentions = await knobase.getMentions();
```

### From SKILL.md

The skill provides these tools to OpenClaw:

- `knobase_mention` - Send a mention to Knobase
- `knobase_notify` - Send notification to Knobase
- `knobase_sync` - Sync context between platforms
- `knobase_query` - Query Knobase data

## Architecture

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   OpenClaw      │────────▶│  Knobase Skill  │────────▶│    Knobase      │
│   Agent         │         │  (this package) │         │   Workspace     │
│                 │◀────────│                 │◀────────│                 │
└─────────────────┘ Webhook └─────────────────┘  API    └─────────────────┘
       │                                                           │
       │                                                           │
       ▼                                                           ▼
┌─────────────────┐                                       ┌─────────────────┐
│   Telegram      │◀───────────────────────────────────────│   @claw         │
│   (You)         │            Notifications                │   Mentions      │
└─────────────────┘                                       └─────────────────┘
```

## Troubleshooting

### "Not authenticated"
Run `openclaw knobase auth` to start the device code flow, or `openclaw knobase auth --api-key kb_xxxx...` if using an API key.

### "Webhook not receiving"
Check:
- Port is open (default: 3456)
- URL is accessible from internet (use ngrok for local testing)
- Webhook is registered in Knobase settings

### "Agent ID conflicts"
Each OpenClaw instance should have unique Agent ID. Delete `~/.openclaw/skills/knobase/.env` and re-authenticate.

## Development

```bash
git clone https://github.com/Knobase/openclaw-knobase.git
cd openclaw-knobase
npm install
npm run dev
```

## License

MIT © Knobase
