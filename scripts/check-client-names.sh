#!/bin/bash

# Check for client names in files that will be synced to public repo
# This script helps prevent accidental exposure of client names

set -e

# Client names to check for (case-insensitive)
CLIENT_NAMES=(
    "Cambro"
    "VHB"
    "Christie"
    "Oxy"
    "CorporateWebsiteEpiserver"
    "OptimizelyCMSAccelerator"
)

# Files that get synced to public repo
PUBLIC_FILES=(
    "README.md"
    "CHANGELOG.md"
    "MULTI_PROJECT_CONFIG.md"
    "SIMPLE_MULTI_PROJECT.md"
    "TELEMETRY.md"
    "UNDERSTANDING_DXP_STRUCTURE.md"
    "WINDOWS_SETUP.md"
    "ADVANCED_FEATURES.md"
    "LOG_CAPABILITIES.md"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FOUND_ISSUES=0

echo "🔍 Checking for client names in public files..."
echo "================================================"

for file in "${PUBLIC_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -n "Checking $file... "
        
        FOUND_IN_FILE=0
        for client in "${CLIENT_NAMES[@]}"; do
            # Use grep to find client names (case-insensitive)
            if grep -qi "$client" "$file"; then
                if [ $FOUND_IN_FILE -eq 0 ]; then
                    echo -e "${RED}✗ Found client names:${NC}"
                    FOUND_IN_FILE=1
                fi
                echo -e "  ${YELLOW}→ Found '$client' in $file${NC}"
                # Show the lines containing the client name
                grep -n -i "$client" "$file" | head -3 | sed 's/^/    /'
                FOUND_ISSUES=1
            fi
        done
        
        if [ $FOUND_IN_FILE -eq 0 ]; then
            echo -e "${GREEN}✓ Clean${NC}"
        fi
    fi
done

echo "================================================"

if [ $FOUND_ISSUES -eq 1 ]; then
    echo -e "${RED}❌ Client names found in public files!${NC}"
    echo ""
    echo "Please replace client names with generic examples:"
    echo "  • Cambro → CONTOSO or ACME_CORP"
    echo "  • VHB → ACME or FABRIKAM"
    echo "  • Christie → EXAMPLE_CO or NORTHWIND"
    echo "  • Oxy → SAMPLE_INC or ADVENTURE_WORKS"
    echo ""
    echo "Generic company names to use:"
    echo "  • ACME, CONTOSO, FABRIKAM, NORTHWIND"
    echo "  • ADVENTURE_WORKS, TAILSPIN, WOODGROVE"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ No client names found in public files${NC}"
    exit 0
fi