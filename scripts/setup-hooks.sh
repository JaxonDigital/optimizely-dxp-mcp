#!/bin/bash

# Setup Git Hooks for Jaxon Optimizely DXP MCP
# Ensures security and quality before commits and pushes

echo "🔧 Setting up git hooks for Optimizely DXP MCP"
echo "=============================================="
echo ""

# Create hooks directory if it doesn't exist
mkdir -p .git/hooks

# Create pre-commit hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

# Pre-commit hook for Optimizely DXP MCP

# Run secret detection
if [ -f scripts/check-secrets.sh ]; then
    ./scripts/check-secrets.sh
    if [ $? -ne 0 ]; then
        echo "Pre-commit check failed. Commit aborted."
        echo "To bypass (use carefully): git commit --no-verify"
        exit 1
    fi
fi

# Check for CLAUDE.md in staged files
if git diff --cached --name-only | grep -q "CLAUDE.md"; then
    echo "⚠️  Warning: CLAUDE.md is being committed"
    echo "This file should only be in the private repository"
    read -p "Continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check for client-specific files
CLIENT_PATTERNS=("christie" "vhb" "cambro")
STAGED=$(git diff --cached --name-only)

for pattern in "${CLIENT_PATTERNS[@]}"; do
    if echo "$STAGED" | grep -i "$pattern" > /dev/null; then
        echo "⚠️  Warning: Found file with client name: $pattern"
        echo "Client-specific files should not be in public repo"
        read -p "Continue? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
done

echo "✅ Pre-commit checks passed"
exit 0
EOF

# Make pre-commit hook executable
chmod +x .git/hooks/pre-commit

# Create pre-push hook
cat > .git/hooks/pre-push << 'EOF'
#!/bin/bash

# Pre-push hook for Optimizely DXP MCP

echo "🧪 Running tests before push..."

# Run basic tests
npm test
if [ $? -ne 0 ]; then
    echo "❌ Tests failed. Push aborted."
    echo "Fix the tests or use: git push --no-verify"
    exit 1
fi

# Check PowerShell dependencies
echo "🔍 Checking dependencies..."
npm run check-deps 2>/dev/null || {
    echo "⚠️  PowerShell check failed but continuing..."
}

# Remind about public repo sync
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    echo ""
    echo "📌 Reminder: After push, consider syncing to public repo:"
    echo "   npm run sync:public"
    echo ""
fi

echo "✅ Pre-push checks passed"
exit 0
EOF

# Make pre-push hook executable
chmod +x .git/hooks/pre-push

echo "✅ Git hooks installed successfully!"
echo ""
echo "Installed hooks:"
echo "  • pre-commit: Checks for secrets and client data"
echo "  • pre-push: Runs tests and checks dependencies"
echo ""
echo "To bypass hooks (use sparingly):"
echo "  • git commit --no-verify"
echo "  • git push --no-verify"
echo ""
echo "To uninstall hooks:"
echo "  • rm .git/hooks/pre-commit"
echo "  • rm .git/hooks/pre-push"
echo ""
echo "Run this script after cloning the repo to set up hooks."