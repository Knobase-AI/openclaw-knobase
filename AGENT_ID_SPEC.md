# Agent Identification & Authentication System

## Overview

This document describes how OpenClaw agents are uniquely identified and authenticated with Knobase.

## Agent ID Generation

Each OpenClaw instance generates a unique **Agent ID** during initial authentication:

```
Format: knobase_agent_{uuid}
Example: knobase_agent_a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### Generation Algorithm

```javascript
const crypto = require('crypto');

function generateAgentId() {
  const uuid = crypto.randomUUID();
  return `knobase_agent_${uuid}`;
}
```

The UUID is generated using Node.js's `crypto.randomUUID()` which provides:
- **Version 4 UUID** (random)
- **122 bits of entropy**
- **Practically guaranteed uniqueness**

### Storage

The Agent ID is stored in:
- **File**: `~/.openclaw/skills/knobase/.env`
- **Permissions**: 600 (owner read/write only)
- **Format**: Environment variable `AGENT_ID`

Example `.env` file:
```env
AGENT_ID=knobase_agent_a1b2c3d4-e5f6-7890-abcd-ef1234567890
KNOBASE_API_KEY=knobase_api_xxxxxxxx
KNOBASE_WORKSPACE_ID=ws_xxxxxxxx
```

## Authentication Flow

### 1. Initial Setup

```
User runs: openclaw knobase auth

↓

Skill generates unique Agent ID
↓
Prompts for Knobase API Key
↓
Validates API Key with Knobase API
↓
Registers Agent with Knobase
↓
Stores credentials locally
```

### 2. Agent Registration

When authenticating, the skill sends:

```json
{
  "agent_id": "knobase_agent_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "OpenClaw Mac-mini",
  "type": "openclaw",
  "version": "1.0.0",
  "capabilities": [
    "mention_handler",
    "notification_receiver", 
    "context_sync"
  ],
  "platform": "darwin",
  "hostname": "Christopher의 Mac mini"
}
```

### 3. API Request Headers

Every API request includes:

```
Authorization: Bearer {KNOBASE_API_KEY}
X-Agent-ID: knobase_agent_a1b2c3d4-e5f6-7890-abcd-ef1234567890
Content-Type: application/json
```

## Knobase-Side Implementation

### Database Schema

```sql
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(255) UNIQUE NOT NULL,
    -- Format: knobase_agent_{uuid}
    
    user_id UUID REFERENCES users(id),
    workspace_id UUID REFERENCES workspaces(id),
    
    name VARCHAR(255),
    type VARCHAR(50) DEFAULT 'openclaw',
    version VARCHAR(50),
    
    capabilities TEXT[],
    platform VARCHAR(50),
    hostname VARCHAR(255),
    
    is_active BOOLEAN DEFAULT true,
    last_seen_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(user_id, agent_id)
);

CREATE INDEX idx_agents_agent_id ON agents(agent_id);
CREATE INDEX idx_agents_user_id ON agents(user_id);
CREATE INDEX idx_agents_workspace_id ON agents(workspace_id);
```

### API Endpoints for Knobase

#### POST /v1/agents/register

Register a new agent or update existing one.

**Request:**
```json
{
  "agent_id": "knobase_agent_...",
  "name": "OpenClaw Agent",
  "type": "openclaw",
  "version": "1.0.0",
  "capabilities": ["mention_handler", "notification_receiver"],
  "platform": "darwin",
  "hostname": "Mac-mini"
}
```

**Response:**
```json
{
  "success": true,
  "agent": {
    "id": "agent_uuid",
    "agent_id": "knobase_agent_...",
    "created_at": "2024-01-01T00:00:00Z"
  }
}
```

#### GET /v1/agents/{agent_id}

Get agent details.

#### POST /v1/agents/{agent_id}/heartbeat

Update last_seen timestamp.

### Counting Logic

To count unique OpenClaw agents per user/workspace:

```sql
-- Total agents for a user
SELECT COUNT(*) 
FROM agents 
WHERE user_id = ? AND type = 'openclaw' AND is_active = true;

-- Agents per workspace
SELECT COUNT(*) 
FROM agents 
WHERE workspace_id = ? AND type = 'openclaw';

-- Recent agents (active in last 24h)
SELECT agent_id, name, last_seen_at
FROM agents 
WHERE user_id = ? 
  AND last_seen_at > NOW() - INTERVAL '24 hours'
ORDER BY last_seen_at DESC;
```

## Security Considerations

### 1. Agent ID Uniqueness

- UUID ensures collision probability is negligible
- Agent ID never changes once generated
- Re-authentication uses same Agent ID

### 2. API Key Validation

- API Key is required for all operations
- Agent ID must match the user who owns the API key
- Invalid combinations are rejected

### 3. Webhook Verification

Optional HMAC signature verification:

```javascript
const signature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(payload))
  .digest('hex');

// Send as header: X-Knobase-Signature: {signature}
```

### 4. Local Storage Security

- `.env` file has 600 permissions (owner only)
- Never committed to git
- Separate from main OpenClaw config

## Multi-Agent Scenarios

### Same Machine, Multiple Agents

Each OpenClaw instance generates its own Agent ID:

```
Agent 1: knobase_agent_aaa-bbb-ccc (Production)
Agent 2: knobase_agent_xxx-yyy-zzz (Development)
```

Both can connect to same workspace or different workspaces.

### Same User, Multiple Machines

Each machine has unique Agent ID:

```
Mac mini: knobase_agent_mac_...
Laptop:   knobase_agent_lap_...
Server:   knobase_agent_srv_...
```

All count as separate agents for usage tracking.

## Usage Tracking

### Metrics to Track

1. **Active Agents**: Agents with heartbeat in last 24h
2. **Total Registered**: All-time agent registrations
3. **By Workspace**: Agents connected to each workspace
4. **By Platform**: macOS, Linux, Windows distribution

### Billing Considerations

Possible pricing tiers:
- **Free**: 1 agent
- **Pro**: 5 agents  
- **Team**: Unlimited agents

### Implementation Example

```javascript
// Check if user can add more agents
async function canAddAgent(userId, plan) {
  const currentAgents = await db.query(
    'SELECT COUNT(*) FROM agents WHERE user_id = ? AND is_active = true',
    [userId]
  );
  
  const limits = {
    'free': 1,
    'pro': 5,
    'team': Infinity
  };
  
  return currentAgents < limits[plan];
}
```

## Migration & Backup

### Transferring Agent to New Machine

1. Copy `~/.openclaw/skills/knobase/.env` to new machine
2. Agent ID remains the same
3. Old installation should be deactivated

### Regenerating Agent ID

If needed (security breach, etc.):
1. Delete `~/.openclaw/skills/knobase/.env`
2. Run `openclaw knobase auth` again
3. New Agent ID will be generated
4. Old agent should be marked inactive in Knobase

## Future Enhancements

### 1. Agent Groups
Allow grouping multiple agents:
```
Production Group:
  - knobase_agent_prod_1
  - knobase_agent_prod_2
```

### 2. Agent Labels
User-defined labels for organization:
```json
{
  "labels": ["production", "mac-mini", "primary"]
}
```

### 3. Agent Health Monitoring
Track agent health metrics:
- Last heartbeat
- Error rates
- Response times

### 4. Agent Tokens
Short-lived tokens instead of permanent API keys:
```
Access Token: 1 hour expiry
Refresh Token: 30 day expiry
```
