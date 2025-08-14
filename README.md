# Jaxon Digital - Optimizely DXP MCP Server

[![npm version](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp.svg)](https://badge.fury.io/js/jaxon-optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Manage your Optimizely DXP deployments through AI assistants! This MCP (Model Context Protocol) server works with Claude, ChatGPT, or any AI tool that supports MCP. Deploy code, export databases, sync content, and manage your DXP environments through simple conversations.

Built by [Jaxon Digital](https://www.jaxondigital.com) - your trusted **Optimizely Gold Partner** and **AI Solutions Expert**.

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
- "Analyze my deployment package for optimal upload strategy"
- "Split large packages for chunked upload"

No more memorizing PowerShell commands or navigating complex portals!

## ✨ Key Benefits

- **Simple Conversations** - Just tell your AI what you need in plain English
- **Safe Operations** - AI confirms actions before making changes
- **Full Control** - Review and approve all operations
- **Time Saving** - Automate repetitive deployment tasks
- **Error Prevention** - Validates operations before executing

## 🚀 Quick Start

### For Claude Code CLI (Easiest)
```bash
# Install and add in one command
claude mcp add jaxon-optimizely-dxp "npm install -g jaxon-optimizely-dxp-mcp@latest && jaxon-optimizely-dxp-mcp"
```

That's it! Now just tell Claude your project details when you need them:
- "Deploy Integration to Preproduction for project MyWebsite with ID abc-123, key xxx, secret yyy"

### For Claude Desktop
```bash
# First install globally
npm install -g jaxon-optimizely-dxp-mcp@latest

# Then add to Claude Desktop config (see Configuration section)
```

### For Other MCP Clients
```bash
npm install -g jaxon-optimizely-dxp-mcp@latest
```

## 📋 What Gets Installed?

The MCP server requires:
1. **PowerShell Core** - For running Optimizely commands
2. **EpiCloud Module** - Optimizely's official PowerShell module
3. **Node.js 16+** - You already have this if npm works!

Our installer will check for these and provide simple instructions if anything is missing.

### Manual Prerequisites (if automatic install fails)

<details>
<summary>Click here for manual installation steps</summary>

#### PowerShell Core
- **Mac**: `brew install powershell`
- **Windows**: `winget install Microsoft.PowerShell`
- **Linux**: `sudo apt install -y powershell`

#### EpiCloud Module
After installing PowerShell:
```powershell
pwsh -Command "Install-Module -Name EpiCloud -Force"
```
</details>

## 🔑 Using Your Optimizely Credentials

### No Configuration Required!
You can use the MCP without any configuration by providing credentials directly:

```
"List deployments for project 'Production Site' with ID abc-123, key xxx, secret yyy"
```

The MCP will remember projects you use and you can refer to them by name later:
```
"Deploy on Production Site"
```

### What You'll Need (When Ready)
- **Project Name** - A friendly name like "Production Site" or "Dev Environment"
- **Project ID** - UUID from your DXP Portal
- **API Key** - From your DXP Portal
- **API Secret** - From your DXP Portal


## 🔧 Configuration (Optional)

### For Claude Desktop

You can pre-configure projects if you want, but it's not required!

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

Ask Claude: "What MCP tools do you have available?" or "Check your Optimizely configuration"

If you see Optimizely tools listed, you're all set! 🎉

### For Other MCP Clients

The MCP server can be used with any client that supports the Model Context Protocol. The basic configuration requires:

1. **Command**: `jaxon-optimizely-dxp-mcp` (after npm global install)
2. **Environment Variables** (optional):
   - `OPTIMIZELY_PROJECT_ID`: Your project ID
   - `OPTIMIZELY_API_KEY`: Your API key
   - `OPTIMIZELY_API_SECRET`: Your API secret

Consult your MCP client's documentation for specific configuration instructions. The server follows standard MCP protocols and will work with any compliant client.

## 💡 How to Use

### Without Any Configuration
Just provide your project details when needed:
```
"Deploy Integration to Preproduction for project 'My Website' with ID abc-123, key xxx, secret yyy"
```

After using a project once, refer to it by name:
```
"List deployments for My Website"
"Deploy on My Website"
```

### With Pre-Configuration
If you've configured credentials:
```
"List my recent deployments"
"Deploy Integration to Preproduction"
"Export the Production database"
```

### Managing Multiple Projects
```
"List all projects"  # See all projects you've used
"Switch to Production Site"  # Switch active project
"Deploy on Dev Environment"  # Use specific project
```

For advanced configuration options, see the [Multi-Project Configuration Guide](MULTI_PROJECT_CONFIG.md).

## 🛠️ Available Operations

Your AI assistant can help you with all these tasks:

### Deployments
- View all your deployments and their status (with limit support: 1-100)
- Deploy code between environments
- Complete deployments to go live (with verification preview URLs)
- Roll back deployments if needed
- Upload new deployment packages
- Smart deployment defaults (upward = code, downward = content)

### Package Management
- Analyze packages for optimal upload strategy
- Split large packages (>100MB) into chunks
- Generate SAS URLs for direct upload
- Handle multi-GB deployments efficiently

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
- Check deployment status with visual indicators
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


## 🆘 Support & Help

### Need Assistance?
We're here to help! Contact Jaxon Digital's support team:

- 📧 **Email Support**: [hello@jaxondigital.com](mailto:hello@jaxondigital.com)
- 📋 **Report Bugs**: [GitHub Issues](https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp/issues)
- 💬 **General Questions**: [hello@jaxondigital.com](mailto:hello@jaxondigital.com)
- 🌐 **Website**: [www.jaxondigital.com](https://www.jaxondigital.com)

### Common Issues
- **Permission errors**: Try using `sudo npm install -g` or use a Node version manager
- **PowerShell not found**: Install PowerShell Core (`pwsh`)
- **Authentication failures**: Verify your API keys and project ID

### Enterprise Support
For enterprise support plans and custom integrations, contact us at [hello@jaxondigital.com](mailto:hello@jaxondigital.com)

## 📄 License

MIT License - feel free to use this in your projects!

---

**Built with ❤️ by Jaxon Digital** - Your Optimizely Gold Partner 🥇