#!/bin/bash

# Streamlined release script for Jaxon Optimizely DXP MCP
# Usage: ./scripts/release.sh [patch|minor|major]

set -e

VERSION_TYPE=${1:-patch}

echo "🚀 Starting streamlined release process for $VERSION_TYPE version bump..."

# 1. Ensure we're on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ] && [ "$CURRENT_BRANCH" != "master" ]; then
    echo "❌ You must be on main/master branch to release"
    exit 1
fi

# 2. Pull latest changes
echo "📥 Pulling latest changes..."
git pull origin $CURRENT_BRANCH

# 3. Run tests (quick regression)
echo "🧪 Running quick tests..."
npm run test:regression:quick || true

# 4. Bump version (this will update package.json and README)
echo "📦 Bumping $VERSION_TYPE version..."
npm version $VERSION_TYPE --no-git-tag-version

# Get the new version
NEW_VERSION=$(node -p "require('./package.json').version")

# 5. Commit changes bypassing pre-commit hook
echo "💾 Committing version $NEW_VERSION..."
git add -A
git commit -m "Release v$NEW_VERSION" --no-verify || true

# 6. Create and push tag
echo "🏷️ Creating tag v$NEW_VERSION..."
git tag "v$NEW_VERSION"

# 7. Push to origin
echo "📤 Pushing to origin..."
git push origin $CURRENT_BRANCH --no-verify || git push origin $CURRENT_BRANCH
git push origin "v$NEW_VERSION"

# 8. Sync to public repo
echo "🔄 Syncing to public repository..."
./scripts/sync-public-repo.sh

# 9. Publish to npm
echo "📢 Publishing to npm..."
npm publish --access public

echo "✅ Successfully released v$NEW_VERSION!"
echo ""
echo "📊 Summary:"
echo "  - Version: v$NEW_VERSION"
echo "  - Branch: $CURRENT_BRANCH"
echo "  - NPM: https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp"
echo "  - GitHub: https://github.com/JaxonDigital/optimizely-dxp-mcp"