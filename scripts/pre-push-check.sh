#!/bin/bash

# pre-push-check.sh
# Git pre-push hook to prevent accidental pushes to public repo with sensitive files
# Built by Jaxon Digital

# Get the remote name
remote="$1"

# Only check if pushing to public remote
if [[ "$remote" == "public" ]]; then
    echo "🔍 Pre-push check for public repository..."
    
    # Check for sensitive files
    SENSITIVE_FILES=(
        "CLAUDE.md"
        "MCP_TEST_PLAN.md"
        ".env.christie"
        ".env.vhb"
        ".env.example"
        ".gitleaks.toml"
        "scripts/check-secrets.sh"
    )
    
    for file in "${SENSITIVE_FILES[@]}"; do
        if git ls-tree -r HEAD --name-only | grep -q "^$file$"; then
            echo "❌ ERROR: Sensitive file '$file' detected in commit!"
            echo "These files should not be pushed to the public repository."
            echo "Use scripts/sync-public-repo.sh instead."
            exit 1
        fi
    done
    
    # Check for test files
    if git ls-tree -r HEAD --name-only | grep -q "^test-"; then
        echo "❌ ERROR: Test files detected in commit!"
        echo "Test files should not be pushed to the public repository."
        exit 1
    fi
    
    echo "✅ Pre-push check passed"
fi

exit 0