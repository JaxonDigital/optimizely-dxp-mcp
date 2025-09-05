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
"export production database"               # Creates backup with auto-download
"download production blobs"                # Smart incremental - only new/changed files
"download blobs with filter *.pdf"         # Selective downloads with patterns
"download blobs force full"                # Bypass incremental, get everything
# AI tracks what you've downloaded to save bandwidth
```

### 5️⃣ Intelligent Log Analysis
```bash
# Access Application Insights logs with smart downloads
"download logs from last 7 days"           # Incremental - skips unchanged logs
"download web logs"                        # HTTP/IIS logs with manifest tracking
"download application logs"                # App logs for error analysis
"analyze logs for errors"                  # AI-powered log insights
# Generates manifest files for log analyzer teams
```

### 6️⃣ Multi-Project Management
```bash
# Perfect for agencies managing multiple clients
"switch to CLIENT2"                        # Instantly switch between projects
"list projects"                            # See all configured clients
"deploy to production for ACME"            # Project-specific operations
# Configure once, manage unlimited clients from one place
```

### 7️⃣ Download Management & Control
```bash
# Full control over active downloads
"list active downloads"                    # See what's downloading
"cancel download abc-123"                  # Stop specific download
"cancel all downloads"                     # Emergency stop all
"download history"                         # Review past downloads
```

### 8️⃣ Analytics & Insights (v3.18.0+)
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

- **Incremental Downloads** - Only downloads new/changed files, saves bandwidth
- **Intelligent Defaults** - Knows production is usually the source for backups
- **Auto-Retry Logic** - Handles transient failures automatically
- **Progress Tracking** - Real-time ETAs for long operations
- **Background Operations** - Start tasks and get notified when done
- **Natural Language** - Say what you want, not how to do it
- **Permission Adaptation** - Works with whatever access you have
- **AI Client Detection** - Knows if you're using Claude, ChatGPT, or Cursor
- **Confirmation Previews** - See what will happen before it happens

## 📋 System Requirements & Architecture

### What Gets Installed

When you install this MCP server, you get:
- **Node.js package** (~1MB) - The MCP server itself
- **EpiCloud PowerShell Module** (auto-installed on first run) - Official Optimizely tooling
- **No database** - Stateless operation
- **No external dependencies** - Everything runs locally

### Prerequisites

- **Node.js 18+** - Required for MCP protocol
- **PowerShell 7+** (macOS/Linux) or **PowerShell 5.1+** (Windows)
  - macOS: `brew install --cask powershell`
  - Windows: Pre-installed
  - Linux: [Install PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell)

### Why PowerShell Instead of REST API?

**We use Optimizely's official EpiCloud PowerShell module rather than raw REST APIs because:**

1. **Official Support** - EpiCloud is Optimizely's recommended automation tool
2. **Battle-tested** - Used by thousands of deployments daily
3. **Handles Complexity** - Manages auth, retries, pagination automatically
4. **Always Current** - Optimizely updates it with new features immediately
5. **Better Error Messages** - Human-readable errors vs HTTP status codes
6. **Proven Reliability** - We don't reinvent what Optimizely already perfected

Think of it this way: Would you rather use Optimizely's official tool that they use internally, or rebuild everything from scratch?

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

Then use: `"switch to CLIENT2"` to change projects within your session.

### ✅ Verify Your Setup

After configuration, test your connection:

```bash
"test connection"
# Should show: ✅ Connected to Optimizely DXP
#            ✅ Permissions: Integration, Preproduction, Production
#            ✅ Project: YOUR_PROJECT_NAME
```

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
- **[Log Capabilities](./LOG_CAPABILITIES.md)** - Log analysis in depth

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