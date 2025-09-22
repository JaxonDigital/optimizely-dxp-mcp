#!/bin/bash

# Create GitHub PR using API
# Requires GITHUB_TOKEN environment variable or .env file

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env file exists and source it
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ] && [ -z "$GITHUB_PAT" ]; then
    echo -e "${RED}❌ GitHub token not found${NC}"
    echo ""
    echo "Please set one of the following:"
    echo "  export GITHUB_TOKEN=your_token"
    echo "  export GITHUB_PAT=your_token"
    echo ""
    echo "Or add to .env file:"
    echo "  GITHUB_TOKEN=your_token"
    exit 1
fi

# Use whichever token is available
TOKEN="${GITHUB_TOKEN:-$GITHUB_PAT}"

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
    echo -e "${RED}❌ Cannot create PR from main branch${NC}"
    exit 1
fi

# Default values
REPO="JaxonDigital/optimizely-dxp-mcp-private"
BASE="main"
TITLE="$1"
BODY="$2"

# If no title provided, generate one
if [ -z "$TITLE" ]; then
    # Get last commit message as title
    TITLE=$(git log -1 --pretty=%B | head -n 1)
fi

# If no body provided, use a default
if [ -z "$BODY" ]; then
    BODY="## Summary
Auto-generated PR from branch: $BRANCH

## Changes
$(git log main..$BRANCH --oneline | head -10)

## Checklist
- [ ] Tests pass
- [ ] No client names exposed
- [ ] Ready for review

Co-Authored-By: Brian Miller <Brian.Miller@JaxonDigital.com>"
fi

echo -e "${YELLOW}📋 Creating PR...${NC}"
echo "  Branch: $BRANCH → $BASE"
echo "  Title: $TITLE"
echo ""

# Create the PR using GitHub API
RESPONSE=$(curl -s -X POST \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/$REPO/pulls \
  -d @- <<EOF
{
  "title": "$TITLE",
  "body": "$BODY",
  "head": "$BRANCH",
  "base": "$BASE"
}
EOF
)

# Check if PR was created successfully
PR_URL=$(echo "$RESPONSE" | grep -o '"html_url": "[^"]*' | grep -o 'https://[^"]*' | head -1)

if [ -n "$PR_URL" ]; then
    echo -e "${GREEN}✅ PR created successfully!${NC}"
    echo "  URL: $PR_URL"
    echo ""
    echo "Opening in browser..."
    open "$PR_URL" 2>/dev/null || xdg-open "$PR_URL" 2>/dev/null || echo "Please open: $PR_URL"
else
    echo -e "${RED}❌ Failed to create PR${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi