# Jaxon Digital - Optimizely DXP MCP Server Installation Guide

This guide will help you install and configure the Jaxon Digital Optimizely DXP MCP Server for use in your projects.

## Prerequisites

### System Requirements
- Node.js 18.0 or later
- npm (comes with Node.js)
- PowerShell Core (pwsh) 7.0 or later
- Windows, macOS, or Linux
- MCP-compatible client (Claude Desktop, or custom MCP client)

### PowerShell Module
- Install the EpiCloud module: `Install-Module EpiCloud -Force`

## Installation

### Option 1: Direct Installation

1. **Clone or download the source code** to your desired location:
   ```bash
   git clone https://github.com/JaxonDigital/optimizely-dxp-mcp-private.git
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
   node jaxon-optimizely-dxp-mcp.js
   ```
   The server should start and wait for MCP protocol messages on stdin.

### Option 2: Global Installation (Future)

Once published to npm, you'll be able to install globally:

```bash
npm install -g jaxon-optimizely-dxp-mcp
```

### Option 3: Using npx (Future)

```bash
npx jaxon-optimizely-dxp-mcp
```

## MCP Client Configuration

### Claude Desktop Configuration

Add the server to your Claude Desktop configuration file:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "node",
      "args": ["jaxon-optimizely-dxp-mcp.js"],
      "cwd": "/path/to/deployment-mcp"
    }
  }
}
```

Or if installed globally (future):

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp"
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
   node jaxon-optimizely-dxp-mcp.js
   ```

2. **Send a test MCP message**:
   ```bash
   echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | node jaxon-optimizely-dxp-mcp.js
   ```

   Expected response should include all available tools.

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

### Database Operations
- **export_database**: Exports a database from a DXP environment in BACPAC format
- **check_export_status**: Monitors export progress and retrieves download links

### Storage Operations  
- **list_storage_containers**: Lists all storage containers for the project
- **get_storage_sas_link**: Generates a SAS link for BLOB container access

### Deployment Operations
- **upload_package**: Uploads a deployment package to DXP
- **start_deployment**: Starts a deployment to a target environment
- **get_deployment_status**: Gets the status of a running deployment
- **complete_deployment**: Completes a deployment from staging to production
- **reset_deployment**: Resets/rolls back a deployment
- **start_content_copy**: Synchronizes content between environments

### Monitoring
- **get_edge_logs**: Retrieves CDN edge logs (when enabled)

### Testing
- **test_connection**: Verifies API credentials and connectivity

## Troubleshooting

### Common Issues

1. **"command not found: node"**
   - Install Node.js 18.0 or later from https://nodejs.org

2. **"command not found: pwsh"**
   - Install PowerShell Core from https://github.com/PowerShell/PowerShell
   - macOS: `brew install --cask powershell`
   - Linux: Follow distribution-specific instructions
   - Windows: Comes pre-installed on Windows 10/11

3. **"EpiCloud module not found"**
   - Run: `Install-Module EpiCloud -Force`
   - May require running PowerShell as Administrator

4. **MCP client can't find the server**
   - Check the path in your MCP client configuration
   - Ensure Node.js is installed and accessible
   - Verify the server starts successfully with `node jaxon-optimizely-dxp-mcp.js`

5. **JSON parsing errors**
   - Ensure MCP messages are single-line JSON (no newlines)
   - Check that your MCP client sends proper JSON-RPC 2.0 format

6. **"Operation already in progress" errors**
   - DXP only allows one operation at a time per environment
   - Wait for current operation to complete before starting another

### Logs and Debugging

The server outputs MCP protocol messages and errors to stderr. Monitor the console output when running to diagnose issues.

## File Structure

```
deployment-mcp/
├── jaxon-optimizely-dxp-mcp.js   # Main server executable
├── lib/
│   ├── config.js                 # Configuration and constants
│   ├── error-handler.js          # Error detection and handling
│   ├── powershell-helper.js      # PowerShell execution wrapper
│   ├── response-builder.js       # JSON-RPC response formatting
│   └── tools/
│       ├── database-tools.js     # Database export operations
│       ├── deployment-tools.js   # Deployment management
│       ├── logging-tools.js      # Edge log retrieval
│       ├── package-tools.js      # Package upload
│       └── storage-tools.js      # BLOB storage operations
└── package.json
```

## Key Advantages of PowerShell-Based Architecture

- **Official Support**: Uses Optimizely's official EpiCloud PowerShell module
- **Reliability**: More stable than direct API calls which often return login pages
- **Better Error Handling**: PowerShell cmdlets provide structured error responses
- **Cross-platform**: PowerShell Core runs on Windows, macOS, and Linux
- **Complete Feature Set**: Access to all DXP operations through official cmdlets

## Security Considerations

- API credentials are passed as parameters and not stored by the server
- Ensure your MCP client configuration file has appropriate permissions
- Downloaded backup files may contain sensitive data - secure them appropriately
- Never commit API credentials to version control
- Use environment-specific credentials (don't use Production credentials for testing)

## About Jaxon Digital

Jaxon Digital is an Optimizely Gold Partner specializing in digital experience platforms and AI-powered development tools. Learn more at [www.jaxondigital.com](https://www.jaxondigital.com).

This MCP server is our contribution to the Optimizely community, showcasing how AI tools can streamline DXP operations.