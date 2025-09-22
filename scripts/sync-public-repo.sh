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
if [ ! -f "dist/index.js" ]; then
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
    ".github/workflows/regression-tests.yml"
    "ADVANCED_FEATURES.md"
    "CHANGELOG.md"
    "LICENSE"
    "LOG_CAPABILITIES.md"
    "MULTI_PROJECT_CONFIG.md"
    "SIMPLE_MULTI_PROJECT.md"
    "TELEMETRY.md"
    "TELEMETRY_EVENT_FORMAT.md"
    "UNDERSTANDING_DXP_STRUCTURE.md"
    "WINDOWS_SETUP.md"
    "README.md"
    "dist"
    "lib"
    "package.json"
    "package-lock.json"
    "tests/regression"
    "tests/ci-test.js"
    "tests/TESTING_GUIDE.md"
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

# Check for client names in public files
echo -e "${YELLOW}🔍 Checking for client names...${NC}"
if [ -f "../scripts/check-client-names.sh" ]; then
    if ! ../scripts/check-client-names.sh > /dev/null 2>&1; then
        echo -e "${RED}❌ Client names found in public files!${NC}"
        echo "Please run: ./scripts/check-client-names.sh"
        echo "Then fix any issues before syncing to public repo."
        rm -rf "$TEMP_DIR"
        exit 1
    fi
    echo -e "${GREEN}✅ No client names found${NC}"
else
    echo -e "${YELLOW}⚠️  Client name checker not found, skipping check${NC}"
fi

# Check for accidentally included files
echo -e "${YELLOW}🔍 Checking for sensitive files...${NC}"
SENSITIVE_PATTERNS=(
    "*.env*"
    "CLAUDE.md"
    "MCP_TEST_PLAN.md"
    "tests/test-*.js"
    "tests/*.test.js"
    "test_*.js"
    "direct_*.js"
    "final_*.js"
    "**/index.js.backup"
    "!tests/regression/**"
    "!tests/ci-test.js"
    "*.bacpac"
    "*.nupkg"
    "*.zip"
    "scripts/check-secrets.sh"
    "scripts/publish.sh"
    "scripts/sync-public-repo.sh"
    "scripts/setup-hooks.sh"
    ".gitleaks.toml"
    ".npmrc"
    "PUBLISHING_GUIDE.md"
    "GIT_WORKFLOW_ISSUES.md"
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
git config init.defaultBranch main  # Ensure we start with main branch
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
    # Push to main branch only (never create master)
    # NOTE: We intentionally do NOT push tags to the public repo
    # - Private repo maintains full version history with tags
    # - Public repo is a clean snapshot for npm publishing
    # - Users get version info from npm registry, not git tags
    git branch -M main  # Rename default branch to main
    git push public main:main --force
    echo -e "${GREEN}✅ Successfully synced to public repository!${NC}"
else
    echo -e "${YELLOW}❌ Push cancelled${NC}"
fi

# Cleanup
cd - > /dev/null
rm -rf "$TEMP_DIR"
echo -e "${GREEN}🧹 Cleanup complete${NC}"