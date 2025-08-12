# Jaxon Digital - Optimizely DXP MCP Server

[![npm version](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp.svg)](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **PowerShell-based Model Context Protocol (MCP) server** for Optimizely DXP deployment operations, built by [Jaxon Digital](https://www.jaxondigital.com) - your trusted **Optimizely Gold Partner**.

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

## 🚀 Quick Start

### NPM Installation
```bash
npm install -g jaxon-optimizely-dxp-mcp
```

### Claude Code Configuration

#### Using Claude CLI
```bash
# Add the MCP server to Claude Code
claude mcp add jaxon-optimizely-dxp-mcp jaxon-optimizely-dxp-mcp

# Or use the full node path if needed
claude mcp add jaxon-optimizely-dxp-mcp node /path/to/jaxon-optimizely-dxp-mcp.js
```

#### Manual Configuration
Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp-mcp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "args": []
    }
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
- `upload_deployment_package` - Upload NuGet packages for deployment
- `start_deployment` - Deploy packages or sync content between environments  
- `get_deployment_status` - Monitor deployment progress and status
- `complete_deployment` - Complete deployments (move from staging to live)
- `reset_deployment` - Reset/rollback deployments

### Database Operations
- `export_database` - Export databases as BACPAC files
- `check_export_status` - Monitor database export progress
- `copy_content` - Sync databases and BLOBs between environments

### Storage Management
- `list_storage_containers` - List available BLOB storage containers
- `generate_storage_sas_link` - Generate SAS URLs for container access

## 📖 Usage Examples

### Deploy a Package
```json
{
  "name": "start_deployment",
  "arguments": {
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret", 
    "projectId": "your-project-id",
    "targetEnvironment": "Integration",
    "packages": ["mysite.cms.app.1.0.0.nupkg"],
    "directDeploy": false,
    "useMaintenancePage": true
  }
}
```

### Copy Content Between Environments
```json
{
  "name": "copy_content", 
  "arguments": {
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret",
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