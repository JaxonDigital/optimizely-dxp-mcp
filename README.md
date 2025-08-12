# Jaxon Digital - Optimizely DXP MCP Server

[![npm version](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp.svg)](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Manage your Optimizely DXP deployments directly from Claude Desktop! This tool lets Claude help you deploy code, export databases, sync content, and manage your DXP environments through simple conversations.

Built by [Jaxon Digital](https://www.jaxondigital.com) - your trusted **Optimizely Gold Partner**.

## 🎉 What's New in v1.2.9

- ✅ **Simplified Setup** - Credentials are now optional and can be configured later
- ✅ **Better Guidance** - Clear instructions when credentials aren't configured
- ✅ **Smart Detection** - Claude tells you exactly which project you're working with
- ✅ **Flexible Options** - Use with or without saved credentials

## 🚀 What Can Claude Do For You?

Just ask Claude to help with tasks like:
- "Deploy my code from Integration to Production"
- "Export the Production database for backup"
- "Copy content from Production to Preproduction"
- "Show me recent deployments"
- "Generate a storage link for the media container"
- "Check the status of my deployment"

No more memorizing PowerShell commands or navigating complex portals!

## ✨ Key Benefits

- **Simple Conversations** - Just tell Claude what you need in plain English
- **Safe Operations** - Claude confirms actions before making changes
- **Full Control** - Review and approve all operations
- **Time Saving** - Automate repetitive deployment tasks
- **Error Prevention** - Claude validates operations before executing

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
- API Key from your DXP Portal
- API Secret from your DXP Portal  
- Your Project ID

Don't have these yet? No problem! You can still install and Claude will guide you when needed.

## 🚀 Quick Installation

Install from npm in just one command:
```
npm install -g jaxon-optimizely-dxp-mcp
```

## 🔧 Setup for Claude Desktop

### Step 1: Find Your Config File

The config file location depends on your system:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

### Step 2: Add the MCP Server

Open the config file and add this section:

#### Option A: With Saved Credentials (Recommended)
Add this if you want Claude to automatically use your credentials:
```
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

#### Option B: Without Saved Credentials
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

### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop to load the new configuration.

### Step 4: Verify It's Working

Ask Claude: "What MCP tools do you have available?" or "Check your Optimizely configuration"

Claude will use the `get_server_info` tool to show you:
- Whether credentials are configured
- Which project is active
- How to set up credentials if needed

## 💡 How to Use

### When Credentials Are Saved
Just ask Claude naturally:
- "List my recent deployments"
- "Deploy Integration to Preproduction"
- "Export the Production database"

### When Credentials Aren't Saved
Claude will ask for them when needed, or you can provide them:
- "List deployments for project abc-123 using my credentials (key: xxx, secret: yyy)"

### Check Your Configuration
Ask Claude anytime:
- "What project am I using?"
- "Check my Optimizely configuration"
- "Are my credentials set up?"

## 🛠️ Available Operations

Claude can help you with all these tasks:

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
- View application logs
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
Ask Claude to "check server configuration" for setup instructions

### Claude Desktop doesn't show the tools
1. Check your config file is valid JSON
2. Restart Claude Desktop
3. Ask Claude "What MCP tools are available?"

## 🏢 About Jaxon Digital

**Jaxon Digital** is a certified **Optimizely Gold Partner** helping businesses succeed with:
- Digital experience platforms
- E-commerce solutions
- Content management systems
- Marketing automation

Visit [www.jaxondigital.com](https://www.jaxondigital.com) to learn more.

## 🆘 Need Help?

- 📋 **Report Issues**: [GitHub Issues](https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp/issues)
- 📧 **Email Us**: [support@jaxondigital.com](mailto:support@jaxondigital.com)
- 🌐 **Website**: [www.jaxondigital.com](https://www.jaxondigital.com)

## 📄 License

MIT License - feel free to use this in your projects!

---

**Built with ❤️ by Jaxon Digital** - Your Optimizely Gold Partner 🥇