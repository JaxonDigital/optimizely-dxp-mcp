# Optimizely DXP MCP Server

[![npm version](https://img.shields.io/npm/v/@jaxon-digital/optimizely-dxp-mcp.svg)](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dt/@jaxon-digital/optimizely-dxp-mcp.svg)](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)

## 🤔 The Problem

**You invested in enterprise DXP, but you're only using 10% of its power.**

You chose Optimizely to deliver exceptional digital experiences, but:
- Your team spends more time on DevOps tasks than building features
- Critical issues hide in logs until customers complain
- Deployments are scary, manual, multi-step processes
- Setting up dev environments takes hours or days
- You can't move fast enough to beat competitors embracing AI

**Meanwhile, AI is revolutionizing how software gets built and managed.** Companies using AI-powered automation are shipping 10x faster, finding issues before customers do, and freeing their teams to focus on innovation.

## ✨ The Solution

**Your infinite DevOps workforce - AI that never sleeps, never breaks, always delivers.**

This MCP server transforms your Optimizely DXP into an AI-powered platform that goes far beyond replacing Google searches. Just as Optimizely Opal provides an infinite workforce for marketing, this MCP creates your infinite workforce for DXP operations:

- **AI Specialists** that understand your infrastructure, deployments, and data
- **Intelligent Agents** that handle complex multi-step workflows autonomously
- **24/7 Operations** that scale infinitely without adding headcount
- **Your team** elevated from operators to innovators

Finally get the ROI your DXP investment promised - ship faster, break less, sleep better.

## 🚀 The Transformation

**From DXP operator to digital experience innovator:**

- **Ship 10x faster** - What took hours now takes seconds
- **Zero-downtime deployments** - AI handles the complexity
- **Proactive issue resolution** - Fix problems before customers notice
- **Instant dev environments** - Full production replicas in minutes
- **Competitive advantage** - Move at AI speed while others click through portals
- **Maximum DXP ROI** - Finally use all those powerful features you're paying for

## 🔌 What is MCP?

**Model Context Protocol (MCP)** is the bridge between AI's intelligence and your DXP's capabilities.

While others use AI just to search documentation or write code snippets, MCP enables something revolutionary: **AI that takes action**. This isn't about better search results - it's about AI that can:

- **Execute** complex operations autonomously
- **Orchestrate** multi-step workflows across environments
- **Monitor** systems and self-heal issues
- **Learn** from your infrastructure to make smarter decisions
- **Scale** infinitely without human bottlenecks

Think of it as evolving from "AI as advisor" to "AI as workforce" - the difference between asking for directions and having a chauffeur.

## ⚠️ IMPORTANT: No Manual Startup Required

**DO NOT run `npm start` or `node index.js` - The MCP is NOT a traditional server!**

### ❌ What NOT to Do
- **DO NOT run `npm start`** - The MCP is not a standalone server
- **DO NOT run `node dist/index.js` directly** - Claude handles the execution automatically
- **DO NOT keep a terminal window open** - The MCP runs on-demand
- **DO NOT look for a running process** - It starts and stops as needed

### ✅ How MCP Actually Works
1. **Claude automatically starts the MCP** when you open a conversation
2. **The MCP runs as a subprocess** managed entirely by Claude
3. **It starts and stops automatically** based on your usage
4. **No manual intervention required** - just use Claude normally

### 🎯 Correct Installation & Usage
```bash
# ONE-TIME SETUP:
# Option 1: Configure to use npx (always latest)
# Add to Claude's config - no install needed!

# Option 2: Global install for faster startup
npm install -g @jaxon-digital/optimizely-dxp-mcp

# THEN: Just use Claude! The MCP starts automatically
```

**That's it!** Configure once in Claude's settings, then forget about it. The MCP runs invisibly in the background whenever Claude needs it.

## 🛠️ AI-Enabled Solutions

**Empower AI to handle your entire DXP lifecycle - from development to production:**

### 1️⃣ Permission & Access Management
```bash
# Know exactly what your AI can do
"test connection"                          # Validates setup & shows capabilities
"check permissions"                        # Detailed environment access breakdown
"verify access to production"              # Confirm specific environment access
```

### 2️⃣ Deployments & Content Sync
```bash
# Deploy code and sync content between environments
"start deployment to production"           # Code deployment from preproduction
"start deployment from int to prep"        # Explicit source and target
"copy content from prod to integration"    # Content sync (downward)
"reset deployment in production"           # Rollback if needed
"complete deployment"                      # Finish verification state
```

### 3️⃣ Real-Time Monitoring & Status
```bash
# Track everything happening in your DXP
"show deployment dashboard"                # Visual progress with ETAs
"check production status"                  # Environment health check
"monitor current deployments"              # Live updates with auto-refresh
"list recent deployments"                  # History and patterns
```

### 4️⃣ Development Environment Setup
```bash
# Get production-quality data for local development
"export production database"               # Interactive workflow with smart monitoring
"check database export status"             # Check progress of running exports
"download latest database backup"          # Get most recent backup file
"download production blobs"                # Smart incremental - only changed files
"download blobs with filter *.pdf"         # Selective downloads with patterns
"download blobs force full"                # Bypass incremental, get everything
# AI tracks what you've downloaded to save bandwidth
```

### 5️⃣ Log Downloads with Manifest Tracking
```bash
# Access Application Insights logs with smart downloads
"download logs from last 7 days"           # Incremental - skips unchanged logs
"download web logs"                        # HTTP/IIS logs with manifest tracking
"download application logs"                # App logs for external analysis
"download all logs"                        # All available log types
# Generates manifest files for external log analyzer tools
```

### 6️⃣ Multi-Project Management
```bash
# Perfect for agencies managing multiple clients
"switch to CLIENT2"                                  # Instantly switch between projects
"list projects"                                      # See all configured clients
"deploy to production for ACME"                      # Project-specific operations

# Batch operations across projects
"download blobs for ProjectX and ProjectY"           # Batch downloads
"get production logs from all projects"              # All configured projects
"sync ACME_CORP and Contoso to local"               # Named projects
"download last week's logs for every project"        # Time-based multi-project

# Smart project detection & resolution
"download logs"                                      # If 1 project: proceeds
                                                     # If multiple: shows selection
"download ACME logs"                                # Detects ACME_CORP project
"get Contoso production blobs"                      # Handles name variations
```

### 7️⃣ Download Management & Control
```bash
# Full control over active downloads
"list active downloads"                    # See what's downloading
"cancel download abc-123"                  # Stop specific download
"cancel all downloads"                     # Emergency stop all
"download history"                         # Review past downloads
```

### 8️⃣ Analytics & Insights
```bash
# Understand how AI is being used across your organization
"disable telemetry"                        # Opt-out of anonymous analytics
"enable telemetry"                         # Re-enable to help improve the tool
# Telemetry tracks: AI client type (Claude/ChatGPT/Cursor), geographic region,
# tool usage patterns - all anonymous, no PII collected
```

### 9️⃣ CI/CD Integration (Beta)
```bash
# Azure DevOps pipeline support
"deploy azure artifact [URL]"              # Direct from build artifacts
```

### 🎯 Smart Features That Save Time

- **🆕 Self-Hosted Azure Support** - Direct integration with Optimizely CMS on Azure storage
- **🆕 Natural Language Commands** - Use "Console Logs" instead of "insights-logs-appserviceconsolelogs"  
- **🆕 Automatic Previews** - See file count, size, and destination before downloading
- **🆕 Parallel Downloads** - 5x faster with simultaneous file downloads
- **Incremental Downloads** - Only downloads changed files, saves bandwidth
- **Intelligent Defaults** - Knows production is usually the source for backups
- **Auto-Retry Logic** - Handles transient failures automatically
- **Progress Tracking** - Real-time ETAs for long operations
- **Background Operations** - Start tasks and get notified when done
- **Natural Language** - Say what you want, not how to do it
- **Permission Adaptation** - Works with whatever access you have
- **AI Client Detection** - Knows if you're using Claude, ChatGPT, or Cursor
- **Confirmation Previews** - See what will happen before it happens

## 📋 Complete Tool Reference

### Setup & Connection Tools (4)
- `test_connection` - Validate API credentials and show capabilities
- `health_check` - Comprehensive server health check
- `setup_wizard` - Interactive setup for new projects
- `get_version` - Get current MCP server version

### Deployment Tools (8)
- `deploy` - Smart deployment with auto-detection
- `start_deployment` - Start code deployment to environment
- `complete_deployment` - Complete deployment in AwaitingVerification state
- `reset_deployment` - Roll back deployment
- `get_deployment_status` - Check specific deployment status
- `list_deployments` - List recent deployments with filtering
- `monitor_deployment` - Real-time deployment monitoring
- `copy_content` - Sync content between environments

### Database Export Tools (3)
- `db_export` - Start database export with auto-monitor and auto-download options
- `db_export_status` - Check export status with optional monitoring and download
- `db_export_download` - Download completed export (background or synchronous)

### Download Management Tools (3)
- `download_list` - List downloads with filtering (active/completed/failed)
- `download_status` - Check status of specific download
- `download_cancel` - Cancel one or all active downloads

### Storage & Blob Tools (5)
- `download_blobs` - Download blobs/media with incremental support
- `download_media` - Download media files from storage
- `list_storage_containers` - List available storage containers
- `generate_storage_sas_link` - Generate SAS URL for storage access
- `upload_deployment_package` - Upload package to DXP storage

### Log Download Tools (2)
- `download_logs` - Download Application Insights logs with manifest tracking
- `analyze_logs` - Analyze logs for patterns and insights

### Project Management Tools (3)
- `list_projects` - Show all configured projects
- `switch_project` - Change active project
- `get_current_project` - Show current active project

### Quick Status Tools (3)
- `status` - Comprehensive environment status overview
- `quick` - Fast status check with essentials only
- `check_permissions` - Verify API key permissions

### Enterprise Tools (2)
- `get_ai_guidance` - Get AI-specific interaction patterns
- `configure_telemetry` - Enable/disable anonymous usage analytics

**Total: 36 tools** organized for AI agents, human users, and automated workflows.

## 🔗 Automation & Integration

### Native Support for Workflow Automation Tools

**22 tools** now include native MCP `structuredContent` for seamless integration with automation platforms like **n8n**, **Zapier**, **Make**, and custom workflows.

#### What is structuredContent?

Every response includes **two formats**:
1. **Human-readable message** - For AI assistants and Claude Code
2. **Structured data object** - For automation tools and programmatic access

#### Example Response Format

```javascript
{
  content: [{
    type: "text",
    text: "✅ Database Export Complete!\n\nExport ID: abc-123\n..."
  }],
  structuredContent: {
    success: true,
    data: {
      exportId: "abc-123",
      environment: "Production",
      databaseName: "epicms",
      status: "Succeeded",
      downloadUrl: "https://..."
    }
  }
}
```

#### Direct Property Access

**No JSON.parse() needed** - access data directly:

```javascript
// n8n, Zapier, Make
const exportId = {{ $json.structuredContent.data.exportId }}
const status = {{ $json.structuredContent.data.status }}
const downloadUrl = {{ $json.structuredContent.data.downloadUrl }}
```

#### Supported Tools by Category

**Deployments** (7 tools):
- `test_connection`, `list_deployments`, `start_deployment`, `monitor_deployment`, `complete_deployment`, `get_deployment_status`, `reset_deployment`

**Database** (3 tools):
- `db_export`, `db_export_status`, `db_export_download`

**Logs & Blobs** (4 tools):
- `download_logs`, `download_blobs`, `get_download_status`, `list_active_downloads`

**Storage** (2 tools):
- `list_storage_containers`, `generate_storage_sas_link`

**Management** (3 tools):
- `list_projects`, `health_check`, `get_version`

**Content** (1 tool):
- `copy_content`

#### Automation Workflow Examples

**n8n Deployment Workflow**:
```
1. MCP: start_deployment → Get deploymentId
2. Wait 30 seconds
3. MCP: get_deployment_status → Check status
4. If status = "AwaitingVerification" → MCP: complete_deployment
5. Send Slack notification with deployment URL
```

**Zapier Database Backup**:
```
1. Schedule: Daily at 2 AM
2. MCP: db_export environment="Production"
3. MCP: db_export_status → Poll until complete
4. MCP: db_export_download → Get file path
5. Upload to Google Drive
6. Send email confirmation
```

**Make Log Analysis**:
```
1. Webhook: Error alert received
2. MCP: download_logs logType="application" hoursBack=1
3. Parse logs for error patterns
4. Create Jira ticket with context
5. Post to Teams channel
```

### 🔌 n8n Integration with HTTP Transport

**New in v3.42.0**: Native n8n integration using HTTP Streamable transport.

#### Quick Start

Start the MCP server in HTTP mode for n8n:

```bash
DXP_MCP_MODE=http npm start
```

Then configure n8n's MCP Client Tool:
- **Server URL**: `http://localhost:3001/mcp`
- All DXP tools will be automatically discovered

#### Configuration

**Environment Variables**:
```bash
# Required
export DXP_MCP_MODE=http              # Enable HTTP transport

# Optional
export DXP_MCP_PORT=3001              # Default: 3001
export OPTIMIZELY_PROJECT_ID=your-id  # Your DXP credentials
export OPTIMIZELY_PROJECT_KEY=your-key
export OPTIMIZELY_PROJECT_SECRET=your-secret
```

**Start Server**:
```bash
DXP_MCP_MODE=http npm start
```

#### Transport Modes

- **`stdio` (default)** - For Claude Desktop integration
- **`http`** - For n8n and other automation platforms

Both modes support the same tools and functionality. The HTTP mode enables:
- n8n native MCP Client Tool integration
- Other automation platforms that support HTTP MCP
- Testing with curl/Postman
- Multi-client access

#### Complete Guide

See [N8N_INTEGRATION.md](./N8N_INTEGRATION.md) for:
- Detailed setup instructions
- Example workflows
- Testing procedures
- Security considerations
- Production deployment patterns
- Troubleshooting

#### Benefits for Automation

- ✅ **No parsing required** - Direct property access
- ✅ **Type safety** - Consistent data structures
- ✅ **Progress tracking** - Real-time download status
- ✅ **Error handling** - Structured error responses
- ✅ **Backward compatible** - Human-readable messages still work
- ✅ **Well-documented** - Every field has clear purpose

## 📋 System Requirements & Architecture

### What Gets Installed

When you install this MCP server, you get:
- **Node.js package** (~1MB) - The MCP server itself
- **Direct REST API client** - Native implementation with HMAC authentication
- **No database** - Stateless operation
- **No external dependencies** - Pure Node.js, works everywhere

### Prerequisites

- **Node.js 18+** - Required for MCP protocol
- **Optimizely API Credentials** - API Key + Secret from DXP Portal

**✅ No PowerShell Required!** (as of v3.44.0)

### Why Direct REST API?

**We use direct REST API calls with HMAC-SHA256 authentication because:**

1. **Faster** - 3-10x faster than PowerShell-based approach
2. **Simpler** - No PowerShell installation or module dependencies
3. **Cross-platform** - Works identically on Windows, macOS, Linux
4. **Reliable** - Direct HTTPS calls with built-in retry logic
5. **Lightweight** - Minimal dependencies, faster startup
6. **Official** - Uses the same API that Optimizely's tools use

Starting v3.44.0, all operations use Optimizely's REST API directly - no middleware, no extra layers.

## ⚙️ Configuration & Setup

### 📍 Configuration Scopes

MCP servers can be configured at different levels:

1. **Project Level** (`.mcp.json` in project root) - Best for project-specific configs
   - Keeps credentials with the project
   - Version controlled (remember to gitignore secrets!)
   - Automatically loads when you open the project

2. **User Level** (Claude's config file) - Best for personal/agency setups
   - Claude Code: `~/Library/Application Support/Claude/claude_code_config.json`
   - Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Available across all projects

3. **System Level** - For shared team environments
   - Configure once for all users
   - Requires admin access

📖 **More info**: [MCP Configuration Guide](https://modelcontextprotocol.io/docs/configuration)

> **⚠️ Note on Breaking Changes**: This project is evolving rapidly to deliver the best AI-powered DXP experience. We prioritize innovation over backward compatibility during this early phase. Always use `@latest` in your npx commands to get the latest features and improvements.

### 🎯 Claude Code (Recommended)

Claude Code has the best MCP support with automatic server management and inline tool results.

**Option 1: Project-Level Config** (`.mcp.json` in your project root)
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
✅ **Benefits**: Config stays with project, auto-loads when opening project
⚠️ **Important**: Add `.mcp.json` to `.gitignore` if it contains secrets!

**Option 2: User-Level Config** (in Claude's config directory)
Same JSON format as above, but in:
- `~/Library/Application Support/Claude/claude_code_config.json`

✅ **Benefits**: Available across all projects, always uses latest version

**Option 3: Global Install (Faster startup)**
```bash
# First install globally
npm install -g @jaxon-digital/optimizely-dxp-mcp@latest
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
⚠️ **Note**: Remember to update periodically with `npm update -g @jaxon-digital/optimizely-dxp-mcp`

### 💻 Claude Desktop

Claude Desktop also supports MCP but with a slightly different experience.

**Config Location**: 
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Use the same configuration as Claude Code above. The npx approach is recommended to always get updates.

### 🤖 Coming Soon: ChatGPT & Others

MCP support is being added to other AI assistants:
- **ChatGPT**: MCP support announced, coming soon
- **Open Source**: Any tool supporting MCP protocol

### 🔧 Multi-Project Setup

Managing multiple Optimizely projects? Configure them all:

```json
{
  "mcpServers": {
    "optimizely-client1": {
      "command": "npx",
      "args": ["-y", "@jaxon-digital/optimizely-dxp-mcp@latest"],
      "env": {
        "CLIENT1": "id=uuid1;key=KEY1;secret=SECRET1",
        "CLIENT2": "id=uuid2;key=KEY2;secret=SECRET2"
      }
    }
  }
}
```

#### Project Management Commands

```bash
# List and switch between projects
"list projects"                # Show all configured projects
"current project"              # Show current active project
"switch to CLIENT2"            # Change active project

# Update project configuration dynamically
"update project with new API key"  # Update credentials
"update project to self-hosted"    # Convert project type
```

**Note**: Project switching is session-based. Your selection persists for the current session only.

### 🌐 Self-Hosted Azure Storage Support (Non-DXP)

For Optimizely solutions hosted outside of DXP (self-hosted Azure), you can still access blobs, logs, and database backups:

#### Configuration

Use Azure Storage connection strings instead of API keys:

```json
{
  "mcpServers": {
    "optimizely-selfhosted": {
      "command": "npx",
      "args": ["-y", "@jaxon-digital/optimizely-dxp-mcp@latest"],
      "env": {
        "PROJECT_NAME": "DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=mykey;EndpointSuffix=core.windows.net"
      }
    }
  }
}
```

#### Finding Your Connection String

1. **Azure Portal**:
   - Navigate to your Storage Account
   - Go to "Access keys" under Security + networking
   - Copy the "Connection string" (not just the key)

2. **Azure CLI**:
   ```bash
   az storage account show-connection-string \
     --name mystorageaccount \
     --resource-group myresourcegroup
   ```

3. **From Application Settings**:
   - Check your app's configuration/appsettings.json
   - Look for `ConnectionStrings:AzureStorage` or similar

#### Supported Operations

Self-hosted projects can:
- ✅ **List containers with friendly names** - See "Console Logs" instead of technical names
- ✅ **Download blobs/media files** - With parallel downloading for speed
- ✅ **Download Application Insights logs** - Console and HTTP logs with preview
- ✅ **Download existing database backups** - From backup containers
- ✅ **Use incremental download features** - Only download new/changed files
- ✅ **Natural language commands** - Use friendly names in all operations
- ✅ **Dynamic project type conversion** - Switch between DXP and self-hosted

Self-hosted projects cannot:
- ❌ Start deployments (no DXP API)
- ❌ Trigger database exports
- ❌ Copy content between environments
- ❌ Upload deployment packages

**Tip**: You can dynamically update any project between DXP and self-hosted configurations using `"update project"` commands.

#### Example Commands

```bash
# Natural language - use what you see in container list
"download logs Console Logs"        # Downloads from insights-logs-appserviceconsolelogs  
"download logs HTTP Logs"           # Downloads from insights-logs-appservicehttplogs
"download blobs Media Files"        # Downloads from mysitemedia container
"list storage containers"           # Shows friendly names with download hints
```

### 📁 Download Path Configuration

Control exactly where your downloads go with our flexible 7-level configuration priority system.

#### Configuration Priority Order (highest to lowest)

1. **User-specified path** - Direct parameter in commands
   ```bash
   "download logs downloadPath=/custom/path"
   ```

2. **Project compact fields** - In-line configuration with credentials
   ```json
   {
     "env": {
       "ACME": "id=xxx;key=yyy;secret=zzz;logPath=/logs/acme;dbPath=/db/acme;blobPath=/media/acme"
     }
   }
   ```

3. **Project + Type environment variables** - Most specific env vars
   ```bash
   OPTIMIZELY_ACME_DOWNLOAD_PATH_LOGS=/projects/acme/logs
   OPTIMIZELY_ACME_DOWNLOAD_PATH_DATABASE=/projects/acme/db
   OPTIMIZELY_ACME_DOWNLOAD_PATH_BLOBS=/projects/acme/media
   ```

4. **Project-specific paths** - Per-project default
   ```bash
   OPTIMIZELY_ACME_DOWNLOAD_PATH=/projects/acme
   ```

5. **Type-specific global variables** - By download type
   ```bash
   OPTIMIZELY_DOWNLOAD_PATH_LOGS=/var/logs
   OPTIMIZELY_DOWNLOAD_PATH_DATABASE=/db/backups
   OPTIMIZELY_DOWNLOAD_PATH_BLOBS=/media
   ```

6. **Global download path** - Universal fallback
   ```bash
   OPTIMIZELY_DOWNLOAD_PATH=/shared/downloads
   ```

7. **Smart defaults** - Intelligent per-OS defaults
   - macOS: `~/Downloads/optimizely-mcp/`
   - Windows: `%USERPROFILE%\Downloads\optimizely-mcp\`
   - Linux: `~/downloads/optimizely-mcp/`

#### Folder Structure

Downloads are automatically organized by environment:

```
/downloads/
├── logs/
│   ├── [project-name]/
│   │   ├── production/
│   │   │   ├── azure-web-logs/
│   │   │   ├── azure-application-logs/
│   │   │   └── cloudflare-logs/
│   │   ├── preproduction/
│   │   └── integration/
│   └── [self-hosted-project]/
│       └── production/           # Self-hosted always uses 'production'
├── database/
│   ├── [project-name]/
│   │   ├── production/
│   │   ├── preproduction/
│   │   └── integration/
└── blobs/
    ├── [project-name]/
    │   ├── production/
    │   ├── preproduction/
    │   └── integration/
```

#### Configuration Examples

**Example 1: Simple global configuration**
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "npx",
      "args": ["-y", "@jaxon-digital/optimizely-dxp-mcp@latest"],
      "env": {
        "ACME_CORP": "id=xxx;key=yyy;secret=zzz",
        "OPTIMIZELY_DOWNLOAD_PATH": "/shared/optimizely-downloads"
      }
    }
  }
}
```

**Example 2: Project-specific paths**
```json
{
  "env": {
    "ACME_CORP": "id=xxx;key=yyy;secret=zzz",
    "CONTOSO": "id=aaa;key=bbb;secret=ccc",
    "OPTIMIZELY_ACME_CORP_DOWNLOAD_PATH": "/projects/acme",
    "OPTIMIZELY_CONTOSO_DOWNLOAD_PATH": "/projects/contoso"
  }
}
```

**Example 3: Type-specific paths**
```json
{
  "env": {
    "ACME_CORP": "id=xxx;key=yyy;secret=zzz",
    "OPTIMIZELY_DOWNLOAD_PATH_LOGS": "/var/log/optimizely",
    "OPTIMIZELY_DOWNLOAD_PATH_DATABASE": "/backups/databases",
    "OPTIMIZELY_DOWNLOAD_PATH_BLOBS": "/media/downloads"
  }
}
```

**Example 4: Compact field configuration (inline with credentials)**
```json
{
  "env": {
    "ACME": "id=xxx;key=yyy;secret=zzz;logPath=/custom/logs;dbPath=/custom/db;blobPath=/custom/media"
  }
}
```

**Example 5: Mixed configuration for agencies**
```json
{
  "env": {
    "CLIENT_A": "id=xxx;key=yyy;secret=zzz;logPath=/clients/a/logs",
    "CLIENT_B": "id=aaa;key=bbb;secret=ccc",
    "CLIENT_C": "id=111;key=222;secret=333",
    "OPTIMIZELY_CLIENT_B_DOWNLOAD_PATH": "/clients/b",
    "OPTIMIZELY_DOWNLOAD_PATH": "/agency/downloads"
  }
}
```

In this example:
- CLIENT_A uses inline path configuration
- CLIENT_B uses project-specific environment variable
- CLIENT_C falls back to global download path

#### Self-Hosted Projects

Self-hosted projects (using Azure Storage connection strings) always default to a 'production' folder since they don't have DXP's three-environment structure:

```
/downloads/
└── logs/
    └── my-self-hosted-project/
        └── production/          # Always 'production' for self-hosted
            ├── console-logs/
            ├── http-logs/
            └── application-logs/
```

#### Tips & Best Practices

1. **Use environment variables for shared teams** - Keeps paths consistent across team members
2. **Use compact fields for project portability** - Everything in one line
3. **Set type-specific paths for organization** - Logs, databases, and blobs in separate locations
4. **Use downloadPath parameter for one-off downloads** - Override without changing config
5. **Let smart defaults work** - They're designed to be intuitive per-OS

### ✅ Verify Your Setup

After configuration, test your connection:

```bash
"test connection"
# Tests the current active project and shows:
# ✅ Connected to Optimizely DXP (or Self-Hosted)
# ✅ Available capabilities based on your configuration
# ✅ Project: YOUR_PROJECT_NAME
```

### 📁 Generated Files

The MCP server creates certain files during operation. **Do not delete these files** as they are essential for proper functionality:

#### `.mcp-backup-state.json`
Tracks database export operations and enables auto-download functionality:
- **Purpose**: Maintains state of current and recent database exports
- **Location**: Created in your current working directory
- **Contents**: Export IDs, project info, download paths, and monitoring state
- **When created**: During database export operations
- **Why it's needed**: Enables background monitoring, auto-download, and resume capabilities

Example structure:
```json
{
  "currentExport": {
    "exportId": "abc-123-def",
    "projectId": "...",
    "environment": "Production",
    "autoDownload": true,
    "downloadPath": "/path/to/downloads"
  },
  "recentExports": [...]
}
```

**Important**: Without this file, auto-download won't work and you'll lose track of in-progress exports if the process is interrupted.

**Note**: The connection test only validates the current active project. Use `"list projects"` to see all configured projects.

### 🚀 Start Using

```bash
"show me what you can do"              # See all capabilities
"check production status"              # Get started
"export production database"           # Your first real operation
```

## 📚 Documentation

- **[Multi-Project Setup](./MULTI_PROJECT_CONFIG.md)** - Configure multiple DXP projects
- **[Windows Setup Guide](./WINDOWS_SETUP.md)** - Windows-specific configuration
- **[Understanding DXP Structure](./UNDERSTANDING_DXP_STRUCTURE.md)** - How Optimizely DXP works
- **[Advanced Features](./ADVANCED_FEATURES.md)** - Power user capabilities

## 🔑 Getting Your Optimizely Credentials

1. Log into [DXP Management Portal](https://portal.optimizely.com)
2. Navigate to Settings → API
3. Create an API key with appropriate permissions
4. Copy the Project ID, Key, and Secret

## 📖 Learn More

- **📝 Introduction Blog Post**: [AI-Powered Optimizely Deployments](https://accelerator.jaxondigital.com/blog/ai-powered-optimizely-deployments/) - How we built this and why

## 🤝 Support & Community

### Get Help
- **🐛 Issues**: [GitHub Issues](https://github.com/JaxonDigital/optimizely-dxp-mcp/issues)
- **📧 Email**: support@jaxondigital.com

### Connect With Jaxon Digital
- **🔗 LinkedIn**: [Follow us on LinkedIn](https://www.linkedin.com/company/jaxon-digital)
- **🌐 Website**: [jaxondigital.com](https://www.jaxondigital.com)

### About Jaxon Digital
We're an Optimizely Gold Partner specializing in AI-powered digital experiences. This MCP server is part of our mission to help teams ship faster and break less using AI automation.


## 🚀 Ready to Go Beyond the MCP?

### Here's the Truth...

**This MCP server? It's just the beginning.**

We built this tool because we were tired of watching talented teams waste their potential on repetitive tasks. We've been in the trenches with Optimizely DXP for years, and we know every pain point you're facing.

But here's what most people don't realize: **The companies winning in 2025 aren't just using AI - they're transforming their entire digital operations with it.**

### What We Really Do

While this MCP handles your DevOps, we're helping companies:

- **Build AI-powered experiences** that convert 3x better
- **Automate entire workflows** - not just deployments, but content creation, personalization, testing
- **Create intelligent agents** that monitor, optimize, and scale your digital presence 24/7
- **Integrate AI tools** that multiply your team's output by 10x
- **Transform your team** from operators to innovators

### The Opportunity You're Missing

Every day you wait, your competitors are:
- Shipping features 10x faster with AI automation
- Creating personalized experiences at scale
- Reducing operational costs by 70%
- Maximizing the value of your DXP investment

**The question isn't whether AI will transform your digital operations. It's whether you'll lead that transformation or get left behind.**

### Let's Talk About Your Real Problems

This MCP server solves one problem. **We solve all of them.**

- 🎯 **Free AI Strategy Session** - Let's map out your AI transformation
- 🛠️ **Custom MCP Development** - Tools built specifically for your workflows
- 🤖 **AI Agent Implementation** - Autonomous systems that run your operations
- 📈 **Full Optimizely Optimization** - Finally get the ROI you were promised
- 🚀 **Team Training & Enablement** - Turn your team into AI power users

### Take Action

**Stop settling for incremental improvements when exponential growth is possible.**

📧 **Let's talk**: hello@jaxondigital.com

## 📄 License

MIT - Built with ❤️ by [Jaxon Digital](https://www.jaxondigital.com)