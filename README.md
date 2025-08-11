# Jaxon Digital - Optimizely DXP MCP Server

[![npm version](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp.svg)](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A **PowerShell-based Model Context Protocol (MCP) server** for Optimizely DXP deployment operations, built by [Jaxon Digital](https://jaxondigital.com) - your trusted **Optimizely Gold Partner**.

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

### MCP Client Configuration
Add to your MCP client configuration (e.g., Claude Code):

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
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

Visit us at [jaxondigital.com](https://jaxondigital.com) to learn more about our services.

## 🆘 Support

- 📋 **Issues**: [GitHub Issues](https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp/issues)
- 📧 **Contact**: [support@jaxondigital.com](mailto:support@jaxondigital.com)
- 🌐 **Website**: [jaxondigital.com](https://jaxondigital.com)

---

**Powered by Jaxon Digital** - Your trusted Optimizely Gold Partner 🥇