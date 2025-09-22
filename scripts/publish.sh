#!/bin/bash

# Jaxon Optimizely DXP MCP - NPM Publishing Script
# For use by authorized Jaxon Digital developers

set -e

echo "🚀 Jaxon Optimizely DXP MCP - NPM Publishing Script"
echo "===================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if logged in to npm
echo "📋 Checking npm login status..."
npm whoami &>/dev/null || {
    echo -e "${RED}❌ Not logged in to npm!${NC}"
    echo "Please run: npm login"
    echo "Or set NPM_TOKEN environment variable"
    exit 1
}

CURRENT_USER=$(npm whoami)
echo -e "${GREEN}✅ Logged in as: $CURRENT_USER${NC}"
echo ""

# Check for uncommitted changes
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborting..."
        exit 1
    fi
fi

# Run tests
echo "🧪 Running tests..."
npm test || {
    echo -e "${RED}❌ Tests failed! Fix issues before publishing.${NC}"
    exit 1
}
echo -e "${GREEN}✅ Tests passed${NC}"
echo ""

# Check PowerShell dependencies
echo "🔍 Checking PowerShell dependencies..."
node scripts/install-dependencies.js || {
    echo -e "${YELLOW}⚠️  PowerShell check failed but continuing...${NC}"
}
echo ""

# Check package.json version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

# Check if version exists on npm
NPM_VERSION=$(npm view jaxon-optimizely-dxp-mcp version 2>/dev/null || echo "0.0.0")
echo "📦 Latest npm version: $NPM_VERSION"

if [ "$CURRENT_VERSION" = "$NPM_VERSION" ]; then
    echo ""
    echo -e "${RED}⚠️  Version $CURRENT_VERSION already exists on npm!${NC}"
    echo "Please update the version first:"
    echo "  npm version patch  (for bug fixes)"
    echo "  npm version minor  (for new features)"
    echo "  npm version major  (for breaking changes)"
    exit 1
fi

# Update README version badge
echo "📝 Updating README version badge..."
node scripts/update-readme-version.js 2>/dev/null || {
    echo -e "${YELLOW}⚠️  Could not update README badge${NC}"
}

# Dry run
echo ""
echo "📋 Package contents preview:"
npm pack --dry-run 2>/dev/null | grep -E "^npm notice" | head -30
echo ""

# Show what's being published
echo "📦 Files to be published:"
echo "  - Main file: jaxon-optimizely-dxp-mcp.js"
echo "  - Library: lib/**/*"
echo "  - Scripts: install-dependencies.js, update-mcp-clients.js"
echo "  - Docs: README.md, LICENSE, CHANGELOG.md, etc."
echo ""

# Confirm publication
echo -e "${YELLOW}📦 Ready to publish jaxon-optimizely-dxp-mcp@$CURRENT_VERSION${NC}"
read -p "Publish to npm? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborting..."
    exit 1
fi

# Publish
echo ""
echo "🚀 Publishing to npm..."
npm publish --access public || {
    echo -e "${RED}❌ Publication failed!${NC}"
    exit 1
}

echo ""
echo -e "${GREEN}✅ Successfully published jaxon-optimizely-dxp-mcp@$CURRENT_VERSION${NC}"
echo ""

# Run post-publish script
echo "🔄 Updating MCP clients..."
npm run update-clients || {
    echo -e "${YELLOW}⚠️  Could not auto-update clients${NC}"
}

echo ""
echo "📋 Post-publish checklist:"
echo "  1. Push the version tag: git push origin v$CURRENT_VERSION"
echo "  2. Sync to public repo: ./scripts/sync-public-repo.sh"
echo "  3. Create a GitHub release"
echo "  4. Update CHANGELOG.md"
echo "  5. Notify the team in Slack/Teams"
echo ""
echo -e "${GREEN}🎉 Done!${NC}"