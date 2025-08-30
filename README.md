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

## 📊 Advanced Capabilities

### Blob Storage Analytics
Preview and analyze storage without downloading:
```bash
# Preview storage statistics
claude "preview production blobs"

# Download with filters
claude "download PDF files from production"
```

### Log Analysis
Download and analyze Application Insights logs:
```bash
# Download logs with time filtering
claude "download logs from last 7 days"

# AI-powered log analysis
claude "analyze production logs for errors"
```

**[Advanced features →](./ADVANCED_FEATURES.md)** | **[Log capabilities →](./LOG_CAPABILITIES.md)**

## What Can It Do?

### 🤖 AI-Friendly Tools

**Goal-oriented tools designed specifically for AI agents:**
- **Reduced Cognitive Load** - Single tools handle complete workflows
- **Natural Language** - Describe what you want, not how to do it
- **Smart Context** - Tools provide next actions and recommendations
- **Complete Automation** - No multi-step orchestration needed

```bash
# Complete deployment workflow in one call
claude "perform deployment to production"

# Intelligent database operations
claude "manage database backup for production"

# Synchronize content between environments
claude "sync all content from production to staging"

# Diagnose issues with combined analysis
claude "diagnose why the site is slow"

# Quick health check with actionable output
claude "check health of production environment"
```

**[Learn more about AI-friendly tools →](./AI_FRIENDLY_USAGE.md)**

### 🔐 Intelligent Permission Detection

**Automatically detects and adapts to your API key's permissions:**
- **Smart Permission Check** - Detects all 4 DXP permissions (Edge logs, Integration, Preproduction, Production)
- **Role-Based Access** - Automatically adapts operations to your permission set
- **No Configuration Needed** - Works seamlessly regardless of permission level
- **Clear Feedback** - Shows exactly which permissions your API key has

```bash
# Test your permissions
claude "test connection"
# Output: ✅ Permissions: Edge logs, Integration, Production
#         ℹ️ Not configured: Preproduction
#         🔧 Capabilities: Edge log analysis, Cross-environment deployments

# All operations automatically adapt to your permissions
claude "export database"  # Uses your highest accessible environment
claude "download logs"    # Only available if you have Edge logs permission
claude "deploy"           # Shows available deployment paths based on permissions
```

### 📦 Blob & Media Downloads

**Download your entire media library with confidence:**
- **Interactive Confirmation** - See exactly what you're downloading before starting
- **Smart Previews** - Shows total files, size, estimated time, and destination folder
- **Pagination Support** - Handles containers with 5,000+ files seamlessly
- **Flexible Control** - Change download path or cancel before committing
- **Progress Tracking** - Real-time updates during download with ETA

```bash
# Preview first, then confirm (defaults to production)
claude "download production blobs"
# Shows: 12,543 files (4.2 GB) → /path/to/destination
# Then: Prompts for confirmation with options to change path or cancel

# Download from other environments
claude "download blobs from integration"
claude "download blobs from staging"  # (staging = preproduction)

# Skip confirmation if you're sure
claude "download blobs from production with skipConfirmation: true"

# Filter specific file types
claude "download only JPG files from integration"
```

## 🚀 Configuration Options

### Option 1: Auto-Install with npx (Recommended)
No installation needed - npx automatically downloads the latest version:

```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "npx",
      "args": ["-y", "@jaxon-digital/optimizely-dxp-mcp@latest"],
      "env": {
        "PROJECT_NAME": "id=your-uuid;key=YOUR_KEY;secret=YOUR_SECRET"
      }
    }
  }
}
```
✅ **Benefits**: Always uses latest version, no global install needed

### Option 2: Global Installation
Install once, use everywhere:

```bash
# Install globally
npm install -g @jaxon-digital/optimizely-dxp-mcp
```

```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "PROJECT_NAME": "id=your-uuid;key=YOUR_KEY;secret=YOUR_SECRET"
      }
    }
  }
}
```

### Option 3: Development Version (Advanced)
For contributors or testing latest changes:

```bash
# Clone the repository
git clone https://github.com/JaxonDigital/optimizely-dxp-mcp.git
cd optimizely-dxp-mcp
npm install
```

```json
{
  "mcpServers": {
    "optimizely-dxp-dev": {
      "command": "node",
      "args": ["/path/to/optimizely-dxp-mcp/jaxon-optimizely-dxp-mcp.js"],
      "env": {
        "PROJECT_NAME": "id=your-uuid;key=YOUR_KEY;secret=YOUR_SECRET"
      }
    }
  }
}
```

### Start Using
```bash
# Test connection
claude mcp list

# Use natural language commands
claude "deploy to production"
claude "backup database" 
claude "download blobs"
```

### Simple Commands

| Command | What it does |
|---------|-------------|
| `deploy to production` | Smart deploy from preproduction with progress tracking |
| `export database` | Export database (defaults to production database, auto-monitoring enabled) |
| `status` | Show all deployments with suggestions |
| `quick` | Ultra-fast status check |
| `download blobs` | Download all media/assets with preview & confirmation |
| `download logs` | Download Application Insights logs (requires Edge logs permission) |
| `get edge logs` | Get CDN/edge logs (requires Edge logs permission - BETA) |
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
- **Interactive confirmation** before downloading - see files, size, time, and path
- **Pagination support** for containers with 5,000+ files (Azure's limit)
- **Smart previews** with file type breakdown and statistics
- **Flexible downloads** - change destination path before confirming
- **Progress tracking** with real-time ETA and speed metrics
- **Filter support** - download only specific file types (e.g., `*.jpg`)
- Natural language support: "download blobs", "download media", "download assets"
- Smart path detection for project-specific blob directories
- Cross-platform compatible with automatic path resolution

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

### Advanced Download Path Configuration 🆕

Configure custom download paths for each project and file type. **Paths can be relative to your current project folder!**

**Supported Path Formats:**
- **Relative paths**: `db`, `./backups`, `../shared/media` (relative to current working directory)
- **Absolute paths**: `/Users/me/downloads`, `C:\Downloads`
- **Home paths**: `~/downloads`, `~/Desktop/exports`
- **Environment variables**: `$HOME/downloads`, `${USER}/backups`

**Project-Specific Paths in .mcp.json**
```json
{
  "mcpServers": {
    "optimizely-vhb": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "VHB": "id=xxx;key=yyy;secret=zzz;blobPath=./media;dbPath=./db;logPath=./logs"
      }
    }
  }
}
```

**Multiple Projects with Different Paths**
```json
{
  "mcpServers": {
    "optimizely-multi": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "VHB": "id=xxx;key=yyy;secret=zzz;blobPath=media;dbPath=backups",
        "CAMBRO": "id=aaa;key=bbb;secret=ccc;blobPath=~/cambro/assets;default=true",
        "CONTOSO": "id=ddd;key=eee;secret=fff;logPath=/absolute/path/logs"
      }
    }
  }
}
```

**Example: Simple Project-Relative Setup**
```json
{
  "env": {
    "MYPROJECT": "id=xxx;key=yyy;secret=zzz;blobPath=blobs;dbPath=db;logPath=logs"
  }
}
```
This will download:
- Blobs to `./blobs` in your project folder
- Database exports to `./db`
- Logs to `./logs`

Download paths are optional - if not specified, smart defaults are used based on your project name and current directory.

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
4. **Select Permissions** - Choose which permissions to grant:
   - **Edge logs** - Access to CDN/edge logs (BETA feature)
   - **Integration** - Development environment access
   - **Preproduction** - Staging environment access
   - **Production** - Production environment access
5. Copy these values:
   - **Project ID**: UUID format (e.g., `abc12345-...`)
   - **API Key**: Your access key
   - **API Secret**: Your secret key

💡 **Permission Notes:**
- You don't need all permissions - the MCP adapts to what you have
- Common patterns:
  - **Developer**: Integration only
  - **Tester**: Preproduction only
  - **DevOps**: All environments
  - **Support**: Production + Edge logs
- Operations automatically work within your permission set
- Use `check_permissions` tool to see which environments your API key can access

## Configuration

### For Claude Code CLI Users (Recommended Approach)

#### Option 1: Auto-Install with npx (No Installation Required) 🆕

Create `.mcp.json` in your project directory with npx configuration:

```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "npx",
      "args": ["-y", "@jaxon-digital/optimizely-dxp-mcp@latest"],
      "env": {
        "MY_PROJECT": "id=abc-123;key=YOUR_KEY;secret=YOUR_SECRET"
      }
    }
  }
}
```

**Benefits of npx approach:**
- ✅ No installation needed - automatically downloads on first use
- ✅ Always uses latest version
- ✅ No global npm pollution
- ✅ Works immediately in any project folder
- ✅ Cached after first download for fast subsequent runs

#### Option 2: Global Installation

##### Step 1: Install the MCP Server
```bash
npm install -g @jaxon-digital/optimizely-dxp-mcp
```

##### Step 2: Create Local Project Configuration  
Create `.mcp.json` in your project directory:

**Simple Configuration:**
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "MY_PROJECT": "id=abc-123;key=YOUR_KEY;secret=YOUR_SECRET"
      }
    }
  }
}
```

**Full Configuration with Optional Fields:**
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "MY_PROJECT": "id=abc-123;key=YOUR_KEY;secret=YOUR_SECRET;blobPath=/dev/blobs;dbPath=/backups;logPath=/logs;telemetry=true"
      }
    }
  }
}
```

#### Step 3: Test Your Configuration
```bash
# Navigate to your project directory
cd /path/to/your/project

# Test the MCP connection
claude mcp list
# Should show: optimizely-dxp ✓ Connected

# Test a command
claude "show project status"
```

**Optional Configuration Fields:**
- `blobPath` - Custom path for blob/media downloads
- `dbPath` - Custom path for database backups  
- `logPath` - Custom path for Application Insights logs
- `telemetry` - Enable/disable telemetry (true/false)
- `default` - Mark as default project when multiple configured

### For Claude Desktop Users

Edit Claude Desktop configuration (`~/.claude/claude_desktop_config.json`):
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

### Option 1: No Config (Simplest)
Provide credentials inline:
```bash
claude "Deploy for project MyProject with id abc-123, key YOUR_KEY, secret YOUR_SECRET"
```
The MCP remembers credentials for the session.

### Option 2: Multiple Projects
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "ACME_CORP": "id=abc-123;key=KEY1;secret=SECRET1;default=true;blobPath=/dev/blobs/acme",
        "CONTOSO": "id=def-456;key=KEY2;secret=SECRET2;telemetry=false",
        "FABRIKAM": "id=ghi-789;key=KEY3;secret=SECRET3;dbPath=/backups/fabrikam"
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

### Configure Download Paths 🆕

Download paths can be configured in multiple ways, with the new compact configuration being the simplest:

#### Method 1: Compact Configuration (Recommended)
Include paths directly in your project configuration:
```json
{
  "env": {
    "VHB": "id=abc-123;key=KEY;secret=SECRET;blobPath=/dev/blobs/vhb;dbPath=/backups/vhb;logPath=/logs/vhb"
  }
}
```

#### Method 2: Environment Variables (Legacy)
```bash
export OPTIMIZELY_VHB_DOWNLOAD_PATH_BLOBS="/path/to/vhb/blobs"
export OPTIMIZELY_VHB_DOWNLOAD_PATH_DATABASE="/path/to/vhb/backups"
export OPTIMIZELY_VHB_DOWNLOAD_PATH_LOGS="/path/to/vhb/logs"
```

#### Method 3: Command Line Override
```bash
claude "download blobs with downloadPath: /custom/path"
```

#### Download Path Priority Order
1. **Command-line path** (highest) - `downloadPath` parameter
2. **Compact configuration** - `blobPath`, `dbPath`, `logPath` fields
3. **Project + Type env var** - `OPTIMIZELY_VHB_DOWNLOAD_PATH_BLOBS`
4. **Project base path + type** - `OPTIMIZELY_VHB_DOWNLOAD_PATH` + `/blobs`
5. **Type-specific global** - `OPTIMIZELY_DOWNLOAD_PATH_BLOBS`
6. **Global base + type/project** - `OPTIMIZELY_DOWNLOAD_PATH` + `/blobs/vhb`
7. **Settings file** - Configured via `set download path`
8. **Smart defaults** (lowest) - Auto-detected development paths

### Configure Settings
```bash
# View current settings
claude "get settings"
# → Shows download paths, auto-download status, etc.

# Set default download path (for settings file)
claude "set download path to ~/Downloads/optimizely"
# → Updates settings file default
# → Environment variables take precedence

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

### Claude Code CLI Specific Issues

| Issue | Solution |
|-------|----------|
| "No MCPs" shown in folder | Create `.mcp.json` file in project directory |
| "Failed to connect" | Check MCP name doesn't have spaces, use hyphens instead |
| Tools not available | Ensure command path is correct and executable |
| Cache issues | Rename MCP server in config (e.g., `optimizely-dxp-v2`) |

**MCP Cache Busting:** If configuration changes aren't taking effect:
1. Remove old MCP: `claude mcp remove old-name`
2. Add with new name: Create `.mcp.json` with different server name
3. Test connection: `claude mcp list`

**Local Project Configuration (.mcp.json):**
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "PROJECT": "id=uuid;key=KEY;secret=SECRET;blobPath=/custom/path"
      }
    }
  }
}
```

**Pro Tip:** Use local `.mcp.json` files instead of global configuration - they're easier to manage and project-specific.

### Getting Help
```bash
# Run interactive setup wizard
claude "run setup wizard"

# Test your connection and credentials
claude "test connection"

# Check which environments your API key can access
claude "check permissions"

# Quick health check
claude "health check"

# Get detailed deployment info
claude "show deployment dashboard"
```

### Environment Permission Checking
The MCP automatically detects which environments your API key can access:

```bash
# Check permissions for configured project
claude "check permissions"

# Example output:
# 🔑 API Key Permissions - VHB
# 
# **Project:** VHB (caecbb62-...)
# **Can Access:** Integration, Preproduction
# **Cannot Access:** Production
# **Highest Environment:** Preproduction
```

The MCP will:
- Automatically use the highest accessible environment for operations
- Prevent operations on environments you don't have access to
- Adapt all tools to work within your permission boundaries
- Show clear error messages when attempting restricted operations

## Telemetry & Privacy

This MCP includes **anonymous telemetry** (enabled by default) to help understand usage patterns and improve the tool. 

**For Organizations:** Since this is open source, you can use the telemetry feature to gain insights into how your team uses the MCP:
- Track which deployment operations are most common
- Monitor success rates and identify training needs
- Understand usage patterns across different teams
- Measure automation ROI and time savings

**Telemetry is enabled by default** to help improve the tool. No configuration needed!

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

**To opt-out of telemetry:**
```json
// In your MCP configuration, add:
"env": {
  "YOUR_PROJECT": "id=xxx;key=yyy;secret=zzz",
  "OPTIMIZELY_MCP_TELEMETRY": "false"  // ← Explicitly disable
}
```

Or set the environment variable:
```bash
export OPTIMIZELY_MCP_TELEMETRY=false
```

**For self-hosted telemetry:** Organizations can configure their own telemetry endpoint to collect data internally for compliance and analytics purposes.

Telemetry helps understand which features to prioritize and which issues to fix first. Thank you for helping make this tool better!

## Key Capabilities

### 🚀 Configuration & Setup
- **Compact Configuration**: Single-line project config with semicolon-delimited settings
- **Multi-Project Support**: Manage multiple Optimizely projects with different API keys
- **Local Project Config**: Use `.mcp.json` files for project-specific configurations
- **Customizable Paths**: Configure download paths for blobs, databases, and logs
- **Environment Variables**: Optional support for traditional environment variable configuration

### 📦 Blob/Media Management
- **Download Media Files**: Download assets from Azure Storage containers
- **Glob Pattern Filtering**: Filter downloads with patterns like `*.pdf`, `2024/*.jpg`, `*report*`
- **Smart Preview**: View file count, total size, and estimated download time before starting
- **Pagination Support**: Handle containers with 5000+ files efficiently
- **Configurable Paths**: Save downloads to custom locations per project

#### Blob Download Examples
```bash
# Download all files (with preview first)
claude "download blobs"

# Download only PDFs
claude "download blobs filter *.pdf"

# Download JPGs from 2024 folder
claude "download blobs filter 2024/*.jpg"

# Download files containing "report" in name
claude "download blobs filter *report*"

# Download from specific environment
claude "download blobs from staging"
```

### 🔐 Permission Management
- **Automatic Permission Detection**: Detects which environments your API key can access
- **Adaptive Operations**: All tools work within your permission boundaries
- **Clear Permission Feedback**: Shows accessible/inaccessible environments upfront
- **Smart Environment Selection**: Automatically uses the highest accessible environment

### 📊 Analytics & Monitoring
- **Deployment Dashboard**: Real-time deployment monitoring and analytics
- **Tool Usage Tracking**: Anonymous telemetry for usage patterns (opt-out available)
- **Performance Metrics**: Track operation duration and success rates
- **Progress Tracking**: Visual feedback for long-running operations with ETAs

### 🎯 Database & Logs
- **Database Exports**: Export databases with automatic monitoring and download
- **Smart Export Detection**: Reuses recent backups to save time
- **Application Insights Logs**: Download logs with date filtering
- **Auto-Download**: Automatically download exports when complete

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

## Advanced Topics (Experimental)

### Azure DevOps CI/CD Integration

*Note: This feature is experimental and still being refined.*

Deploy directly from Azure DevOps build artifacts:
```bash
claude "deploy Azure artifact to production" \
  --artifact-url "https://dev.azure.com/org/_apis/resources/Containers/12345/drop" \
  --azure-devops-pat "your-token"
```

The Azure DevOps integration supports both Resources API and Build API formats.

### AI Agent & Workflow Automation

This MCP can be integrated with workflow automation platforms:

**Workflow Platforms**
- n8n, Zapier/Make, GitHub Actions, Jenkins

**AI Agent Platforms**  
- LangChain/LlamaIndex, AutoGPT/AgentGPT, Custom GPTs, Slack/Teams Bots

**Use Cases**
- Auto-deploy after successful tests
- Schedule content syncs during off-hours
- Trigger rollbacks on monitoring alerts
- Create approval workflows for production deployments

The MCP's JSON-RPC interface enables integration with any platform that can make HTTP requests or run Node.js processes.

## License

MIT - Free to use in your projects

---

Built by [Jaxon Digital](https://www.jaxondigital.com) - Optimizely Gold Partner  
[LinkedIn](https://www.linkedin.com/company/jaxon-digital/) | [Website](https://www.jaxondigital.com)