# Optimizely DXP MCP Server - Installation Guide

This guide will help you install and configure the Optimizely DXP MCP Server for use in your projects.

## Prerequisites

### System Requirements
- Node.js 18.0 or later
- npm (comes with Node.js)
- Windows, macOS, or Linux
- MCP-compatible client (Claude Desktop, or custom MCP client)

## Installation

### Option 1: Direct Installation

1. **Clone or download the source code** to your desired location:
   ```bash
   git clone <your-repo-url>
   # OR extract from zip file
   ```

2. **Navigate to the project directory**:
   ```bash
   cd deployment-mcp
   ```

3. **Install dependencies** (if any are added later):
   ```bash
   npm install
   ```

4. **Test the installation**:
   ```bash
   node index.js
   ```
   The server should start and wait for MCP protocol messages on stdin.

### Option 2: Global Installation (Future)

Once published to npm, you'll be able to install globally:

```bash
npm install -g optimizely-mcp-server
```

### Option 3: Using npx (Future)

```bash
npx optimizely-mcp-server
```

## MCP Client Configuration

### Claude Desktop Configuration

Add the server to your Claude Desktop configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "node",
      "args": ["index.js"],
      "cwd": "/path/to/deployment-mcp"
    }
  }
}
```

Or if installed globally (future):

```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "optimizely-mcp-server"
    }
  }
}
```

### Custom MCP Client Configuration

For custom MCP clients, configure the server as a subprocess that communicates via stdin/stdout using the MCP protocol (JSON-RPC 2.0).

## Getting Optimizely DXP API Credentials

Before using the server, you'll need API credentials from your Optimizely DXP project:

1. Log in to the DXP management portal at https://paasportal.episerver.net
2. Navigate to your project
3. Go to the "API" tab
4. Click "Add API Credentials" and provide a name
5. Copy the generated ClientKey and ClientSecret
6. Note your Project ID (found in the project URL or settings)

## Verification

### Test the Server

1. **Start the server**:
   ```bash
   node index.js
   ```

2. **Send a test MCP message**:
   ```bash
   echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | node index.js
   ```

   Expected response should include the available tools (`export_database` and `check_export_status`).

### Test with Claude Desktop

1. Restart Claude Desktop after updating the configuration
2. Start a new conversation
3. Ask Claude to list available tools
4. You should see the Optimizely DXP tools available

### Test Database Export

Try exporting a database to verify full functionality:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "export_database",
    "arguments": {
      "apiKey": "your-api-key",
      "apiSecret": "your-api-secret",
      "projectId": "your-project-id",
      "environment": "Integration",
      "databaseName": "epicms",
      "retentionHours": 24
    }
  }
}
```

## Available Tools

Once installed, the server provides these tools:

### export_database
Exports a database from a DXP environment in bacpac format.
- **Parameters**: apiKey, apiSecret, projectId, environment, databaseName, retentionHours
- **Returns**: Operation ID for tracking the export

### check_export_status
Monitors export progress and auto-downloads completed files.
- **Parameters**: apiKey, apiSecret, projectId, environment, databaseName, exportId
- **Returns**: Status information and download confirmation

## Troubleshooting

### Common Issues

1. **"command not found: node"**
   - Install Node.js 18.0 or later from https://nodejs.org

2. **"403 Forbidden" errors on status checks**
   - This is a known limitation with the Optimizely DXP API
   - Export initiation works, but status checking has API permission restrictions
   - Use the DXP portal or PowerShell EpiCloud module for status updates

3. **MCP client can't find the server**
   - Check the path in your MCP client configuration
   - Ensure Node.js is installed and accessible
   - Verify the server starts successfully with `node index.js`

4. **JSON parsing errors**
   - Ensure MCP messages are single-line JSON (no newlines)
   - Check that your MCP client sends proper JSON-RPC 2.0 format

### Logs and Debugging

The server outputs MCP protocol messages and errors to stderr. Monitor the console output when running to diagnose issues.

## File Structure

After installation, downloaded database exports will be stored in the `_bak/` directory within the server's working directory.

## Key Advantages of Node.js Version

- **Easy Installation**: No .NET SDK required, just Node.js
- **Lightweight**: Smaller footprint and faster startup
- **Cross-platform**: Works consistently across Windows, macOS, and Linux
- **No PowerShell Dependency**: Handles API limitations gracefully
- **Better Error Messages**: Clearer guidance when API restrictions are encountered

## Security Considerations

- API credentials are passed as parameters and not stored by the server
- Ensure your MCP client configuration file has appropriate permissions
- Downloaded backup files may contain sensitive data - secure them appropriately