# Jaxon Digital - Optimizely DXP MCP Server

[![npm version](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp.svg)](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **PowerShell-based Model Context Protocol (MCP) server** for Optimizely DXP deployment operations, built by [Jaxon Digital](https://www.jaxondigital.com) - your trusted **Optimizely Gold Partner**.

## 🎉 Version 1.2.4 - SDK-Based Implementation

**Latest v1.2.4 Updates:**
- ✅ Added `list_deployments` tool to view all deployments
- ✅ Fixed credential handling with environment variable support
- ✅ Fixed SAS link generation for storage containers
- ✅ Fixed content copy operations between environments
- ✅ Full compatibility with Claude Desktop and Claude Code CLI

## 🚀 About This Project

As an **Optimizely Gold Partner**, Jaxon Digital is committed to giving back to the Optimizely community. This MCP server demonstrates our expertise in:
- **AI-powered development tools** 
- **Optimizely DXP deployment automation**
- **PowerShell-based enterprise solutions**
- **Modern development workflows**

## ✨ Key Features

- 🔄 **Complete Deployment Lifecycle**: Upload → Deploy → Complete → Reset
- 🗄️ **Database Operations**: Export databases as BACPAC files
- 📦 **Content Synchronization**: Sync databases and BLOBs between environments
- 🔗 **Storage Management**: Generate SAS links for BLOB containers
- ⚡ **PowerShell-Only Architecture**: More reliable than direct API calls
- 🛡️ **Enterprise-Grade Error Handling**: Comprehensive error detection and user guidance
- 🎯 **MCP Integration**: Seamlessly works with Claude Code and other MCP clients

## 🏗️ Architecture

This MCP server uses a **PowerShell-only approach** because:
- ✅ PowerShell cmdlets are more reliable than direct API calls
- ✅ Direct API calls often return login pages despite correct HMAC authentication  
- ✅ PowerShell provides better error handling and structured responses
- ✅ Official Optimizely support through the EpiCloud module

## ✅ Compatibility

- **Claude Desktop**: ✅ Full support with v1.2
- **Claude Code CLI**: ✅ Full support with v1.2
- **Other MCP Clients**: ✅ Compatible with any standard MCP client

### Migration from v1.x
If you're upgrading from v1.x, simply reinstall the package:
```bash
npm install -g jaxon-optimizely-dxp-mcp@latest
```

## 📋 Prerequisites

Before using this MCP server, ensure you have:

1. **PowerShell Core (7+)** installed on your system
   ```bash
   # macOS
   brew install powershell
   
   # Windows
   winget install Microsoft.PowerShell
   
   # Linux (Ubuntu/Debian)
   sudo apt update && sudo apt install -y powershell
   ```

2. **EpiCloud PowerShell Module** installed
   ```powershell
   Install-Module EpiCloud -Force
   ```

3. **Optimizely DXP API credentials** (API Key, API Secret, Project ID)
   - Obtain from your Optimizely DXP Portal
   - Ensure credentials have appropriate permissions for deployment operations

## 🚀 Quick Start

### NPM Installation
```bash
npm install -g jaxon-optimizely-dxp-mcp
```

### Configuration

#### Claude Desktop Configuration

Edit your Claude Desktop config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_API_KEY": "your-api-key-here",
        "OPTIMIZELY_API_SECRET": "your-api-secret-here",
        "OPTIMIZELY_PROJECT_ID": "your-project-id-here"
      }
    }
  }
}
```

#### Claude Code CLI Configuration

```bash
# Add the MCP server with environment variables
claude mcp add jaxon-optimizely-dxp-mcp jaxon-optimizely-dxp-mcp
```

Then set environment variables in your shell:
```bash
export OPTIMIZELY_API_KEY="your-api-key-here"
export OPTIMIZELY_API_SECRET="your-api-secret-here"
export OPTIMIZELY_PROJECT_ID="your-project-id-here"
```

#### Alternative: Pass Credentials Per Tool

You can also provide credentials directly when calling each tool:
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp"
  }
}
```

### Manual Installation
```bash
git clone https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp.git
cd jaxon-optimizely-dxp-mcp
npm install
node jaxon-optimizely-dxp-mcp.js
```

### Testing the Server
Use the included interactive client to test functionality:
```bash
# Interactive client with menu-driven interface
node mcp-client.js

# Or test individual operations
node test-storage-interactive.js
```

**Note**: The server may show as "not connected" in `claude mcp list` but will work correctly. This is a known display issue that doesn't affect functionality.

## 🛠️ Available Tools

### Deployment Management
- `list_deployments` - List all deployments for the project
- `upload_deployment_package` - Upload NuGet packages for deployment
- `start_deployment` - Deploy packages or sync content between environments  
- `get_deployment_status` - Monitor deployment progress and status
- `complete_deployment` - Complete deployments (move from staging to live)
- `reset_deployment` - Reset/rollback deployments
- `deploy_package_and_start` - Upload and deploy in one operation

### Database Operations
- `export_database` - Export databases as BACPAC files
- `check_export_status` - Monitor database export progress
- `copy_content` - Sync databases and BLOBs between environments

### Storage Management
- `list_storage_containers` - List available BLOB storage containers
- `generate_storage_sas_link` - Generate SAS URLs for container access

### Logging
- `get_edge_logs` - Retrieve application and edge logs

## 📖 Usage Examples

### List All Deployments
```json
{
  "name": "list_deployments",
  "arguments": {
    "projectId": "your-project-id"
  }
}
```

### Deploy a Package
```json
{
  "name": "start_deployment",
  "arguments": {
    "sourceEnvironment": "Integration",
    "targetEnvironment": "Preproduction",
    "projectId": "your-project-id"
  }
}
```

### Copy Content Between Environments
```json
{
  "name": "copy_content", 
  "arguments": {
    "projectId": "your-project-id", 
    "sourceEnvironment": "Production",
    "targetEnvironment": "Preproduction",
    "includeBlob": true,
    "includeDatabase": true
  }
}
```

### Reset a Deployment
```json
{
  "name": "reset_deployment",
  "arguments": {
    "apiKey": "your-api-key", 
    "apiSecret": "your-api-secret",
    "projectId": "your-project-id",
    "deploymentId": "deployment-guid",
    "includeDbRollback": false
  }
}
```

## 🔧 Environment Support

- **Integration** - Development environment for testing
- **Preproduction** - Staging environment for final validation  
- **Production** - Live environment
- **ADE1-ADE6** - Additional development environments

## 🔍 Troubleshooting

### Claude Code Shows "Failed to connect"
**Known Issue**: When running `claude mcp list`, the server may show as "Failed to connect" even though it's working correctly.

**Solution**: This is a false negative. The server is functional despite this message. You can verify it works by:
1. Testing with the included `mcp-client.js` script
2. Running: `echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node jaxon-optimizely-dxp-mcp.js`

The MCP tools will still be available in Claude Code despite the connection warning.

### PowerShell Module Not Found
If you see errors about the EpiCloud module:
```bash
# Install the module globally
pwsh -c "Install-Module EpiCloud -Force -Scope AllUsers"

# Or for current user only
pwsh -c "Install-Module EpiCloud -Force -Scope CurrentUser"
```

### Permission Errors on macOS/Linux
```bash
# Make the script executable
chmod +x jaxon-optimizely-dxp-mcp.js

# If using global install, might need to reinstall
npm uninstall -g jaxon-optimizely-dxp-mcp
npm install -g jaxon-optimizely-dxp-mcp
```

## 🤝 Contributing

We welcome contributions from the Optimizely community! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🏢 About Jaxon Digital

**Jaxon Digital** is a certified **Optimizely Gold Partner** specializing in:
- Digital experience platform implementations
- AI-powered development solutions  
- Enterprise content management
- E-commerce platform development

Visit us at [www.jaxondigital.com](https://www.jaxondigital.com) to learn more about our services.

## 🆘 Support

- 📋 **Issues**: [GitHub Issues](https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp/issues)
- 📧 **Contact**: [support@jaxondigital.com](mailto:support@jaxondigital.com)
- 🌐 **Website**: [www.jaxondigital.com](https://www.jaxondigital.com)

---

**Powered by Jaxon Digital** - Your trusted Optimizely Gold Partner 🥇