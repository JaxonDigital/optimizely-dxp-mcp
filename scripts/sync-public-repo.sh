#!/bin/bash

# sync-public-repo.sh
# Safely sync changes to the public repository
# Built by Jaxon Digital

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Jaxon Digital - Public Repository Sync${NC}"
echo "================================================"

# Check if we're in the right directory
if [ ! -f "jaxon-optimizely-dxp-mcp.js" ]; then
    echo -e "${RED}❌ Error: Must run from the deployment-mcp directory${NC}"
    exit 1
fi

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}⚠️  Warning: You have uncommitted changes${NC}"
    read -p "Do you want to continue? (y/N): " confirm
    if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
        echo "Sync cancelled"
        exit 0
    fi
fi

# Read the public files manifest
PUBLIC_FILES=(
    ".gitignore"
    "CHANGELOG.md"
    "LICENSE"
    "MULTI_PROJECT_CONFIG.md"
    "README.md"
    "jaxon-optimizely-dxp-mcp.js"
    "lib"
    "package.json"
    "package-lock.json"
)

# Create temporary directory
TEMP_DIR=$(mktemp -d)
echo -e "${YELLOW}📁 Creating temporary directory: $TEMP_DIR${NC}"

# Copy public files
echo -e "${YELLOW}📋 Copying public files...${NC}"
for file in "${PUBLIC_FILES[@]}"; do
    if [ -e "$file" ]; then
        cp -r "$file" "$TEMP_DIR/"
        echo "  ✓ $file"
    else
        echo -e "  ${RED}✗ Missing: $file${NC}"
    fi
done

# Check for accidentally included files
echo -e "${YELLOW}🔍 Checking for sensitive files...${NC}"
SENSITIVE_PATTERNS=(
    "*.env*"
    "CLAUDE.md"
    "MCP_TEST_PLAN.md"
    "test-*"
    "*.bacpac"
    "*.nupkg"
    "*.zip"
    "scripts/check-secrets.sh"
    ".gitleaks.toml"
)

cd "$TEMP_DIR"
FOUND_SENSITIVE=false
for pattern in "${SENSITIVE_PATTERNS[@]}"; do
    if ls $pattern 2>/dev/null | grep -q .; then
        echo -e "  ${RED}❌ Found sensitive file matching: $pattern${NC}"
        FOUND_SENSITIVE=true
    fi
done

if [ "$FOUND_SENSITIVE" = true ]; then
    echo -e "${RED}❌ Sensitive files detected! Aborting sync.${NC}"
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo -e "${GREEN}✅ No sensitive files detected${NC}"

# Initialize git and create clean commit
echo -e "${YELLOW}📦 Creating clean commit...${NC}"
git init -q
git remote add public https://github.com/JaxonDigital/optimizely-dxp-mcp.git
git add -A

# Get current version from package.json
VERSION=$(grep '"version"' package.json | cut -d'"' -f4)

# Create commit message
COMMIT_MSG="Release v$VERSION to public repository

Synchronized from private repository
Built by Jaxon Digital - Optimizely Gold Partner"

git commit -q -m "$COMMIT_MSG"

# Ask for confirmation
echo ""
echo -e "${YELLOW}⚠️  Ready to push to public repository${NC}"
echo "Repository: https://github.com/JaxonDigital/optimizely-dxp-mcp.git"
echo "Version: $VERSION"
echo ""
read -p "Proceed with push? (y/N): " confirm

if [ "$confirm" = "y" ] || [ "$confirm" = "Y" ]; then
    echo -e "${YELLOW}🚀 Pushing to public repository...${NC}"
    git push public master:main --force
    echo -e "${GREEN}✅ Successfully synced to public repository!${NC}"
else
    echo -e "${YELLOW}❌ Push cancelled${NC}"
fi

# Cleanup
cd - > /dev/null
rm -rf "$TEMP_DIR"
echo -e "${GREEN}🧹 Cleanup complete${NC}"