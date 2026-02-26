# openclaw-knobase

[![npm version](https://badge.fury.io/js/openclaw-knobase.svg)](https://www.npmjs.com/package/openclaw-knobase)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Official OpenClaw skill for Knobase integration. Connect your OpenClaw agent to Knobase workspaces for seamless @claw mentions and notifications.

## ✨ Features

- 🔗 **Connect OpenClaw to Knobase** in 3 simple commands
- 💬 **@claw mentions** - Get notified in Telegram when mentioned
- 🔄 **Real-time webhooks** - Instant notifications from your workspace
- 🔐 **Secure** - HMAC signature verification for all webhooks
- 🆔 **Unique Agent ID** - Each installation gets a unique identifier

## 📦 Installation

### Option 1: npx (Recommended - No Install)
```bash
npx openclaw-knobase
```

### Option 2: Global Install
```bash
npm install -g openclaw-knobase
openclaw-knobase
```

### Option 3: OpenClaw Skill
```bash
openclaw skill install knobase
```

## 🚀 Quick Start

### 1. Authenticate
```bash
openclaw knobase auth
```
You'll be prompted for your Knobase API key.

### 2. Connect to workspace
```bash
openclaw knobase connect
```

### 3. Start Webhook Server
```bash
openclaw knobase webhook start
```

### 4. Test It
Type `@claw` in any Knobase document and you'll receive a Telegram notification!

## 📖 Commands

| Command | Description |
|---------|-------------|
| `auth` | Authenticate with Knobase API |
| `connect` | Connect to a Knobase workspace |
| `status` | Check connection status |
| `webhook` | Start/stop webhook server |
| `setup` | Run initial setup |

## 🔧 Configuration

Configuration is stored in `~/.openclaw/skills/knobase/.env`:

```env
KNOBASE_API_KEY=your_api_key
KNOBASE_WORKSPACE_ID=your_workspace_id
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## 🐛 Troubleshooting

### "Command not found"
Make sure the package is installed globally or use `npx`.

### "Not authenticated"
Run `openclaw knobase auth` first to configure your API key.

### "Webhook not receiving"
- Check that the port (default 3456) is open
- Verify your webhook URL is accessible from the internet
- Check Telegram bot token and chat ID

## 📖 Documentation

See [SKILL.md](./SKILL.md) for full documentation.

## 📄 License

MIT © [Knobase](https://knobase.com)
