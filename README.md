# Jaxon Digital - Optimizely DXP MCP Server

[![npm version](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp.svg)](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Manage your Optimizely DXP deployments through AI assistants! This MCP (Model Context Protocol) server works with Claude, ChatGPT, or any AI tool that supports MCP. Deploy code, export databases, sync content, and manage your DXP environments through simple conversations.

Built by [Jaxon Digital](https://www.jaxondigital.com) - your trusted **Optimizely Gold Partner** and **AI Solutions Expert**.

## 🎉 What's New

### 🎨 Enhanced User Experience
- **Project-Centric Interface** - Changed from "server info" to "project info" with project name prominently displayed
- **Project Names in Deployments** - List deployments now shows project name in the header
- **Always Shows Preview URLs** - Preview URLs are prominently displayed for deployments awaiting verification
- **Cleaner Status Display** - Removed technical command references, using friendly language instead
- **Better Action Guidance** - Clear next steps shown for deployments (complete/reset) without technical syntax
- **Improved Progress Indicators** - Visual checkmarks (✅) for completed steps and progress

### 🌟 Major Feature: Multi-Project Support!
- **Manage Multiple Projects** - Switch between projects seamlessly in conversations
- **Project Overrides** - Pass projectId, apiKey, apiSecret to any command
- **Named Projects** - Configure friendly names for your projects
- **Environment Access Control** - Limit which environments each project can access

### 🔧 Additional Improvements
- **Fixed Edge Logs** - Removed environment parameter (applies to entire project)
- **Smart Deployment Defaults** - Automatically detects deployment type based on direction:
  - **Upward** (Int→Pre, Pre→Prod): Deploys CODE
  - **Downward** (Prod→Pre/Int): Copies CONTENT (BLOBs + Database)
- **Deployment Path Validation** - Prevents direct code deployment from Integration to Production
- **Commerce Support** - Specify sourceApps: ["cms", "commerce"] for Commerce projects

## 🤖 Compatible AI Assistants

This MCP server works with:
- **Claude Desktop** - Anthropic's desktop application
- **Claude Code CLI** - Command-line interface for Claude
- **ChatGPT** - When configured with MCP support
- **Any MCP Client** - Any tool that implements the Model Context Protocol

## 🚀 What Can Your AI Assistant Do?

Just ask your AI assistant to help with tasks like:
- "Deploy my code from Integration to Production"
- "Export the Production database for backup"
- "Copy content from Production to Preproduction"
- "Show me recent deployments"
- "Generate a storage link for the media container"
- "Check the status of my deployment"

No more memorizing PowerShell commands or navigating complex portals!

## ✨ Key Benefits

- **Simple Conversations** - Just tell your AI what you need in plain English
- **Safe Operations** - AI confirms actions before making changes
- **Full Control** - Review and approve all operations
- **Time Saving** - Automate repetitive deployment tasks
- **Error Prevention** - Validates operations before executing

## 📋 Prerequisites

You'll need these installed on your computer:

### 1. PowerShell Core
- **Mac**: Open Terminal and run: `brew install powershell`
- **Windows**: Already installed or run: `winget install Microsoft.PowerShell`
- **Linux**: Run: `sudo apt install -y powershell`

### 2. EpiCloud Module
Open PowerShell and run:
```
Install-Module EpiCloud -Force
```

### 3. Your Optimizely Credentials (Optional)
You can set these up now or later:
- Your Project ID
- API Key from your DXP Portal
- API Secret from your DXP Portal

Don't have these yet? No problem! You can still install and your AI assistant will guide you when needed.

## 🚀 Quick Installation

Install from npm in just one command:
```
npm install -g jaxon-optimizely-dxp-mcp
```

### 📚 Advanced Configuration
- **[Multi-Project Setup Guide](MULTI_PROJECT_CONFIG.md)** - Manage multiple Optimizely projects
- **Multiple Environments** - Control access per project
- **Named Projects** - Use friendly names instead of GUIDs

## 🔧 Setup Instructions

### For Claude Desktop

#### Step 1: Find Your Config File

The config file location depends on your system:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Step 2: Add the MCP Server

Open the config file and add this section:

##### Option A: With Saved Credentials (Recommended)
Add this if you want to automatically use your credentials:
```
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_ID": "your-project-id-here",
        "OPTIMIZELY_API_KEY": "your-api-key-here",
        "OPTIMIZELY_API_SECRET": "your-api-secret-here"
      }
    }
  }
}
```

##### Option B: Without Saved Credentials
Add this if you prefer to provide credentials when needed:
```
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp"
    }
  }
}
```

#### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

#### Step 4: Verify It's Working

Ask: "What MCP tools do you have available?" or "Check your Optimizely configuration"

### For Other MCP Clients

The MCP server can be used with any client that supports the Model Context Protocol. The basic configuration requires:

1. **Command**: `jaxon-optimizely-dxp-mcp` (after npm global install)
2. **Environment Variables** (optional):
   - `OPTIMIZELY_PROJECT_ID`: Your project ID
   - `OPTIMIZELY_API_KEY`: Your API key
   - `OPTIMIZELY_API_SECRET`: Your API secret

Consult your MCP client's documentation for specific configuration instructions. The server follows standard MCP protocols and will work with any compliant client.

## 💡 How to Use

### Single Project (Default)
Just ask your AI naturally:
- "List my recent deployments"
- "Deploy Integration to Preproduction"
- "Export the Production database"

### Multiple Projects (New!)
Switch between projects seamlessly:
- "List deployments for project abc-123"
- "Deploy on development project"
- "Copy content on production project"

You can override credentials anytime:
- "Deploy using project: xyz, key: aaa, secret: bbb"

### Check Your Configuration
Ask your AI anytime:
- "What project am I using?"
- "Check my Optimizely configuration"
- "Show me all configured projects"

## 🛠️ Available Operations

Your AI assistant can help you with all these tasks:

### Deployments
- View all your deployments and their status
- Deploy code between environments
- Complete deployments to go live
- Roll back deployments if needed
- Upload new deployment packages

### Databases
- Export databases as backup files
- Copy databases between environments
- Check export progress

### Content & Media
- Copy content between environments
- Sync media files (BLOBs)
- Generate secure links to access storage

### Monitoring
- View edge/CDN logs (⚠️ BETA: Requires enablement by Optimizely support)
- Check deployment status
- Monitor operations progress

## 🌍 Supported Environments

- **Integration** - Your development environment
- **Preproduction** - Testing before going live
- **Production** - Your live website

## 🔍 Troubleshooting

### "PowerShell not found"
Make sure PowerShell Core is installed (see Prerequisites above)

### "EpiCloud module not found"
Open PowerShell and run: `Install-Module EpiCloud -Force`

### "Credentials not configured"
Ask your AI to "check server configuration" for setup instructions

### "Edge logs - Invalid Operation State"
Edge/CDN logs are a **BETA feature** that must be enabled at the project level by Optimizely support. This is not a bug but a configuration requirement. 

To enable:
1. Contact Optimizely support
2. Request Cloudflare log push activation (mention it's a beta feature)
3. Not all projects may be eligible during the beta period

### AI doesn't show the MCP tools
1. Check your config file is valid JSON (for Claude Desktop)
2. Restart your MCP client
3. Ask "What MCP tools are available?"
4. Verify your client supports MCP protocol

## 🏢 About Jaxon Digital

**Jaxon Digital** is a certified **Optimizely Gold Partner** specializing in:
- **Artificial Intelligence Initiatives** - AI-powered solutions for business transformation
- **Optimizely DXP** - Full digital experience platform implementations
- **Optimizely CMS** - Content management and multi-site solutions
- **Optimizely Commerce** - B2B and B2C e-commerce platforms
- **Optimizely Campaign** - Marketing automation and personalization

We help businesses leverage AI and modern technology to transform their digital experiences.

Visit [www.jaxondigital.com](https://www.jaxondigital.com) to learn more.

## 🆘 Need Help?

- 📋 **Report Issues**: [GitHub Issues](https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp/issues)
- 📧 **Email Us**: [support@jaxondigital.com](mailto:support@jaxondigital.com)
- 🌐 **Website**: [www.jaxondigital.com](https://www.jaxondigital.com)

## 📄 License

MIT License - feel free to use this in your projects!

---

**Built with ❤️ by Jaxon Digital** - Your Optimizely Gold Partner 🥇