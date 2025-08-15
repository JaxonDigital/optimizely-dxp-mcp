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
- "Show me my usage analytics and performance metrics"
- "Check my API rate limit status"
- "Clear deployment cache for faster operations"

No more memorizing PowerShell commands or navigating complex portals!

## ✨ Key Benefits

- **Simple Conversations** - Just tell your AI what you need in plain English
- **Safe Operations** - AI confirms actions before making changes
- **Full Control** - Review and approve all operations
- **Time Saving** - Automate repetitive deployment tasks
- **Error Prevention** - Validates operations before executing
- **Performance Optimized** - Intelligent caching and rate limiting
- **Enterprise Ready** - Anonymous telemetry and monitoring tools

## 🚀 Quick Start

### For Claude Code CLI (Easiest)

**Global Installation (Works Everywhere)**
```bash
# Install globally and add to Claude Code
npm install -g jaxon-optimizely-dxp-mcp@latest
claude mcp add jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"
```

**Project-Specific Installation (For One Project)**
```bash
# Navigate to your project directory
cd /path/to/your/project

# Add MCP for this project only
claude mcp add optimizely-local "npx jaxon-optimizely-dxp-mcp@latest"
```

That's it! Now just tell Claude your project details when you need them:
- "Deploy Integration to Preproduction for project MyWebsite with ID abc-123, key xxx, secret yyy"

### For Claude Desktop
```bash
# First install globally
npm install -g jaxon-optimizely-dxp-mcp@latest

# Then add to Claude Desktop config (see Configuration section below)
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

## 🔑 Getting Your Optimizely Credentials

You'll need these from your DXP Portal:
- **Project ID** - UUID from your DXP Portal
- **API Key** - From your DXP Portal → API
- **API Secret** - From your DXP Portal → API

Don't have them yet? No problem! You can still explore the MCP and provide credentials when you're ready.


## 🔧 Configuration

### Claude Code CLI

#### Option 1: No Configuration (Simplest)
Just provide credentials when you need them:

```bash
# Install globally
npm install -g jaxon-optimizely-dxp-mcp@latest
claude mcp add --scope user jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"

# Use with inline credentials
claude "List deployments for Production with ID abc-123, key xxx, secret yyy"
```

After first use, just reference by name:
```bash
claude "Deploy on Production"
```

#### Option 2: Pre-Configure Projects (Recommended)
Set up your projects once for quick access. Edit your global config:

**File location**: `~/.claude.json` or `~/.claude/settings.json`

Add under the `mcpServers` section:
```json
"jaxon-optimizely-dxp": {
  "command": "jaxon-optimizely-dxp-mcp",
  "env": {
    "OPTIMIZELY_PROJECT_ACME_CORP": "id=acme-uuid;key=acme-key;secret=acme-secret;default=true",
    "OPTIMIZELY_PROJECT_CONTOSO": "id=contoso-uuid;key=contoso-key;secret=contoso-secret",
    "OPTIMIZELY_PROJECT_SANDBOX": "id=sandbox-uuid;key=sandbox-key;secret=sandbox-secret"
  }
}
```

Then use without credentials:
```bash
claude "List deployments"  # Uses default (ACME CORP)
claude "Deploy Integration to Preproduction on Contoso"  # Uses Contoso project
claude "Export Production database from Sandbox"  # Uses Sandbox project
```

**💡 Tip:** Always use `--scope user` for global access from any directory.

### Claude Desktop

#### Step 1: Install the MCP
```bash
npm install -g jaxon-optimizely-dxp-mcp@latest
```

#### Step 2: Configure Claude Desktop

Find your config file:
- **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add your configuration:

##### Option 1: No Configuration
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp"
    }
  }
}
```
Provide credentials when needed: "Deploy for Production with ID abc-123, key xxx, secret yyy"

##### Option 2: Multiple Projects (Recommended)
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_ACME_CORP": "id=acme-uuid;key=acme-key;secret=acme-secret;default=true",
        "OPTIMIZELY_PROJECT_CONTOSO": "id=contoso-uuid;key=contoso-key;secret=contoso-secret",
        "OPTIMIZELY_PROJECT_MY_SANDBOX": "id=sandbox-uuid;key=sandbox-key;secret=sandbox-secret"
      }
    }
  }
}
```

#### Step 3: Restart Claude Desktop

Close and reopen Claude Desktop to load the configuration.

#### Step 4: Verify

Ask Claude: "List my Optimizely projects" or "What MCP tools are available?"

### Understanding Projects vs Environments

**Important:** Each Optimizely DXP project has 3 environments:
- **Integration** - Development environment
- **Preproduction** - Testing/staging environment  
- **Production** - Live website

One API key typically gives access to all 3 environments in a project.

### Configuration Format

Each project uses a simple semicolon-separated format:
```
OPTIMIZELY_PROJECT_<NAME>="id=<uuid>;key=<apikey>;secret=<apisecret>"
```

**Parameters:**
- `id` - Your project UUID (required)
- `key` - Your API key (required) - usually works for all 3 environments
- `secret` - Your API secret (required)
- `default=true` - Mark as default project (optional)

**Project Names:**
- Come from the environment variable name
- `OPTIMIZELY_PROJECT_ACME_CORP` → "ACME CORP"
- `OPTIMIZELY_PROJECT_MY_WEBSITE` → "MY WEBSITE" (underscores become spaces)

### Common Configuration Patterns

**For Agencies (Multiple Clients):**
```json
"OPTIMIZELY_PROJECT_CLIENT_A": "id=aaa;key=xxx;secret=yyy",
"OPTIMIZELY_PROJECT_CLIENT_B": "id=bbb;key=xxx;secret=yyy",
"OPTIMIZELY_PROJECT_CLIENT_C": "id=ccc;key=xxx;secret=yyy;default=true"
```

**For Single Company (Multiple Projects):**
```json
"OPTIMIZELY_PROJECT_MAIN_WEBSITE": "id=aaa;key=xxx;secret=yyy;default=true",
"OPTIMIZELY_PROJECT_BLOG": "id=bbb;key=xxx;secret=yyy",
"OPTIMIZELY_PROJECT_SANDBOX": "id=ccc;key=xxx;secret=yyy"
```

For more examples, see [Simple Multi-Project Configuration](SIMPLE_MULTI_PROJECT.md).

## 💡 How to Use

### First Time (Provide Credentials)
```
"Deploy Integration to Preproduction for Acme Corp with ID abc-123, key xxx, secret yyy"
```

### After First Use (Just the Name)
```
"List deployments for Acme Corp"
"Deploy Integration to Production on Acme Corp"
"Export Production database from Acme Corp"
```

### With Pre-Configuration
```
"List deployments"  # Uses default project
"Deploy Integration to Preproduction"  # Deploys within default project
"Deploy on Contoso"  # Uses Contoso project
"Show all projects"  # See configured projects
```

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

### Monitoring & Analytics
- View edge/CDN logs (⚠️ BETA: Requires enablement by Optimizely support)
- Check deployment status with visual indicators
- Monitor operations progress
- Track usage analytics and performance metrics (opt-in)
- Monitor API rate limits and quotas
- View cache status and clear cached data
- Real-time upload progress for large files

## 🌍 Supported Environments

- **Integration** - Your development environment
- **Preproduction** - Testing before going live
- **Production** - Your live website

## 🚀 New in v1.9.0 - Enterprise Features

### Anonymous Telemetry & Analytics (Opt-in)
Track your usage patterns and performance to optimize your workflow:
- **Usage Statistics**: See which tools you use most frequently
- **Performance Metrics**: Monitor deployment times and success rates
- **Error Insights**: Identify common issues for better troubleshooting
- **Complete Privacy**: No sensitive data collected, anonymous usage only
- Enable with: "Enable telemetry" or "Show my analytics"

### Intelligent Rate Limiting
Protect your API quotas while maintaining performance:
- **Per-Project Limits**: 30 requests/minute, 500/hour per project
- **Smart Throttling**: Automatic backoff when approaching limits
- **Burst Protection**: Prevents accidental rapid-fire requests
- **Seamless Integration**: Works transparently with all operations
- Monitor with: "Check my rate limit status"

### Performance Caching
Speed up repeated operations with smart caching:
- **Automatic Caching**: Read operations cached intelligently
- **Smart Invalidation**: Write operations clear related cache
- **Session Persistence**: Cache survives across sessions
- **Per-Project Isolation**: Projects don't share cached data
- Manage with: "Show cache status" or "Clear cache"

### Real-Time Progress Tracking
See progress for large file operations:
- **Upload Progress**: Visual progress bars for files >10MB
- **Speed & ETA**: Real-time speed and time remaining
- **Streaming Updates**: Live feedback during operations

## 📋 Privacy & Data Protection

This MCP server includes optional telemetry that is:
- **Opt-in Only**: Disabled by default, enable only if you want insights
- **Anonymous**: No personal data, credentials, or sensitive information collected
- **Local Storage**: Data stored locally, not transmitted to external services
- **Automatic Cleanup**: Old data automatically deleted after 30 days
- **Enterprise Ready**: Can be completely disabled for corporate environments

See [TELEMETRY.md](TELEMETRY.md) for complete privacy details.

## 🔄 Keeping Updated

### Checking for Updates
The MCP will notify you when new versions are available. To get the latest features:

### Updating to Latest Version
Update manually whenever you want the newest features:

```bash
# Update the global package
npm install -g jaxon-optimizely-dxp-mcp@latest

# Restart Claude Desktop to use the new version
```

### Update Process
For both Claude Desktop and Claude Code CLI:
1. Update the global package with the command above
2. **Restart Claude Desktop** to use the new version (if using Claude Desktop)
3. Claude Code CLI will use the updated version immediately
4. Your existing configuration will work with the new version

### Version Checking
```bash
# Check installed version
jaxon-optimizely-dxp-mcp --version

# Check for updates
npm outdated -g jaxon-optimizely-dxp-mcp
```

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

### Update Issues
If updates aren't working:
1. Check you have proper npm permissions: `npm config get prefix`
2. Try with sudo (if needed): `sudo npm install -g jaxon-optimizely-dxp-mcp@latest`
3. For Claude Desktop, restart the application after updating
4. For Claude Code CLI, the update should work immediately

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

- 📧 **Email Support**: [support@jaxondigital.com](mailto:support@jaxondigital.com)
- 📋 **Report Bugs**: [GitHub Issues](https://github.com/jaxondigital/jaxon-optimizely-dxp-mcp/issues)
- 💬 **General Questions**: [support@jaxondigital.com](mailto:support@jaxondigital.com)
- 🌐 **Website**: [www.jaxondigital.com](https://www.jaxondigital.com)

### Common Issues
- **Permission errors**: Try using `sudo npm install -g` or use a Node version manager
- **PowerShell not found**: Install PowerShell Core (`pwsh`)
- **Authentication failures**: Verify your API keys and project ID
- **"No projects configured"**: Check that your OPTIMIZELY_PROJECT_<NAME> variables are formatted correctly
- **Multiple MCPs showing in Claude Code**: Update to v2.0.0+ and ensure config is in `~/.claude.json`
- **Configuration not loading**: Claude Code uses `~/.claude.json`, Claude Desktop uses its own config file

### Enterprise Support
For enterprise support plans and custom integrations, contact us at [support@jaxondigital.com](mailto:support@jaxondigital.com)

## 📄 License

MIT License - feel free to use this in your projects!

---

**Built with ❤️ by Jaxon Digital** - Your Optimizely Gold Partner 🥇