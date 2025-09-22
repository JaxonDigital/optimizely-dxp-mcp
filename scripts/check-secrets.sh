#!/bin/sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check branch protection
branch="$(git rev-parse --abbrev-ref HEAD)"

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "❌ Direct commits to main branch are not allowed!"
  echo ""
  echo "Please create a feature branch:"
  echo "  git checkout -b feature/your-feature-name"
  echo ""
  echo "Or switch to an existing branch:"
  echo "  git checkout feature/existing-branch"
  exit 1
fi

# Check for client names in staged files
CLIENT_NAMES="Cambro|VHB|Christie|Oxy|CorporateWebsiteEpiserver|OptimizelyCMSAccelerator"

# Get list of files staged for commit
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -n "$STAGED_FILES" ]; then
    echo "🔍 Pre-commit: Checking for client names..."
    
    FOUND_ISSUES=0
    
    for file in $STAGED_FILES; do
        # Skip binary files and specific file types
        case "$file" in
            *.png|*.jpg|*.gif|*.pdf|*.zip|*.bacpac|*.nupkg)
                continue
                ;;
            scripts/check-client-names.sh|scripts/check-secrets.sh)
                # These scripts need to contain client names to check for them
                continue
                ;;
        esac
        
        # Check for client names in the staged content (only added lines, not removed)
        if git diff --cached "$file" | grep "^+" | grep -v "^+++" | grep -qiE "$CLIENT_NAMES"; then
            if [ $FOUND_ISSUES -eq 0 ]; then
                echo -e "${RED}❌ Client names found in staged files!${NC}"
                echo ""
                FOUND_ISSUES=1
            fi
            # Show which client name was found
            for client in Cambro VHB Christie Oxy; do
                if git diff --cached "$file" | grep "^+" | grep -v "^+++" | grep -qi "$client"; then
                    echo -e "${YELLOW}  → Found '$client' in $file${NC}"
                fi
            done
        fi
    done
    
    if [ $FOUND_ISSUES -eq 1 ]; then
        echo ""
        echo -e "${RED}Commit blocked: Client names detected${NC}"
        echo ""
        echo "Please replace client names with generic examples:"
        echo "  • Cambro → CONTOSO or ACME_CORP"
        echo "  • VHB → ACME or FABRIKAM"
        echo "  • Christie → EXAMPLE_CO or NORTHWIND"
        echo "  • Oxy → SAMPLE_INC or ADVENTURE_WORKS"
        echo ""
        echo "To bypass this check (NOT recommended):"
        echo "  git commit --no-verify"
        echo ""
        exit 1
    fi
    
    echo -e "${GREEN}✅ No client names found in staged files${NC}"
fi
