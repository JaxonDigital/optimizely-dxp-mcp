#!/bin/bash

# setup-repo.sh
# Set up git hooks and repository configuration
# Built by Jaxon Digital

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🔧 Jaxon Digital - Repository Setup${NC}"
echo "======================================="

# Set up git remotes if not already configured
echo -e "${YELLOW}📡 Checking git remotes...${NC}"

if ! git remote | grep -q "^origin$"; then
    echo "Adding origin (private) remote..."
    git remote add origin git@github.com:JaxonDigital/optimizely-dxp-mcp-private.git
else
    echo "  ✓ origin (private) already configured"
fi

if ! git remote | grep -q "^public$"; then
    echo "Adding public remote..."
    git remote add public https://github.com/JaxonDigital/optimizely-dxp-mcp.git
else
    echo "  ✓ public already configured"
fi

# Install git hooks
echo -e "${YELLOW}🪝 Installing git hooks...${NC}"

# Pre-push hook
if [ -f ".git/hooks/pre-push" ]; then
    echo "  ⚠️  pre-push hook already exists, skipping"
else
    ln -s ../../scripts/pre-push-check.sh .git/hooks/pre-push
    echo "  ✓ pre-push hook installed"
fi

# Pre-commit hook for secrets
if [ -f ".git/hooks/pre-commit" ]; then
    echo "  ⚠️  pre-commit hook already exists, skipping"
else
    ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit
    echo "  ✓ pre-commit hook installed"
fi

echo ""
echo -e "${GREEN}✅ Repository setup complete!${NC}"
echo ""
echo "Available commands:"
echo "  • git push origin main     - Push to private repository"
echo "  • ./scripts/sync-public-repo.sh - Sync to public repository"
echo ""
echo "The pre-push hook will prevent accidental pushes of sensitive files to public."