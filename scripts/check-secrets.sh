#!/bin/bash

# Secret detection script for Optimizely DXP MCP Server
# This script checks for potential secrets in staged files

echo "🔍 Checking for secrets in staged files..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Patterns to check
SECRET_PATTERNS=(
    # API Keys and Secrets
    'OPTIMIZELY_API_KEY\s*=\s*["\x27][^"\x27]+'
    'OPTIMIZELY_API_SECRET\s*=\s*["\x27][^"\x27]+'
    'api[_-]?key\s*[:=]\s*["\x27]?[a-zA-Z0-9]{20,}'
    'api[_-]?secret\s*[:=]\s*["\x27]?[a-zA-Z0-9]{20,}'
    'client[_-]?key\s*[:=]\s*["\x27]?[a-zA-Z0-9]{20,}'
    'client[_-]?secret\s*[:=]\s*["\x27]?[a-zA-Z0-9]{20,}'
    
    # Tokens
    'bearer\s+[a-zA-Z0-9\-_\.]+'
    'eyJ[a-zA-Z0-9\-_]+\.eyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+'
    
    # Project IDs that look real (UUIDs)
    'projectId["\x27]?\s*[:=]\s*["\x27]?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
)

# Files to exclude from checking
EXCLUDE_PATTERNS=(
    "*.md"
    "*.txt"
    "package-lock.json"
    "*.test.js"
    "test-*.js"
    ".gitleaks.toml"
    "scripts/check-secrets.sh"
)

# Get list of staged files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED_FILES" ]; then
    echo -e "${GREEN}✅ No staged files to check${NC}"
    exit 0
fi

# Function to check if file should be excluded
should_exclude() {
    local file=$1
    for pattern in "${EXCLUDE_PATTERNS[@]}"; do
        if [[ $file == $pattern ]]; then
            return 0
        fi
    done
    return 1
}

# Check each staged file
FOUND_SECRETS=0
for FILE in $STAGED_FILES; do
    # Skip excluded files
    if should_exclude "$FILE"; then
        continue
    fi
    
    # Skip binary files
    if file "$FILE" | grep -q "binary"; then
        continue
    fi
    
    # Check for secret patterns
    for PATTERN in "${SECRET_PATTERNS[@]}"; do
        if grep -E "$PATTERN" "$FILE" > /dev/null 2>&1; then
            if [ $FOUND_SECRETS -eq 0 ]; then
                echo -e "${RED}❌ Potential secrets detected!${NC}"
                echo ""
            fi
            FOUND_SECRETS=1
            echo -e "${YELLOW}File: $FILE${NC}"
            grep -n -E "$PATTERN" "$FILE" | head -3
            echo ""
        fi
    done
done

if [ $FOUND_SECRETS -eq 1 ]; then
    echo -e "${RED}⚠️  Commit blocked: Potential secrets detected${NC}"
    echo ""
    echo "Please review the files above and:"
    echo "1. Remove any real API keys, secrets, or project IDs"
    echo "2. Use environment variables instead of hardcoding secrets"
    echo "3. If these are example values, make them clearly fake (e.g., 'your-api-key-here')"
    echo ""
    echo "To bypass this check (NOT RECOMMENDED):"
    echo "  git commit --no-verify"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ No secrets detected in staged files${NC}"
exit 0