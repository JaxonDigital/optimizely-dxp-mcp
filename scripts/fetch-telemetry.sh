#!/bin/bash

# Jaxon Digital MCP Telemetry Fetcher
# Fetches and analyzes telemetry data from the server
#
# Usage:
#   ./fetch-telemetry.sh                    # Interactive mode
#   ./fetch-telemetry.sh <ssh-host>         # Fetch from specific server
#   ./fetch-telemetry.sh --local <dir>      # Parse local directory

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PARSER_SCRIPT="$SCRIPT_DIR/parse-telemetry.js"
TEMP_DIR="/tmp/mcp-telemetry-$$"

# Cleanup on exit
cleanup() {
    if [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

# Print header
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📊 Jaxon Digital MCP Telemetry Analyzer${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Check if parser script exists
if [ ! -f "$PARSER_SCRIPT" ]; then
    echo -e "${RED}❌ Parser script not found: $PARSER_SCRIPT${NC}"
    exit 1
fi

# Function to fetch telemetry from server
fetch_from_server() {
    local SSH_HOST=$1
    local REMOTE_PATH=${2:-"/home/site/wwwroot/App_Data/Telemetry"}
    
    echo -e "${YELLOW}🔌 Connecting to: $SSH_HOST${NC}"
    echo -e "${YELLOW}📂 Remote path: $REMOTE_PATH${NC}"
    echo
    
    # Create temp directory
    mkdir -p "$TEMP_DIR"
    
    # Check if we can connect
    if ! ssh -o ConnectTimeout=5 "$SSH_HOST" "ls $REMOTE_PATH" &>/dev/null; then
        echo -e "${RED}❌ Cannot connect to server or path not found${NC}"
        echo -e "${YELLOW}💡 Tips:${NC}"
        echo "   - Ensure SSH access is configured"
        echo "   - Check if the remote path exists"
        echo "   - Default path: /home/site/wwwroot/App_Data/Telemetry"
        echo "   - Azure App Service: Use Kudu SSH or Azure CLI"
        exit 1
    fi
    
    # Count files
    FILE_COUNT=$(ssh "$SSH_HOST" "ls -1 $REMOTE_PATH/mcp-telemetry-*.json 2>/dev/null | wc -l" || echo "0")
    
    if [ "$FILE_COUNT" -eq "0" ]; then
        echo -e "${YELLOW}⚠️  No telemetry files found on server${NC}"
        exit 0
    fi
    
    echo -e "${GREEN}✅ Found $FILE_COUNT telemetry files${NC}"
    echo
    
    # Download files
    echo -e "${YELLOW}📥 Downloading telemetry files...${NC}"
    scp -q "$SSH_HOST:$REMOTE_PATH/mcp-telemetry-*.json" "$TEMP_DIR/"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Download complete${NC}"
        echo
        
        # Parse the data
        node "$PARSER_SCRIPT" "$TEMP_DIR"
    else
        echo -e "${RED}❌ Failed to download files${NC}"
        exit 1
    fi
}

# Function to parse local directory
parse_local() {
    local LOCAL_DIR=$1
    
    if [ ! -d "$LOCAL_DIR" ]; then
        echo -e "${RED}❌ Directory not found: $LOCAL_DIR${NC}"
        exit 1
    fi
    
    node "$PARSER_SCRIPT" "$LOCAL_DIR"
}

# Function to fetch from Azure App Service using Azure CLI
fetch_from_azure() {
    local RESOURCE_GROUP=$1
    local APP_NAME=$2
    
    echo -e "${YELLOW}🔌 Connecting to Azure App Service${NC}"
    echo -e "${YELLOW}📱 App: $APP_NAME (Resource Group: $RESOURCE_GROUP)${NC}"
    echo
    
    # Check if Azure CLI is installed
    if ! command -v az &> /dev/null; then
        echo -e "${RED}❌ Azure CLI not installed${NC}"
        echo "   Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    fi
    
    # Check if logged in
    if ! az account show &>/dev/null; then
        echo -e "${YELLOW}🔐 Please login to Azure:${NC}"
        az login
    fi
    
    # Create temp directory
    mkdir -p "$TEMP_DIR"
    
    # Get Kudu URL
    KUDU_URL=$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query "hostNameSslStates[?name == '$APP_NAME.scm.azurewebsites.net'].name" -o tsv)
    
    if [ -z "$KUDU_URL" ]; then
        echo -e "${RED}❌ Could not get Kudu URL for app${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Connected to: https://$KUDU_URL${NC}"
    
    # Use Azure CLI to run command in app
    echo -e "${YELLOW}📥 Fetching telemetry files...${NC}"
    
    # List and download files using Kudu API
    ACCESS_TOKEN=$(az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv)
    
    # Download files via Kudu ZIP API
    curl -s -H "Authorization: Bearer $ACCESS_TOKEN" \
         "https://$KUDU_URL/api/zip/site/wwwroot/App_Data/Telemetry/" \
         -o "$TEMP_DIR/telemetry.zip"
    
    if [ -f "$TEMP_DIR/telemetry.zip" ]; then
        unzip -q "$TEMP_DIR/telemetry.zip" -d "$TEMP_DIR"
        rm "$TEMP_DIR/telemetry.zip"
        
        echo -e "${GREEN}✅ Download complete${NC}"
        echo
        
        # Parse the data
        node "$PARSER_SCRIPT" "$TEMP_DIR"
    else
        echo -e "${RED}❌ Failed to download telemetry files${NC}"
        echo -e "${YELLOW}💡 Make sure the App_Data/Telemetry directory exists${NC}"
        exit 1
    fi
}

# Main logic
if [ $# -eq 0 ]; then
    # Interactive mode
    echo "Choose an option:"
    echo "  1) Fetch from SSH server"
    echo "  2) Fetch from Azure App Service"
    echo "  3) Parse local directory"
    echo
    read -p "Option (1-3): " OPTION
    
    case $OPTION in
        1)
            read -p "SSH Host (user@host): " SSH_HOST
            read -p "Remote path [/home/site/wwwroot/App_Data/Telemetry]: " REMOTE_PATH
            REMOTE_PATH=${REMOTE_PATH:-"/home/site/wwwroot/App_Data/Telemetry"}
            fetch_from_server "$SSH_HOST" "$REMOTE_PATH"
            ;;
        2)
            read -p "Resource Group: " RESOURCE_GROUP
            read -p "App Name: " APP_NAME
            fetch_from_azure "$RESOURCE_GROUP" "$APP_NAME"
            ;;
        3)
            read -p "Local directory path: " LOCAL_DIR
            parse_local "$LOCAL_DIR"
            ;;
        *)
            echo -e "${RED}Invalid option${NC}"
            exit 1
            ;;
    esac
elif [ "$1" == "--local" ]; then
    # Parse local directory
    parse_local "$2"
elif [ "$1" == "--azure" ]; then
    # Azure mode
    fetch_from_azure "$2" "$3"
elif [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    # Show help
    echo "Usage:"
    echo "  $0                                    # Interactive mode"
    echo "  $0 <ssh-host> [remote-path]          # Fetch from SSH server"
    echo "  $0 --local <directory>                # Parse local directory"
    echo "  $0 --azure <resource-group> <app>    # Fetch from Azure App Service"
    echo
    echo "Examples:"
    echo "  $0 user@server.com"
    echo "  $0 user@server.com /var/www/App_Data/Telemetry"
    echo "  $0 --local ./telemetry-logs"
    echo "  $0 --azure myResourceGroup myAppName"
else
    # SSH mode
    fetch_from_server "$1" "$2"
fi

echo
echo -e "${GREEN}✨ Analysis complete!${NC}"
echo