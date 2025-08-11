#!/bin/bash

# Install Optimizely MCP Server to any project directory
# Usage: ./install-to-project.sh /path/to/your/project

if [ -z "$1" ]; then
    echo "Usage: $0 <target-directory>"
    echo "Example: $0 /path/to/your/project"
    exit 1
fi

TARGET_DIR="$1"

if [ ! -d "$TARGET_DIR" ]; then
    echo "Error: Directory $TARGET_DIR does not exist"
    exit 1
fi

echo "Installing Optimizely MCP Server to $TARGET_DIR..."

# Copy the standalone server
cp optimizely-mcp-server.js "$TARGET_DIR/"

# Create MCP configuration
cat > "$TARGET_DIR/mcp.json" << 'EOF'
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "node",
      "args": ["optimizely-mcp-server.js"]
    }
  }
}
EOF

echo "✅ Installation complete!"
echo ""
echo "Files installed:"
echo "  - $TARGET_DIR/optimizely-mcp-server.js"
echo "  - $TARGET_DIR/mcp.json"
echo ""
echo "To test:"
echo "  cd $TARGET_DIR"
echo "  echo '{\"jsonrpc\": \"2.0\", \"id\": 1, \"method\": \"tools/list\", \"params\": {}}' | node optimizely-mcp-server.js"