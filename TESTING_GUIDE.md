# Testing Guide for openclaw-knobase v1.2.0
## Before Publishing to npm

---

## Quick Test Checklist

### 1. Build Verification ✅
```bash
cd ~/Documents/GitHub/openclaw-knobase-skill
pnpm build
# Should output: "✓ Build completed successfully"
```

### 2. Link Local Version for Testing

```bash
# In the repo directory
cd ~/Documents/GitHub/openclaw-knobase-skill
npm link

# This creates a global symlink to your local code
# Now 'openclaw-knobase' command uses your local version
```

### 3. Test Each Command

#### Test: Connect with Device Code
```bash
# Get a device code from Knobase UI
# Then test:
openclaw-knobase connect --device-code YOUR_CODE_HERE

# Should show:
# - Agent selector (arrow keys)
# - Brain mode prompt
# - File sync selection
# - Success message
```

#### Test: Daemon Commands
```bash
# Start daemon
openclaw-knobase daemon start

# Check status
openclaw-knobase daemon status

# View logs
openclaw-knobase daemon logs

# Stop daemon
openclaw-knobase daemon stop
```

#### Test: Sync Command
```bash
# Test sync
openclaw-knobase sync

# Should show file comparison
# Upload/download as needed
```

#### Test: Docs Commands
```bash
# List documents
openclaw-knobase docs list

# Read a document
openclaw-knobase docs read YOUR_DOC_ID

# Search
openclaw-knobase docs search "test query"
```

#### Test: Help
```bash
openclaw-knobase --help
openclaw-knobase connect --help
openclaw-knobase daemon --help
```

### 4. Test Brain Mode Onboarding

```bash
# Fresh install test
rm -rf ~/.openclaw/skills/knobase

# Reinstall from local
npm link openclaw-knobase

# Run setup
openclaw-knobase connect --device-code XXX

# Verify you see the brain mode prompt
# Choose option 2 (brain mode)
# Verify daemon starts automatically
```

### 5. Verify Files Created

```bash
# Check these files exist:
ls ~/.openclaw/skills/knobase/bin/
# Should show:
# - auth.js
# - cli.js
# - connect.js
# - daemon.js          ← NEW
# - daemon-install.js  ← NEW
# - docs/
# - agents/
# - sync.js
# - export.js
# - import.js
# - ...etc
```

### 6. Test Error Handling

```bash
# Test with invalid device code
openclaw-knobase connect --device-code invalid
# Should show helpful error

# Test daemon without config
rm ~/.openclaw/skills/knobase/.env
openclaw-knobase daemon start
# Should prompt to connect first
```

---

## Manual Testing Scenarios

### Scenario 1: First-Time User
```bash
# 1. Clear any existing setup
rm -rf ~/.openclaw/skills/knobase

# 2. Install fresh
npm link openclaw-knobase

# 3. Get device code from Knobase
# Go to https://app.knobase.com/invite → Agent tab

# 4. Run connect
openclaw-knobase connect --device-code YOUR_CODE

# 5. Verify:
# - Agent selector appears
# - Brain mode prompt shows
# - Select brain mode
# - Daemon starts
# - Files sync
```

### Scenario 2: Existing User Upgrade
```bash
# 1. Keep existing .env
# Should have AGENT_ID, API_KEY, etc.

# 2. Update code
npm link openclaw-knobase

# 3. Test sync still works
openclaw-knobase sync

# 4. Test new daemon
openclaw-knobase daemon start
openclaw-knobase daemon status
```

### Scenario 3: Offline Mode
```bash
# 1. Start daemon
openclaw-knobase daemon start

# 2. Disconnect internet
# Edit a local file

# 3. Reconnect internet
# Verify daemon queues and retries upload
```

---

## Automated Smoke Test

Create a test script:

```bash
#!/bin/bash
# test-smoke.sh

echo "🧪 Smoke Testing openclaw-knobase..."

# Test 1: CLI exists
echo "✓ CLI exists"
openclaw-knobase --help > /dev/null || exit 1

# Test 2: Daemon commands
echo "✓ Daemon commands available"
openclaw-knobase daemon --help > /dev/null || exit 1

# Test 3: Docs commands
echo "✓ Docs commands available"
openclaw-knobase docs --help > /dev/null || exit 1

# Test 4: Sync command
echo "✓ Sync command available"
openclaw-knobase sync --help > /dev/null || exit 1

echo "✅ All smoke tests passed!"
```

Run it:
```bash
chmod +x test-smoke.sh
./test-smoke.sh
```

---

## Publishing Checklist

Before running `npm publish`:

- [ ] Build passes: `pnpm build`
- [ ] No syntax errors in any .js files
- [ ] All commands work with `npm link`
- [ ] Brain mode prompt appears during setup
- [ ] Daemon starts/stops correctly
- [ ] Sync works in both directions
- [ ] Help text is accurate
- [ ] Version bumped in package.json (1.2.0)
- [ ] CHANGELOG.md updated (optional)
- [ ] README.md updated with new features (optional)

---

## If You Find Issues

### Debug Mode
```bash
# Run with debug logging
DEBUG=openclaw-knobase openclaw-knobase connect --device-code XXX
```

### Check Logs
```bash
# Daemon logs
cat ~/.openclaw/skills/knobase/logs/daemon.log

# System logs (macOS)
log show --predicate 'process == "node"' --last 1h
```

### Reset Everything
```bash
# Nuclear option - start fresh
rm -rf ~/.openclaw/skills/knobase
npm unlink openclaw-knobase
npm link ~/Documents/GitHub/openclaw-knobase-skill
```

---

## Ready to Publish?

If all tests pass:

```bash
cd ~/Documents/GitHub/openclaw-knobase-skill

# 1. Unlink local version
npm unlink openclaw-knobase

# 2. Publish
npm publish

# 3. Verify
npm view openclaw-knobase versions
```

Then test from npm:
```bash
npm install -g openclaw-knobase@1.2.0
openclaw-knobase --version
# Should show: 1.2.0
```

---

## Support

If tests fail:
1. Check daemon logs
2. Verify .env file has correct values
3. Ensure Knobase API is accessible
4. Try the nuclear reset option

---

**Good luck! 🚀**
