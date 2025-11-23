# Optimizely DXP MCP Server

[![npm version](https://img.shields.io/npm/v/@jaxon-digital/optimizely-dxp-mcp.svg)](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Downloads](https://img.shields.io/npm/dt/@jaxon-digital/optimizely-dxp-mcp.svg)](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)

## 🎉 What's New in v3.46

**Major improvements since September 2024:**

- **⚡ 3-10x Faster Operations**: PowerShell fully removed, direct REST API with HMAC-SHA256 authentication
- **🔷 TypeScript Migration**: Complete codebase conversion with strict mode compliance (479 errors fixed)
- **📊 Streaming Log Analysis**: New `analyze_logs_streaming` tool - 2x faster than download+analyze
- **🔄 45 Tools**: Expanded from 38 tools with unified naming and complete automation support
- **🤖 24 Tools with structuredContent**: Perfect for automation platforms (n8n, Zapier, Make.com)
- **🔴 Redis Integration**: Optional caching with circuit breaker and reconnection logic
- **📡 MCP Resources**: Real-time deployment monitoring via event subscription
- **🔀 Dual Transport Modes**: stdio for Claude Desktop, HTTP for automation platforms (n8n, Zapier, Docker)
- **🎯 Zero Dependencies**: No PowerShell, no Python, no external tools - just npm install

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

## 🌟 Key Features & Capabilities

### Zero Dependencies Architecture

**Direct REST API - No External Tools Required**

- **HMAC-SHA256 authentication**: Secure, standards-based API access
- **No PowerShell**: Completely removed in v3.44 - never needed again
- **No Python**: All JavaScript/TypeScript with Node.js runtime
- **Cross-platform**: Identical behavior on macOS, Linux, and Windows
- **Dual transport modes**: stdio for Claude Desktop, HTTP for automation platforms
- **Single install**: Just `npm install` - that's it!

**Performance Improvements:**
- Deployment operations: **3-10x faster** vs PowerShell
- Database exports: **5x faster**
- Log downloads: **3x faster**

### AI-Powered Operations (45 Tools)

**Comprehensive DXP Management:**

#### 1. **Deployment Management**
- Autonomous deployment with health monitoring
- Rollback and reset capabilities
- Content sync between environments
- Real-time progress tracking with ETAs
- MCP Resources subscription for live events

#### 2. **Log Analysis & Intelligence**
- **Streaming analysis** (2x faster than download+analyze)
- **Compare logs** tool for deployment decisions
- AI agent detection and pattern recognition
- Performance metrics and error analysis
- Structured output for automation workflows

#### 3. **Database Operations**
- Interactive export workflow with smart monitoring
- Automated backup downloads
- Export status tracking
- Background downloads with progress updates

#### 4. **Storage Management**
- Incremental blob downloads (only changed files)
- Manifest tracking for efficiency
- Pattern-based filtering (*.pdf, *.jpg, etc.)
- **5x faster** with parallel downloads

#### 5. **Real-Time Monitoring**
- MCP Resources subscription for deployment events
- Webhook notifications for external automation
- Health checks and connection testing
- Environment access verification

### Enterprise-Ready Architecture

**Built for Scale and Reliability:**

- **Redis Integration** (Optional)
  - Circuit breaker pattern for automatic fallback
  - Reconnection logic with exponential backoff
  - Caching layer for repeated queries
  - 12 integration tests covering all scenarios

- **Rate Limiting & Retry**
  - Automatic retry with exponential backoff
  - HTTP 429 (rate limit) handling
  - Respects Retry-After headers

- **Event System**
  - MCP Resources for real-time updates
  - Webhook-ready for external integration
  - Event streaming without polling

- **Type Safety**
  - Full TypeScript with strict mode
  - 479 type errors fixed across codebase
  - Better IDE support and auto-completion

### Automation Platform Support

**Native Integration with Workflow Tools:**

- **HTTP Transport Mode**: Dual-mode operation (stdio for Claude, HTTP for automation)
- **24 Tools with structuredContent**: Native MCP field for structured data
- **Direct Property Access**: No JSON.parse() needed - `response.structuredContent.data.deploymentId`
- **Platform Support**: n8n, Zapier, Make.com, custom workflows
- **Webhook-Ready**: Event system for external automation

See [N8N_INTEGRATION.md](./N8N_INTEGRATION.md) for automation platform setup.

## 🔀 Transport Modes

The MCP server supports **two transport modes** for different deployment scenarios:

### stdio Mode (Default)

**Best for:** Claude Desktop, local AI clients, single-user development

**Characteristics:**
- Process-to-process communication via stdin/stdout
- No network ports required
- Automatically started by Claude Desktop
- Lowest latency and most secure (no network exposure)
- Ideal for local development and desktop AI applications

**Setup:**
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "npx",
      "args": ["-y", "@jaxon-digital/optimizely-dxp-mcp"],
      "env": {
        "OPTIMIZELY_PROJECT_ID": "your-id",
        "OPTIMIZELY_PROJECT_KEY": "your-key",
        "OPTIMIZELY_PROJECT_SECRET": "your-secret"
      }
    }
  }
}
```

**No additional configuration needed** - stdio is the default mode.

---

### HTTP Mode

**Best for:** n8n, Zapier, Make.com, Docker, remote access, multi-tenant platforms

**Characteristics:**
- RESTful HTTP server with JSON-RPC 2.0
- MCP endpoint: `POST /mcp`
- Health check: `GET /health`
- Supports concurrent remote connections
- Production-ready with graceful shutdown

**Setup:**
```bash
# Start HTTP server
DXP_MCP_MODE=http DXP_MCP_PORT=3001 npm start

# Or with Docker
docker run -p 3001:3001 \
  -e DXP_MCP_MODE=http \
  -e OPTIMIZELY_PROJECT_ID=your-id \
  -e OPTIMIZELY_PROJECT_KEY=your-key \
  -e OPTIMIZELY_PROJECT_SECRET=your-secret \
  jaxon-digital/optimizely-dxp-mcp
```

**Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `DXP_MCP_MODE` | `stdio` | Set to `http` to enable HTTP mode |
| `DXP_MCP_PORT` | `3001` | HTTP server port (1-65535) |
| `DXP_MCP_HOST` | `0.0.0.0` | Bind address (`localhost` for local only, `0.0.0.0` for Docker/remote) |

**Health Check:**
```bash
curl http://localhost:3001/health
# Returns: {"status":"ok","service":"optimizely-dxp-mcp","version":"3.46.0"}
```

---

### Decision Guide

| Scenario | Mode | Why |
|----------|------|-----|
| Claude Desktop usage | **stdio** | Default, fastest, most secure |
| n8n workflow automation | **http** | REST API, remote access |
| Zapier/Make.com integration | **http** | Webhook support, structured data |
| Docker deployment | **http** | Network connectivity, multiple clients |
| Local development (single user) | **stdio** | Simplest setup, no ports needed |
| Multi-tenant SaaS platform | **http** | Concurrent connections, load balancing |
| Remote server deployment | **http** | Network accessibility required |

**All 45 tools work identically in both modes** - only the transport layer changes.

## 📋 Complete Tool Reference (45 Tools)

### Permission & Access Management (4 tools)
- `test_connection` - Validate setup and show capabilities
- `check_permissions` - Detailed environment access breakdown
- `verify_access` - Confirm specific environment access
- `health_check` - System status with structured health data

### Deployments & Content Sync (10 tools)
- `list_deployments` - Show deployment history with filters
- `start_deployment` - Initiate code deployment
- `monitor_deployment` - Real-time progress with auto-refresh
- `complete_deployment` - Finish verification state
- `reset_deployment` - Rollback if needed
- `get_deployment_status` - Current status with wait-then-check support
- `copy_content` - Sync content between environments
- `list_content_copies` - Show content copy history

### Database Management (4 tools)
- `export_database` - Interactive workflow with smart monitoring
- `check_export_status` - Progress tracking with auto-download flag
- `download_database_export` - Get export file with background progress
- `list_recent_exports` - Export history and monitoring

### Log Analysis & Downloads (6 tools)
- `analyze_logs_streaming` - **NEW**: Stream and analyze in-memory (2x faster)
- `compare_logs` - **NEW**: Side-by-side comparison for deployment decisions
- `download_logs` - Download with manifest tracking (incremental)
- `list_log_containers` - Show available log containers
- `discover_logs` - Find logs by date range and type
- `check_download_status` - Progress tracking for active downloads

### Storage Management (5 tools)
- `list_storage_containers` - Show blob containers with structured data
- `download_blobs` - Incremental downloads (only changed files, 5x faster with parallel)
- `generate_storage_sas_link` - Create temporary access URLs
- `list_download_history` - Show completed downloads with manifests

### Multi-Project Management (3 tools)
- `list_projects` - Show all configured projects
- `switch_project` - Change active project context
- `current_project` - Display active project info

### Configuration & Utilities (6 tools)
- `get_ai_guidance` - Context-aware best practices
- `get_version` - Version info with update checks
- `get_download_paths` - Show download configuration
- `set_download_path` - Configure paths by type
- `list_active_downloads` - Progress for all background downloads
- `cancel_download` - Stop background download

### Advanced Features (7 tools)
- `get_rate_limit_status` - Show API quota and limits
- `get_cache_status` - Redis cache statistics (if enabled)
- `monitor_project_upgrades` - Track DXP CMS version updates
- `enable_http_logs` - Configure HTTP log streaming
- `disable_http_logs` - Disable HTTP log streaming
- `get_tool_availability` - Show which tools work in current context
- `subscribe_deployment_events` - **NEW**: MCP Resources for real-time updates

**Total**: 45 tools organized in 8 categories

## 🎯 Performance Benchmarks

### REST API vs PowerShell (v3.44+)

| Operation | PowerShell | REST API | Improvement |
|-----------|------------|----------|-------------|
| Start Deployment | 8-12s | 1-2s | **5-10x faster** |
| Database Export | 10-15s | 2-3s | **5x faster** |
| Log Download | 6-9s | 2-3s | **3x faster** |
| Environment List | 4-6s | 0.5-1s | **6-8x faster** |

### Streaming vs Download+Analyze

| Operation | Download+Analyze | Streaming | Improvement |
|-----------|------------------|-----------|-------------|
| Last Hour Logs | 30-45s | 15-20s | **2x faster** |
| Memory Usage | High (full download) | Low (streaming) | **4-6x less** |
| Disk I/O | Heavy (write + read) | None (memory only) | **Eliminated** |
| Automation Ready | Post-processing needed | Structured output | **Immediate** |

### Parallel Downloads

| Files | Sequential | Parallel | Improvement |
|-------|-----------|----------|-------------|
| 100 blobs | 250s | 50s | **5x faster** |
| 500 blobs | 1250s | 260s | **5x faster** |
| Log archives | 180s | 45s | **4x faster** |

## ⚠️ IMPORTANT: No Manual Startup Required

**DO NOT run `npm start` or `node index.js` - The MCP is NOT a traditional server!**

### ❌ What NOT to Do
- **DO NOT run `npm start`** - The MCP is not a standalone server
- **DO NOT run `node dist/index.js` directly** - Claude handles execution automatically
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

## 🛠️ System Requirements

**Minimal Requirements - Zero External Dependencies:**

- **Node.js 18+** (LTS recommended) - [Download](https://nodejs.org/)
- **Optimizely DXP Project** with API credentials
- **That's it!** No PowerShell, no Python, no external tools

**Supported Platforms:**
- ✅ macOS (Intel & Apple Silicon)
- ✅ Linux (Ubuntu, Debian, RHEL, etc.)
- ✅ Windows 10/11 (no PowerShell needed!)

**Optional Enhancements:**
- **Redis** (optional) - For caching and performance boost
- **Docker** (optional) - For containerized deployment with automation platforms

## 🚀 Quick Start

### Installation

#### Option 1: npx (Recommended - Always Latest)
No installation needed! Configure Claude to use npx:

```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "npx",
      "args": [
        "-y",
        "@jaxon-digital/optimizely-dxp-mcp"
      ],
      "env": {
        "OPTIMIZELY_PROJECT_ID": "your-project-id",
        "OPTIMIZELY_PROJECT_KEY": "your-key",
        "OPTIMIZELY_PROJECT_SECRET": "your-secret"
      }
    }
  }
}
```

#### Option 2: Global Install (Faster Startup)
```bash
npm install -g @jaxon-digital/optimizely-dxp-mcp
```

Then configure Claude:
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_ID": "your-project-id",
        "OPTIMIZELY_PROJECT_KEY": "your-key",
        "OPTIMIZELY_PROJECT_SECRET": "your-secret"
      }
    }
  }
}
```

### Configuration

#### Single Project Setup

**Using Environment Variables:**
```bash
export OPTIMIZELY_PROJECT_ID="12345678-1234-1234-1234-123456789012"
export OPTIMIZELY_PROJECT_KEY="your_api_key"
export OPTIMIZELY_PROJECT_SECRET="your_api_secret"
```

**In Claude's config.json:**
```json
{
  "env": {
    "OPTIMIZELY_PROJECT_ID": "12345678-1234-1234-1234-123456789012",
    "OPTIMIZELY_PROJECT_KEY": "your_api_key",
    "OPTIMIZELY_PROJECT_SECRET": "your_api_secret"
  }
}
```

#### Multi-Project / Multi-Tenant Setup

**For agencies managing multiple clients:**

```bash
export CLIENT1="id=uuid1;key=key1;secret=secret1;logPath=/logs/client1;dbPath=/db/client1"
export CLIENT2="id=uuid2;key=key2;secret=secret2;logPath=/logs/client2;dbPath=/db/client2"
```

Then use:
```
"switch to CLIENT2"
"list projects"
"show current project"
```

See [MULTI_PROJECT_CONFIG.md](./MULTI_PROJECT_CONFIG.md) for complete guide.

#### Advanced Configuration

**Redis Integration (Optional):**
```bash
export REDIS_HOST="localhost"
export REDIS_PORT="6379"
export REDIS_PASSWORD="optional"
export REDIS_ENABLED="true"
```

**HTTP Transport for Automation Platforms:**
```bash
export DXP_MCP_MODE="http"
export DXP_MCP_PORT="3001"
export DXP_MCP_HOST="0.0.0.0"
```

**Download Path Configuration (7-level priority):**
1. Command parameter: `downloadPath=/custom/path`
2. Compact field: `PROJECT="...;logPath=/path"`
3. Project + type: `OPTIMIZELY_PROJECT_DOWNLOAD_PATH_LOGS=/path`
4. Project-specific: `OPTIMIZELY_PROJECT_DOWNLOAD_PATH=/path`
5. Type-specific: `OPTIMIZELY_DOWNLOAD_PATH_LOGS=/path`
6. Global: `OPTIMIZELY_DOWNLOAD_PATH=/path`
7. Smart OS defaults: `~/Downloads/optimizely-mcp/`

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

### 5️⃣ Log Analysis & Downloads
```bash
# ⚡ NEW: Stream and analyze logs in-memory (2x faster than download + analyze)
"analyze logs from last hour"             # Streaming analysis with structured output
"analyze application logs last 30 min"    # Console logs for errors and patterns
"analyze web logs from production"        # HTTP logs with performance metrics
"compare logs before and after deploy"    # Side-by-side comparison tool

# Traditional downloads with manifest tracking
"download logs from last 7 days"          # Incremental - skips unchanged logs
"download web logs"                       # HTTP/IIS logs with manifest tracking
"download application logs"               # App logs for external analysis
"download all logs"                       # All available log types
# Generates manifest files for external log analyzer tools
```

### 6️⃣ Multi-Project Management
```bash
# Perfect for agencies managing multiple clients
"switch to CLIENT2"                        # Instantly switch between projects
"list projects"                            # See all configured clients
"show current project"                     # Display active project details
```

### 7️⃣ Automation & Integration
```bash
# Real-time events and automation workflows
"subscribe to deployment events"           # MCP Resources for live updates
"generate SAS link for container"          # Temporary blob access URLs
"check rate limit status"                  # API quota and usage
"check cache status"                       # Redis statistics (if enabled)
```

## 🔄 Automation & Integration

### HTTP Transport Mode

**For n8n, Zapier, Make.com, and custom workflows:**

```bash
# Start in HTTP mode
DXP_MCP_MODE=http DXP_MCP_PORT=3001 node dist/index.js

# Or with Docker
docker run -p 3001:3001 \
  -e DXP_MCP_MODE=http \
  -e OPTIMIZELY_PROJECT_ID=your-id \
  -e OPTIMIZELY_PROJECT_KEY=your-key \
  -e OPTIMIZELY_PROJECT_SECRET=your-secret \
  jaxon-digital/optimizely-dxp-mcp
```

**Health Check:**
```bash
curl http://localhost:3001/health
```

### Structured Data Support

**24 tools with native `structuredContent` field:**

```javascript
// Example: Start deployment
{
  "content": [
    {
      "type": "text",
      "text": "✅ Deployment started to Production..."
    }
  ],
  "structuredContent": {
    "success": true,
    "data": {
      "deploymentId": "c88fa98f-9d3c-4e91-8f77-5a7f3e2d1b0a",
      "status": "InProgress",
      "environment": "Production",
      "previewUrl": "https://..."
    }
  }
}
```

**Direct property access in workflows:**
```javascript
// n8n, Zapier, Make.com
const deploymentId = response.structuredContent.data.deploymentId;
const status = response.structuredContent.data.status;
// No JSON.parse() needed!
```

**Supported Tools:**
- All deployment tools (list, start, monitor, complete, reset, status)
- Database operations (export, status, download, list)
- Log operations (download, status, streaming analysis)
- Storage operations (list containers, generate SAS, download blobs)
- Download management (status, active downloads, history)
- Project management (list, switch, current)
- System utilities (test connection, health check, version, rate limits)

### Webhook Integration

**For external automation:**

```bash
# Subscribe to deployment events
"subscribe to deployment events"

# Events are pushed to external systems:
# - Deployment started
# - Deployment progress updates
# - Deployment completed/failed
# - Content sync completed
# - Database export ready
```

See [N8N_INTEGRATION.md](./N8N_INTEGRATION.md) for complete automation setup guide.

## 📚 Documentation

- **[API Reference](./API_REFERENCE.md)** - Complete tool documentation with parameters and response formats
- **[Multi-Project Configuration](./MULTI_PROJECT_CONFIG.md)** - Agency/multi-tenant setup guide
- **[N8N Integration](./N8N_INTEGRATION.md)** - Automation platform setup and workflows
- **[Client Application Logging](./CLIENT_APPLICATION_LOGGING_GUIDE.md)** - Configure Application Insights
- **[Telemetry](./TELEMETRY.md)** - Privacy-focused usage analytics
- **[Windows Setup](./WINDOWS_SETUP.md)** - Platform-specific notes (no PowerShell needed!)
- **[Changelog](./CHANGELOG.md)** - Version history and release notes

## 📊 Structured Logging

DXP MCP uses structured JSON logging for production observability. All operations log machine-parseable JSON to stdout.

### Log Format

Each log entry is a single-line JSON object:

```json
{
  "timestamp": "2025-11-09T12:00:00.123Z",
  "level": "info",
  "message": "Deployment initiated",
  "correlation_id": "1699564800000-abc123xyz",
  "tool": "start_deployment",
  "environment": "production",
  "deployment_id": "12345"
}
```

**Standard Fields:**
- `timestamp` - ISO 8601 timestamp with milliseconds
- `level` - Log level (debug, info, warn, error)
- `message` - Human-readable message
- `correlation_id` - Links related operations together
- Additional metadata fields vary by operation

### Log Levels

- `debug` - API requests, detailed progress, internal operations
- `info` - Significant events (deployment started, export complete)
- `warn` - Recoverable issues (retries, fallbacks)
- `error` - Failures requiring attention

### Querying Logs

**CloudWatch Logs Insights:**

```
# Find all deployments in last hour
fields @timestamp, message, deployment_id, environment
| filter level = "info" and tool = "start_deployment"
| sort @timestamp desc

# Track specific deployment by correlation ID
fields @timestamp, message, duration_ms
| filter correlation_id = "1699564800000-abc123xyz"
| sort @timestamp asc

# Find slow operations (>5 seconds)
fields @timestamp, message, duration_ms, tool
| filter duration_ms > 5000
| sort duration_ms desc
```

**Datadog:**

```
# Find errors in production deployments
level:error tool:start_deployment environment:production

# Track deployment flow
correlation_id:"1699564800000-abc123xyz"

# Performance analysis
@duration_ms:>5000
```

**Splunk:**

```
# Find all deployment errors
index=dxp_mcp level=error tool=start_deployment

# Average deployment duration
index=dxp_mcp tool=start_deployment duration_ms=*
| stats avg(duration_ms) by environment

# Correlation ID trace
index=dxp_mcp correlation_id="1699564800000-abc123xyz"
| sort _time
```

### Correlation IDs

All related operations share a correlation ID. Example flow:

1. `start_deployment` - correlation_id: `12345-abc`
2. `monitor_deployment` - correlation_id: `12345-abc` (same)
3. `complete_deployment` - correlation_id: `12345-abc` (same)

Query by correlation ID to see full deployment lifecycle.

### Developer Guide

When adding logging to a new tool:

```javascript
const { StructuredLogger } = require('../structured-logger');

// Create logger with tool context
const logger = new StructuredLogger({
  context: { tool: 'your_tool_name' }
});

// Log significant events
logger.info('Operation started', {
  key1: value1,
  key2: value2
});

// Log API calls
logger.logAPIRequest('POST', '/api/endpoint', { body: requestBody });
logger.logAPIResponse('/api/endpoint', response.status, duration);

// Log errors
logger.error('Operation failed', {
  error: error.message,
  stack: error.stack
});

// Track duration
logger.startTimer('operation_name');
// ... do work ...
logger.endTimer('operation_name', { result_count: 10 });
```

### Security

Headers are automatically sanitized to remove:
- Authorization tokens
- API keys
- Authentication credentials

Logs are safe to aggregate and store without exposing secrets.

## 🔍 Audit Trail

DXP MCP maintains an immutable audit trail of all tool invocations for compliance and observability.

### What is Audited

Every tool invocation is logged with:
- **Timestamp** - When the operation occurred
- **Tool name** - Which tool was invoked
- **Parameters** - Input arguments (sanitized to remove secrets)
- **Result** - Operation outcome (success/error)
- **Duration** - How long the operation took
- **Metadata** - Additional context (environment, project, etc.)

**Example audit entry:**

```json
{
  "timestamp": "2025-11-09T12:00:00.123Z",
  "operation": "start_deployment",
  "operation_type": "deployment",
  "status": "success",
  "user": { "id": "user-123" },
  "environment": { "project_id": "proj-456", "slot": "production" },
  "request": {
    "tool": "start_deployment",
    "parameters": { "sourceEnvironment": "integration", "targetEnvironment": "production" },
    "correlation_id": "12345-abc"
  },
  "response": {
    "result": "success",
    "duration_ms": 1250
  }
}
```

### Storage Location

Audit logs are stored in `./audit-logs/` as JSON Lines files:

```
audit-logs/
├── audit-2025-11-09.jsonl
├── audit-2025-11-08.jsonl
└── audit-2025-11-07.jsonl
```

Each line is a complete JSON object for easy parsing.

### Querying Audit Logs

**Via MCP Tool:**

```javascript
// Get all deployments in last 24 hours
query_audit_log({
  tool_name: "start_deployment",
  start_time: "2025-11-08T12:00:00Z",
  end_time: "2025-11-09T12:00:00Z"
})

// Get failed operations
query_audit_log({
  status: "failure",
  limit: 50
})
```

**Via Command Line:**

```bash
# View all audit logs
cat audit-logs/audit-*.jsonl | jq

# Filter by tool
cat audit-logs/audit-*.jsonl | jq 'select(.operation=="start_deployment")'

# Find errors
cat audit-logs/audit-*.jsonl | jq 'select(.status=="failure")'

# Count operations by tool
cat audit-logs/audit-*.jsonl | jq -r '.operation' | sort | uniq -c
```

### Retention Policy

**Recommended retention periods:**

- **Active logs:** Keep 90 days online for queries
- **Archive:** Move logs older than 90 days to cold storage (S3, tape)
- **Compliance:** Retain 7 years for regulated industries (finance, healthcare)
- **Deletion:** After retention period, securely delete per policy

**Example archival script:**

```bash
#!/bin/bash
# Archive audit logs older than 90 days

find ./audit-logs -name "audit-*.jsonl" -mtime +90 -exec mv {} ./archive/ \;
```

### GDPR and Compliance

**PII Handling:**
- Audit logs may contain user identifiers (email, username)
- Support data subject access requests (query by user_id)
- Support right to erasure (delete user's audit entries if required)

**Data Sanitization:**
- Passwords, API keys, tokens automatically redacted
- Field names containing "password", "secret", "token" are redacted
- Authorization headers removed from API request logs

**Compliance Features:**
- Immutable append-only logs (cannot modify/delete individual entries)
- Timestamp integrity (ISO 8601 with milliseconds)
- Unique correlation IDs for request tracking
- Version tracking (MCP server version in each entry)

### Configuration

**Environment Variables:**

```bash
# Disable audit logging (development only)
DXP_AUDIT_ENABLED=false

# Custom audit directory
DXP_AUDIT_DIR=/var/log/dxp-mcp

# Custom audit retention days (for automated cleanup)
DXP_AUDIT_RETENTION_DAYS=90
```

### Security

- Audit logs stored locally (not sent to external services)
- File permissions: 600 (owner read/write only)
- Directory permissions: 700 (owner access only)
- Sensitive data automatically sanitized before logging

### Monitoring

**Key metrics to track:**
- Total tool invocations per day
- Error rate by tool (errors / total invocations)
- Average duration by tool
- Failed authentication attempts

**Example monitoring query:**

```bash
# Daily summary report
cat audit-logs/audit-$(date +%Y-%m-%d).jsonl | jq -s '
  group_by(.operation) |
  map({
    tool: .[0].operation,
    total: length,
    errors: map(select(.status == "failure")) | length,
    avg_duration: (map(.response.duration_ms) | add / length)
  })
'
```

## 🔄 Migration from v3.3x

**Major changes in v3.44-v3.46:**

### Breaking Changes

1. **Tool Renames** (v3.42):
   - Database tools: `db_export*` prefix (was `export_database*`)
   - Download tools: `download_*` prefix (was `get_*`)

2. **PowerShell Removed** (v3.44):
   - No action needed - automatic migration to REST API
   - 3-10x performance improvement
   - Identical functionality

3. **Deprecated Tools Removed**:
   - `download_media`, `download_assets` → use `download_blobs`
   - Old database tool names → use `db_export*` versions

### Migration Steps

**If upgrading from v3.3x:**

1. **Update to latest version:**
   ```bash
   npm update -g @jaxon-digital/optimizely-dxp-mcp
   ```

2. **No configuration changes needed** - credentials and environment variables work the same

3. **Test connection:**
   ```
   "test connection"
   ```

4. **Update any scripts** that reference old tool names (see API Reference)

**Benefits:**
- **3-10x faster** operations (REST API vs PowerShell)
- **2x faster** log analysis (streaming)
- **45 tools** (up from 38)
- **24 tools** with automation support
- **Zero dependencies** - no PowerShell needed

## 🤝 Support & Community

### Getting Help

- **Documentation**: Start with [API Reference](./API_REFERENCE.md)
- **Issues**: [GitHub Issues](https://github.com/JaxonDigital/optimizely-dxp-mcp/issues)
- **Updates**: Follow releases on [npm](https://www.npmjs.com/package/@jaxon-digital/optimizely-dxp-mcp)

### Troubleshooting

**Common Issues:**

1. **"Cannot find module"**
   - Run `npm run build` to generate dist/ folder
   - Verify dist/index.js exists

2. **"Connection failed"**
   - Check credentials are correct
   - Verify project has API access enabled
   - Run `test connection` to diagnose

3. **"Rate limited (429)"**
   - Automatic retry with exponential backoff handles this
   - Check `get rate limit status` for quota

4. **HTTP mode issues**
   - Verify port 3001 is available
   - Check `DXP_MCP_MODE=http` is set
   - Test with `curl http://localhost:3001/health`

See [N8N_INTEGRATION.md](./N8N_INTEGRATION.md) troubleshooting section for automation platform issues.

## 🛠️ Development

### Building from Source

This project uses TypeScript and requires building before running:

```bash
# Clone the repository
git clone https://github.com/JaxonDigital/optimizely-dxp-mcp-private.git
cd optimizely-dxp-mcp-private

# Install dependencies
npm install

# Build TypeScript → JavaScript (REQUIRED after any code changes)
npm run build

# Run tests
npm test
```

**Important**: The TypeScript source files in `lib/` and `src/` are compiled to JavaScript in `dist/`. After editing any `.ts` files, you MUST run `npm run build` before testing changes.

**Build Output:**
- `dist/index.js` - Main entry point (bundled with esbuild)
- `dist/lib/**/*.js` - Compiled library modules
- Build happens automatically on `npm install` (via `prepare` hook)
- Build happens automatically before `npm publish` (via `prepublishOnly` hook)

### Testing Changes Locally

```bash
# Build after making changes
npm run build

# Run CI test suite (fast - 15 tests)
npm test

# Run full test suite (comprehensive)
npm run test:full

# Run specific test suites
npm run test:logger      # Structured logger tests
npm run test:security    # Security helper tests
npm run test:projects    # Multi-project resolution tests
```

### Development Workflow

1. Make changes to TypeScript files in `lib/` or `src/`
2. Run `npm run build` to compile
3. Run `npm test` to verify
4. Create PR when tests pass

### Project Structure

```
lib/                    # TypeScript source files
├── tools/             # MCP tool implementations
├── *.ts               # Core modules (telemetry, config, etc.)
src/
├── index.ts           # Main MCP server entry point
dist/                  # Compiled JavaScript (gitignored)
├── index.js           # Bundled server (esbuild output)
├── lib/               # Compiled modules
tests/                 # Test files
├── ci-test.js         # Fast CI test suite
├── test-suite.js      # Comprehensive tests
```

### Related Projects

- **[Log Analyzer MCP](https://github.com/JaxonDigital/log-analyzer-mcp)** - AI-powered log analysis and anomaly detection
- **[Optimizely CMS Modernizer](https://github.com/JaxonDigital/cms-modernizer-mcp)** - CMS 11 → CMS 12 migration assistant
- **[Model Context Protocol](https://modelcontextprotocol.io)** - Official MCP specification

## 📜 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

Built with:
- [Model Context Protocol SDK](https://github.com/modelcontextprotocol/sdk) - MCP protocol implementation
- [Optimizely DXP API](https://docs.developers.optimizely.com/digital-experience-platform/v1.0/docs/deploy-api) - Deployment REST API
- [Azure Storage SDK](https://github.com/Azure/azure-sdk-for-js) - Blob storage operations
- [TypeScript](https://www.typescriptlang.org/) - Type-safe development
- [esbuild](https://esbuild.github.io/) - Fast bundling

---

**Made with ❤️ by [Jaxon Digital](https://github.com/JaxonDigital)**

*Transforming Optimizely DXP from platform to AI-powered workforce*
