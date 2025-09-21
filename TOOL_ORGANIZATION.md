# Optimizely DXP MCP Tool Organization

## Tool Categories and Usage Guide

### 🚀 Core Deployment Operations
**Purpose:** Handle deployment lifecycle in Optimizely DXP environments

| Tool | Purpose | When to Use |
|------|---------|------------|
| `start_deployment` | Start a new deployment | Initiating code/content deployments |
| `complete_deployment` | Complete an in-progress deployment | After smoke test verification |
| `reset_deployment` | Reset/rollback deployment | When deployment fails or needs rollback |
| `list_deployments` | List all deployments | View deployment history |
| `get_deployment_status` | Get specific deployment status | Check deployment progress |

### 🎯 Simplified Commands
**Purpose:** Natural language wrappers for common operations

| Tool | Purpose | When to Use |
|------|---------|------------|
| `deploy` | Smart deployment with defaults | Quick deployments without complex parameters |
| `status` | Intelligent status overview | Quick environment health check |
| `quick` | Ultra-fast status check | Rapid status verification |

### 💾 Database Operations
**Purpose:** Database export and backup management

| Tool | Purpose | When to Use |
|------|---------|------------|
| `export_database` | Start database export | Creating database backups |
| `check_export_status` | Check export progress | Monitoring export completion |
| `list_exports` | List available exports | Finding existing backups |
| `download_database_export` | Download completed export | Retrieving backup files |

### 📥 Download Operations
**Purpose:** Download logs, blobs, and other resources

| Tool | Purpose | When to Use |
|------|---------|------------|
| `download_logs` | Download specific log type | Getting application/web logs |
| `download_all_logs` | Download all log types | Comprehensive log collection |
| `download_blobs` | Download media/blobs | Retrieving media files |
| `batch_log_download` | Batch log operations | Multiple log downloads |
| `batch_blob_download` | Batch blob operations | Multiple blob downloads |

### 📊 Download Management
**Purpose:** Monitor and control active downloads

| Tool | Purpose | When to Use |
|------|---------|------------|
| `list_active_downloads` | Show current downloads | Monitor download progress |
| `cancel_download` | Cancel specific download | Stop unwanted download |
| `cancel_all_downloads` | Cancel all downloads | Emergency stop all |
| `get_download_status` | Get download progress | Check specific download |
| `download_history` | View past downloads | Review download activity |

### 🔧 Project Management
**Purpose:** Handle multi-project configurations

| Tool | Purpose | When to Use |
|------|---------|------------|
| `switch_project` | Change active project | Working with multiple projects |
| `get_current_project` | Show current project | Verify active project |
| `list_projects` | List all projects | View configured projects |

### 📦 Package Operations
**Purpose:** Package preparation and deployment

| Tool | Purpose | When to Use |
|------|---------|------------|
| `analyze_package` | Analyze package contents | Pre-deployment validation |
| `prepare_deployment_package` | Prepare package for deployment | Package optimization |
| `upload_deployment_package` | Upload package to DXP | Manual package upload |
| `split_package` | Split large packages | Handle oversized packages |
| `deploy_package_and_start` | Upload and deploy in one step | Streamlined deployment |

### 🔍 Discovery & Diagnostics
**Purpose:** Explore and troubleshoot environments

| Tool | Purpose | When to Use |
|------|---------|------------|
| `discover_logs` | Find available log containers | Exploring log availability |
| `list_storage_containers` | List all containers | View storage structure |
| `check_capabilities` | Check environment capabilities | Verify feature availability |
| `check_permissions` | Verify access permissions | Troubleshoot access issues |

### 📈 Monitoring
**Purpose:** Real-time deployment and system monitoring

| Tool | Purpose | When to Use |
|------|---------|------------|
| `monitor_deployment` | Monitor active deployment | Track deployment progress |
| `deployment_dashboard` | Full monitoring dashboard | Comprehensive monitoring |
| `update_monitoring_interval` | Change monitoring frequency | Adjust monitoring rate |
| `stop_monitoring` | Stop active monitoring | End monitoring session |

### 🏠 Self-Hosted Support
**Purpose:** Tools specific to self-hosted environments

| Tool | Purpose | When to Use |
|------|---------|------------|
| `self_hosted_download` | Download from self-hosted | Self-hosted file retrieval |
| `self_hosted_log_download` | Download self-hosted logs | Self-hosted log collection |

### ⚙️ Configuration & Setup
**Purpose:** Initial setup and configuration

| Tool | Purpose | When to Use |
|------|---------|------------|
| `setup_wizard` | Interactive setup guide | First-time configuration |
| `test_connection` | Test API connectivity | Verify setup |
| `health_check` | Quick health verification | System status check |
| `set_download_path` | Configure download location | Customize download paths |

## Tool Selection Guide

### "I want to deploy code"
1. Simple: Use `deploy`
2. Advanced: Use `start_deployment` → `complete_deployment`

### "I want to check status"
1. Quick check: Use `quick`
2. Detailed: Use `status`
3. Specific deployment: Use `get_deployment_status`

### "I need logs"
1. All logs: Use `download_all_logs`
2. Specific type: Use `download_logs`
3. Not sure what's available: Use `discover_logs`

### "I need a database backup"
1. Create new: Use `export_database`
2. Check existing: Use `list_exports`
3. Download: Use `download_database_export`

## Best Practices

### DO ✅
- Use simplified commands (`deploy`, `status`) for routine tasks
- Check permissions with `check_permissions` when access issues occur
- Use `discover_logs` before downloading to see what's available
- Monitor long deployments with `monitor_deployment`

### DON'T ❌
- Don't use multiple tools when one suffices
- Don't bypass safety checks in production
- Don't use debug/internal tools in automation
- Don't ignore tool suggestions in error messages

## Tool Consolidation History

### v3.14.3 - Major Consolidation
- Removed 5 AI-friendly wrapper tools
- Removed backup/backup_status/list_backups aliases
- Consolidated 6 permission checkers into one
- Merged database tools into single module

### v3.27.2 - Azure DevOps Removal
- Removed unused Azure DevOps deployment tools
- Reduced package size by ~27KB

## Current State
- **Total Tools:** ~40 distinct operations
- **Categories:** 11 functional groups
- **Redundancy:** Minimal after v3.14.3 consolidation
- **Maintenance:** Each tool serves a specific purpose