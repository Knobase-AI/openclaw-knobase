#!/bin/bash
# Quick smoke test before publishing

echo "🧪 Testing openclaw-knobase before publish..."
echo ""

# Test 1: Build
echo "1. Checking build..."
if pnpm build > /dev/null 2>&1; then
    echo "   ✅ Build passes"
else
    echo "   ❌ Build failed"
    exit 1
fi

# Test 2: CLI help works
echo "2. Testing CLI..."
if node bin/cli.js --help > /dev/null 2>&1; then
    echo "   ✅ CLI works"
else
    echo "   ❌ CLI broken"
    exit 1
fi

# Test 3: All new files exist
echo "3. Checking new files..."
files=("bin/daemon.js" "bin/daemon-install.js" "bin/sync.js" "bin/export.js" "bin/import.js")
all_exist=true
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file"
    else
        echo "   ❌ $file missing"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    exit 1
fi

# Test 4: Check version
echo "4. Checking version..."
version=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo "   Version: $version"

# Test 5: Node shebangs
echo "5. Checking shebangs..."
if head -1 bin/daemon.js | grep -q "#!/usr/bin/env node"; then
    echo "   ✅ Shebangs correct"
else
    echo "   ❌ Missing shebangs"
    exit 1
fi

echo ""
echo "✅ All pre-publish checks passed!"
echo ""
echo "Next steps:"
echo "  1. npm link (to test locally)"
echo "  2. openclaw-knobase connect --device-code XXX"
echo "  3. Verify brain mode prompt appears"
echo "  4. npm unlink && npm publish"
