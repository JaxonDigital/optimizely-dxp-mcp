# Optimizely DXP MCP Server

[![npm version](https://img.shields.io/npm/v/@jaxon-digital/optimizely-dxp-mcp.svg)](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dt/@jaxon-digital/optimizely-dxp-mcp.svg)](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)

**AI-powered automation for Optimizely DXP.** Deploy code, manage environments, and handle databases through natural language.

## Quick Start (2 minutes)

```bash
# Install globally
npm install -g @jaxon-digital/optimizely-dxp-mcp@latest

# Add to Claude Desktop or Claude Code
claude mcp add optimizely "@jaxon-digital/optimizely-dxp-mcp"

# Test your setup
claude "Run setup wizard for Optimizely"
```

## What Can It Do?

### Simple Commands

| Command | What it does |
|---------|-------------|
| `deploy to production` | Smart deploy from preproduction with progress tracking |
| `export database` | Export production database (defaults to prod, auto-monitoring enabled) |
| `status` | Show all deployments with suggestions |
| `rollback production` | Emergency rollback for failed deployments |
| `quick` | Ultra-fast status check |
| `download blobs` | Download all media/assets from production storage |
| `download logs` | Download Application Insights logs from production |
| `set download path` | Configure where downloads are saved |

### Natural Language Operations
- "Deploy staging to production"
- "Show deployment dashboard"
- "Export production database with auto-download"
- "Copy production content down to integration"
- "Check deployment status for project Acme"
- "Download production blobs"
- "Download media files from staging"
- "Get all assets from production"
- "Download application logs"
- "Get logs from production for today"
- "Export Application Insights logs"

No PowerShell commands or portal navigation required.

## Key Features

### Capabilities

**Deployment Operations**
- Deploy code and content between environments
- **Azure DevOps CI/CD integration** with dual API support
- Monitor deployments with real-time progress tracking
- Smart rollback for failed deployments
- Handle large packages (>100MB) intelligently
- Natural language commands with smart defaults

**Database Management**
- Export and import databases with smart defaults
- **Smart export detection** - Automatically finds and reuses recent backups
- Auto-download database exports when complete (enabled by default)
- Monitor export progress and status automatically 
- List recent export history

**Blob Storage Management**
- Download entire blob containers from Azure Storage
- Smart path detection for project-specific blob directories
- Natural language support: "download blobs", "download media", "download assets"
- Cross-platform compatible with automatic path resolution
- Defaults to production environment for blob downloads
- Progress tracking for large blob containers

**Application Insights Log Management**
- Download Application Insights logs from Azure Storage containers
- Supports application logs and web server logs (90-day retention)
- Date filtering for specific time periods (e.g., "2025/08/24")
- Smart path detection for log directories
- Natural language support: "download logs", "get application insights logs"
- Defaults to production environment for log downloads

**Project Management**
- Manage multiple projects seamlessly
- Dynamic project switching
- Per-project API key configuration
- Automatic credential validation

**Performance & Reliability**
- Smart retry with exponential backoff
- Rate limiting protection (30 req/min per project)
- Intelligent caching for read operations
- Setup wizard for first-time configuration

**User Settings & Preferences**
- Configurable download paths for exports and blobs
- Persistent settings across sessions (stored in ~/.optimizely-mcp)
- Support for relative, absolute, and home directory paths
- Auto-download toggles and monitoring intervals
- Settings management commands: get_settings, set_download_path, reset_settings

## Download Capabilities

The MCP provides comprehensive download functionality for all your DXP assets:

### What You Can Download

**📦 Blob Storage / Media Assets**
- All images, documents, and media files from Azure Storage
- Automatic container detection (mysitemedia, publicmedia, etc.)
- Preserves folder structure during download
- Smart path detection finds optimal local directories

**📊 Application Insights Logs**
- Application logs with detailed diagnostics
- Web server (IIS) access logs
- 90-day retention window
- Date filtering for specific periods
- Organized by date/time structure

**🗄️ Database Exports**
- Production, Preproduction, or Integration databases
- .bacpac format for SQL Server
- Smart detection of recent backups
- Auto-download with progress tracking

### Smart Path Detection

The MCP automatically determines the best download location:
- Checks for existing project directories
- Creates organized folder structures
- Supports custom paths via settings
- Cross-platform compatible (Windows/Mac/Linux)

### Persistent Settings

Configure once, use everywhere:
```bash
# Set your preferred download location
claude "set download path to ~/Downloads/optimizely"

# All future downloads will use this path:
# - Database exports → ~/Downloads/optimizely/backups
# - Blob downloads → ~/Downloads/optimizely/blobs
# - Log downloads → ~/Downloads/optimizely/logs
```

Settings are stored in `~/.optimizely-mcp/settings.json` and persist across sessions.

## AI Agent & Workflow Automation

This MCP is perfect for always-on AI agents and automated workflows on platforms like:

**Workflow Platforms**
- **n8n**: Create visual workflows that trigger deployments based on events
- **Zapier/Make**: Connect DXP operations to 1000+ apps
- **GitHub Actions**: Automate deployments in CI/CD pipelines
- **Jenkins**: Integrate with existing DevOps pipelines

**AI Agent Platforms**
- **LangChain/LlamaIndex**: Build custom AI agents with DXP capabilities
- **AutoGPT/AgentGPT**: Enable autonomous deployment management
- **Custom GPTs**: Create specialized deployment assistants
- **Slack/Teams Bots**: Deploy via chat commands

**Example Use Cases**
- Auto-deploy after successful test runs
- Schedule content syncs during off-hours
- Trigger rollbacks on monitoring alerts
- Create approval workflows for production deployments
- Generate deployment reports and analytics

The MCP's JSON-RPC interface makes it easy to integrate with any platform that can make HTTP requests or run Node.js processes.

## 🔗 Azure DevOps Integration (Advanced)

**Deploy directly from Azure DevOps build artifacts to Optimizely DXP environments.**

Perfect for CI/CD pipelines and automated workflows - no manual package handling required.

**⚠️ Prerequisites:** You must first configure basic Optimizely DXP access (see Configuration section above) before using Azure DevOps integration. This feature downloads artifacts from Azure DevOps and deploys them to your configured DXP environments.

### Configuration Options

**Option 1: Environment Variables (Recommended for CI/CD)**
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_API_KEY": "your-optimizely-key",
        "OPTIMIZELY_API_SECRET": "your-optimizely-secret", 
        "OPTIMIZELY_PROJECT_ID": "your-project-id",
        "AZURE_DEVOPS_PAT": "your-azure-devops-token",
        "AZURE_DEVOPS_ORG": "your-organization",
        "AZURE_DEVOPS_PROJECT": "your-project"
      }
    }
  }
}
```

Then deploy with just the artifact URL:
```bash
claude "deploy Azure artifact to production" \
  --artifact-url "https://dev.azure.com/org/_apis/resources/Containers/12345/drop"
```

**Option 2: Inline Configuration (No environment setup required)**
```bash
# Pass all parameters directly - perfect for agent workflows
claude "deploy Azure artifact to production" \
  --artifact-url "https://dev.azure.com/myorg/_apis/resources/Containers/12345/drop" \
  --azure-devops-pat "your-token" \
  --azure-devops-org "myorg" \
  --azure-devops-project "myproject"
```

### Supported Azure DevOps APIs
- **Resources API** (Recommended): `https://dev.azure.com/{org}/_apis/resources/Containers/{id}/drop`
- **Build API**: `https://dev.azure.com/{org}/{project}/_apis/build/builds/{id}/artifacts`

### Agent Workflow Examples

**Webhook-Triggered Deployment (n8n/Zapier/Make)**
```
1. Azure DevOps build completes → Sends webhook
2. Agent receives webhook with artifact URL  
3. Agent downloads package from Azure DevOps
4. Agent deploys to Optimizely DXP environment
5. Agent monitors deployment progress
6. Agent sends completion notification
```

**n8n Webhook Workflow:**
```json
{
  "nodes": [
    {
      "name": "Azure Webhook",
      "type": "n8n-nodes-base.webhook",
      "parameters": {
        "path": "azure-build-complete"
      }
    },
    {
      "name": "Deploy to DXP",
      "type": "n8n-nodes-base.executeCommand", 
      "parameters": {
        "tool": "deploy_azure_artifact",
        "arguments": {
          "artifactUrl": "{{$node['Azure Webhook'].json['resource']['downloadUrl']}}",
          "azureDevOpsPat": "{{$credentials.azureDevOps.pat}}",
          "targetEnvironment": "Integration"
        }
      }
    }
  ]
}
```

**GitHub Actions:**
```yaml
- name: Deploy to DXP
  run: |
    claude deploy_azure_artifact \
      --artifact-url "${{ env.AZURE_ARTIFACT_URL }}" \
      --azure-devops-pat "${{ secrets.AZURE_DEVOPS_PAT }}" \
      --target-environment "Production"
```

**Zapier/Make Automation:**
- **Trigger**: Azure DevOps build completion webhook
- **Action**: Call Claude with `deploy_azure_artifact` tool
- **Result**: Fully automated deployment pipeline

## Prerequisites
- **Node.js** 20+
- **PowerShell Core** (installs automatically)
- **Optimizely DXP** project with API access

## Understanding DXP Environments
Every Optimizely DXP project has exactly **3 environments**:
- **Integration** - Development/testing environment
- **Preproduction** - Staging environment  
- **Production** - Live website

The MCP accepts common aliases: `dev`→Integration, `staging`→Preproduction, `prod`→Production

## Getting API Credentials
1. Log in to [Optimizely DXP Portal](https://paasportal.episerver.net/)
2. Navigate: Organization → Your Project → API tab
3. Click "Add API Credentials"
4. Select environments to grant access (typically all three)
5. Copy these values:
   - **Project ID**: UUID format (e.g., `abc12345-...`)
   - **API Key**: Your access key
   - **API Secret**: Your secret key

## Configuration

### Option 1: No Config (Simplest)
Provide credentials inline:
```bash
claude "Deploy for project MyProject with id abc-123, key YOUR_KEY, secret YOUR_SECRET"
```
The MCP remembers credentials for the session.

### Option 2: Environment Variables
Edit Claude's config (`~/.claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "MY_PROJECT": "id=abc-123;key=YOUR_KEY;secret=YOUR_SECRET"
      }
    }
  }
}
```

### Option 3: Multiple Projects
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "ACME_CORP": "id=abc-123;key=KEY1;secret=SECRET1;default=true",
        "CONTOSO": "id=def-456;key=KEY2;secret=SECRET2",
        "FABRIKAM": "id=ghi-789;key=KEY3;secret=SECRET3"
      }
    }
  }
}
```

Then use: `claude "deploy to production for Acme"`


## Common Workflows

### Deploy Code
```bash
# Simple deployment
claude "deploy to production"
# → Automatically deploys from Preproduction
# → Shows progress and ETA
# → Provides verification URL when ready

# Complete verification
claude "complete deployment"
```

### Database Export
```bash
# Basic export (auto-monitoring enabled by default)
claude "export production database"
# → Checks for recent backups first (< 1 hour auto-uses)
# → Creates .bacpac export with automatic monitoring
# → Downloads automatically when ready

# Force a fresh backup (skip recent backup check)
claude "backup database --force-new"
# → Always creates new backup, ignoring existing ones

# Use any recent backup (up to 24 hours old)
claude "backup database --use-existing"
# → Uses existing backup if found within 24 hours

# Manual monitoring only
claude "export database --auto-download false"
# → Disables automatic monitoring
# → Manual status checking required
```

### Content Sync
```bash
claude "copy production content to integration"
# → Syncs CMS content and media
# → Preserves integration code
# → Shows completion status
```

### Download Blobs/Media
```bash
# Download all media from production (default)
claude "download blobs"
# → Auto-detects optimal storage container
# → Downloads to smart path (e.g., ./blobs/ProjectName)
# → Shows progress for each file

# Download from specific environment
claude "download media from staging"
# → Downloads from Preproduction environment
# → Supports: blobs, media, assets, images

# Custom download path
claude "download assets to /Users/me/backups"
# → Downloads to specified directory
```

### Download Application Logs
```bash
# Download application logs from production
claude "download logs"
# → Gets Application Insights logs (90-day retention)
# → Auto-organizes by date structure
# → Defaults to application logs

# Download web server logs
claude "download web logs"
# → Gets IIS/web server access logs
# → Useful for traffic analysis

# Filter by date
claude "download logs for 2025/08/24"
# → Downloads only logs from specific date
# → Supports partial dates: "2025/08" for entire month

# Download to custom location
claude "download logs to ~/Desktop/logs"
# → Saves to specified directory
```

### Configure Settings
```bash
# View current settings
claude "get settings"
# → Shows download paths, auto-download status, etc.

# Set default download path
claude "set download path to ~/Downloads/optimizely"
# → All exports, blobs, and logs will use this path
# → Supports ~, relative, and absolute paths

# Toggle auto-download
claude "set auto-download to false"
# → Disables automatic download of database exports

# Reset to defaults
claude "reset settings"
# → Restores all settings to original values
```

## Technical Architecture

This MCP leverages PowerShell + EpiCloud (Optimizely's official module):

```
User Request → MCP Server (Node.js) → PowerShell Core → EpiCloud Module → Optimizely DXP API
```

**Why this approach?**
- ✅ Official Optimizely tooling (EpiCloud)
- ✅ Complete DXP feature coverage
- ✅ Enterprise-grade error handling
- ✅ Works on Windows, Mac, and Linux

## Troubleshooting

### Common Issues

| Error | Solution |
|-------|----------|
| "PowerShell not found" | Mac: `brew install --cask powershell` <br> Linux: [Install guide](https://aka.ms/powershell-release) |
| "EpiCloud not installed" | Auto-installs on first use, or manually: <br> `pwsh -Command "Install-Module EpiCloud -Force"` |
| "Authentication failed" | Verify API credentials in DXP Portal |
| "Rate limit exceeded" | Automatic retry with backoff (usually resolves itself) |
| "Deployment awaiting verification" | Run: `claude "complete deployment"` |
| "HTTP 400: Bad Request" (Azure) | Check artifact URL format - ensure it matches supported API formats |
| "Azure artifact not found" | Verify Personal Access Token has artifact read permissions |
| "No .nupkg file found" | Check artifact contains a NuGet package (.nupkg file) |
| "Failed to connect" (Claude Code) | MCP may show "Failed" but still work - see Claude Code note below |

### Claude Code Configuration Note

**Important:** If using Claude Code CLI, the `claude mcp add` command may create an incompatible configuration format. If you see "Failed to connect" but the MCP still works, or if tools aren't available, manually edit `~/.claude.json` to use this format:

```json
{
  "projects": {
    "/your/project/path": {
      "mcpServers": {
        "optimizely-dxp": {
          "type": "stdio",
          "command": "node",
          "args": ["/path/to/jaxon-optimizely-dxp-mcp.js"],
          "env": {
            "OPTIMIZELY_PROJECT_NAME": "YourProject",
            "OPTIMIZELY_PROJECT_ID": "your-id",
            "OPTIMIZELY_API_KEY": "your-key",
            "OPTIMIZELY_API_SECRET": "your-secret"
          }
        }
      }
    }
  }
}
```

The key difference is using separate `"command"` and `"args"` fields instead of a combined command string.

### Getting Help
```bash
# Run interactive setup wizard
claude "run setup wizard"

# Test your connection and credentials
claude "test connection"

# Quick health check
claude "health check"

# Get detailed deployment info
claude "show deployment dashboard"
```

## Telemetry & Privacy

This MCP includes **anonymous telemetry** (enabled by default) to help understand usage patterns and improve the tool. 

**For Organizations:** Since this is open source, you can use the telemetry feature to gain insights into how your team uses the MCP:
- Track which deployment operations are most common
- Monitor success rates and identify training needs
- Understand usage patterns across different teams
- Measure automation ROI and time savings

**What's collected:**
- Tool usage frequency (which tools are popular)
- Success/error rates (to identify issues)
- Performance metrics (operation timing)
- Environment info (OS type, MCP version)

**What's NOT collected:**
- No API keys or credentials
- No project names or IDs
- No personal information
- No file contents or paths
- No deployment package data

**How to disable:**
```bash
# Set environment variable to false
OPTIMIZELY_MCP_TELEMETRY=false

# Or in your MCP configuration:
"env": {
  "OPTIMIZELY_MCP_TELEMETRY": "false"
}
```

**For self-hosted telemetry:** Organizations can configure their own telemetry endpoint to collect data internally for compliance and analytics purposes.

Telemetry helps understand which features to prioritize and which issues to fix first. Thank you for helping make this tool better!

## Recent Improvements (v3.12.12)

### 🎯 Enhanced Blob/Media Downloads
- **Smart Path Detection**: Automatically finds project-specific directories  
- **Configurable Download Paths**: Persistent user settings stored in `~/.optimizely-mcp`
- **Azure Storage Integration**: Direct blob download from storage containers
- **Application Insights Logs**: Download logs with date filtering (e.g., "2025/08/24")
- **Cross-Platform Compatible**: Proper path handling for Windows/macOS/Linux

### 🔧 MCP Connection Stability
- **Fixed JSON-RPC Issues**: Resolved console output interfering with MCP communication
- **PowerShell Detection**: Improved PowerShell command detection and execution
- **Cache Management**: Better cache handling to prevent stale configurations
- **Claude Code CLI Compatibility**: Enhanced compatibility with direct executable scripts

### 🎨 Project Management Improvements  
- **Simplified Default Logic**: First project is always default (removed complexity)
- **Multi-Project Support**: Better handling of multiple API key configurations
- **Smart Monitoring**: Polling-based monitoring that works with MCP architecture

## Architecture Note

### Why This MCP Uses PowerShell + EpiCloud

**FYI**: This MCP leverages PowerShell and the official EpiCloud module rather than calling REST APIs directly. During development, we encountered authentication challenges with the OAuth2 implementation that blocked direct REST API usage. Rather than spending time debugging the authentication flow, we chose to use EpiCloud which:

- **Just works**: EpiCloud handles all authentication complexity internally
- **Official support**: It's Optimizely's recommended automation tool
- **More features**: Provides access to operations not exposed in the public REST API
- **Better reliability**: Built-in retry logic and error handling
- **Proven solution**: Used by enterprises worldwide for DXP automation

This architectural decision ensures reliability and full feature coverage while avoiding authentication complexities.

## Known Limitations

- **Large Files**: Packages >100MB need special handling (use `analyze_package` tool for best approach)
- **Edge Logs**: Require beta access (not available for most projects)

## Support & Resources

- **Issues & Bugs**: [GitHub Issues](https://github.com/JaxonDigital/optimizely-dxp-mcp/issues)
- **Documentation**: [Full Docs](https://github.com/JaxonDigital/optimizely-dxp-mcp/wiki)
- **Email Support**: support@jaxondigital.com
- **NPM Package**: [@jaxon-digital/optimizely-dxp-mcp](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)

## License

MIT - Free to use in your projects

---

Built by [Jaxon Digital](https://www.jaxondigital.com) - Optimizely Gold Partner  
[LinkedIn](https://www.linkedin.com/company/jaxon-digital/) | [Website](https://www.jaxondigital.com)