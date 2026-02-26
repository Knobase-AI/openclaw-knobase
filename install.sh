#!/bin/bash
#
# OpenClaw Knobase Installation Script
# 
# Install with:
#   curl -fsSL https://raw.githubusercontent.com/Knobase-AI/openclaw-knobase/main/install.sh | bash
#

set -e

SKILL_DIR="$HOME/.openclaw/skills/knobase"
REPO_URL="https://github.com/Knobase-AI/openclaw-knobase.git"

echo "🚀 Installing Knobase Skill for OpenClaw..."
echo ""

# Check dependencies
command -v node >/dev/null 2>&1 || { echo "❌ Node.js is required but not installed. Aborting." >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo "❌ Git is required but not installed. Aborting." >&2; exit 1; }

echo "✓ Node.js detected"
echo "✓ Git detected"

# Check if already installed
if [ -d "$SKILL_DIR" ]; then
    echo ""
    echo "⚠ Knobase skill already installed at $SKILL_DIR"
    read -p "Reinstall? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi
    rm -rf "$SKILL_DIR"
fi

# Create directories
mkdir -p "$HOME/.openclaw/skills"

# Clone repository
echo ""
echo "📦 Cloning repository..."
git clone "$REPO_URL" "$SKILL_DIR"

# Install dependencies
echo ""
echo "📦 Installing dependencies..."
cd "$SKILL_DIR"
npm install

# Make scripts executable
chmod +x bin/*.js

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Authenticate: node $SKILL_DIR/bin/auth.js"
echo "  2. Or if you have OpenClaw: openclaw knobase auth"
echo ""
echo "Documentation: cat $SKILL_DIR/SKILL.md"
echo ""
