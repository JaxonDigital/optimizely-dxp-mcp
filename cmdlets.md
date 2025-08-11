# Jaxon Digital - Optimizely DXP MCP Server - PowerShell-Only Implementation

This document lists all available PowerShell cmdlets in the EpiCloud module that we use for our **PowerShell-only** Jaxon Digital Optimizely DXP MCP server.

## 🔧 **Architecture Decision: PowerShell-Only**

We've implemented a **PowerShell-only** approach because:
- ✅ **More Reliable**: PowerShell cmdlets work consistently vs API calls returning login pages
- ✅ **Better Error Handling**: Structured error responses from PowerShell 
- ✅ **Official Support**: EpiCloud module is officially maintained by Optimizely
- ✅ **Complete Functionality**: Access to all DXP operations through cmdlets

## 📋 **Installation Requirements**

Clients installing our MCP server need:

1. **PowerShell Core** (pwsh) - Cross-platform PowerShell 7+
2. **EpiCloud PowerShell Module** - Official Optimizely module

```bash
# Install PowerShell Core (if needed)
# Mac: brew install powershell
# Windows: winget install Microsoft.PowerShell  
# Linux: varies by distro

# Install EpiCloud module
pwsh -Command "Install-Module EpiCloud -Force"
```

## Authentication
- **`Connect-EpiCloud`** - Authenticate with DXP using API key/secret and project ID
  - **Status**: ✅ Working
  - **Usage**: Required first step for all other cmdlets

## Deployment Operations
- **`Add-EpiDeploymentPackage`** - Upload deployment packages to DXP
  - **Status**: ✅ Working
  - **MCP Tool**: `upload_deployment_package`
  - **Purpose**: Upload NuGet packages for deployment
  - **Features**: Custom package naming, progress tracking, comprehensive error handling

- **`Start-EpiDeployment`** - Start deployment to environment
  - **Status**: ✅ Working (Complete Implementation)
  - **MCP Tool**: `start_deployment`
  - **Purpose**: Deploy code to target environment with advanced options
  - **Features**: 
    - **Package Deployments**: Deploy uploaded NuGet packages
    - **Environment Promotion**: Deploy code from Integration → Preproduction → Production
    - **Content Sync**: Database and BLOB synchronization between environments
    - **Enterprise Options**: Maintenance page, zero downtime mode, direct deploy
    - **Advanced Settings**: Warm-up URLs, wait for completion, custom timeouts

- **`Complete-EpiDeployment`** - Complete deployment (move to live)
  - **Status**: ✅ Working
  - **MCP Tool**: `complete_deployment`
  - **Purpose**: Move deployment from staging slot to live environment
  - **Features**: Wait for completion, custom timeouts, comprehensive status tracking

- **`Reset-EpiDeployment`** - Reset/rollback deployment
  - **Status**: ✅ Working
  - **MCP Tool**: `reset_deployment`
  - **Purpose**: Rollback failed or unwanted deployments
  - **Features**: Database rollback options, wait for completion, detailed reset status

- **`Get-EpiDeployment`** - Get deployment status and information
  - **Status**: ✅ Working
  - **MCP Tool**: `get_deployment_status`
  - **Purpose**: Monitor deployment progress and status
  - **Features**: Rich progress tracking, duration calculations, preview URLs, validation links

- **`Get-EpiDeploymentPackageLocation`** - Get package download location
  - **Status**: ⚠️ Not needed for current implementation
  - **Note**: Environment-to-environment promotion works directly through `Start-EpiDeployment`

## Database Operations
- **`Start-EpiDatabaseExport`** - Export database as BACPAC
  - **Status**: ✅ Working
  - **MCP Tool**: `export_database`
  - **Purpose**: Primary method for database export with better error handling
  - **Features**: Handles concurrent export detection, server errors, detailed status reporting, custom retention

- **`Get-EpiDatabaseExport`** - Check database export status
  - **Status**: ✅ Working
  - **MCP Tool**: `check_export_status`
  - **Purpose**: Monitor database export progress and get download links
  - **Features**: Smart JSON parsing, download link generation, comprehensive status tracking

- **`Start-EpiDeployment`** (Content Sync) - Sync databases and BLOBs between environments
  - **Status**: ✅ Working
  - **MCP Tool**: `copy_content`
  - **Purpose**: Database and BLOB synchronization between environments
  - **Features**: Selective sync options, ongoing deployment detection, comprehensive error handling

## Storage Operations
- **`Get-EpiStorageContainer`** - List BLOB storage containers
  - **Status**: ✅ Working
  - **MCP Tool**: `list_storage_containers`
  - **Purpose**: List available BLOB storage containers for an environment
  - **Features**: Smart JSON extraction, comprehensive container metadata
  - **Example Output**: 
    ```json
    {
      "projectId": "guid",
      "environment": "Production",
      "storageContainers": [
        "insights-logs-appserviceconsolelogs",
        "insights-logs-appservicehttplogs",
        "mysitemedia",
        "sourcemaps"
      ]
    }
    ```

- **`Get-EpiStorageContainerSasLink`** - Generate SAS links for container access
  - **Status**: ✅ Working
  - **MCP Tool**: `generate_storage_sas_link`
  - **Purpose**: Generate time-limited SAS URLs for container access
  - **Features**: 
    - Configurable retention hours (default 24, max varies)
    - Read/write access control (`-Writable` switch)
    - Automatic URL validation and expiration tracking
    - Comprehensive error handling for container access

## Logging
- **`Get-EpiEdgeLogLocation`** - Get edge/CDN log locations
  - **Status**: ✅ Working
  - **MCP Tool**: `get_edge_logs`
  - **Purpose**: Access CDN and edge server logs for analysis and troubleshooting
  - **Features**: 
    - Retrieves SAS URLs for downloading edge/CDN logs
    - Comprehensive error handling for projects without Cloudflare log push enabled
    - Smart response parsing and user-friendly formatting
    - Automatic expiration date extraction from SAS URLs

## 🎯 **MCP Tool Summary**

**Complete Deployment Lifecycle:**
- `upload_deployment_package` - Upload NuGet packages
- `start_deployment` - Deploy packages OR promote between environments OR sync content
- `get_deployment_status` - Monitor deployment progress
- `complete_deployment` - Move deployments from staging to live
- `reset_deployment` - Rollback/reset deployments

**Database Operations:**
- `export_database` - Export databases as BACPAC files
- `check_export_status` - Monitor export progress
- `copy_content` - Sync databases and BLOBs between environments

**Storage Management:**
- `list_storage_containers` - List BLOB containers
- `generate_storage_sas_link` - Generate SAS access URLs

**Logging & Monitoring:**
- `get_edge_logs` - Access edge/CDN server logs for analysis and troubleshooting

## Implementation Status Legend
- ✅ **Working**: Successfully tested and implemented in Jaxon Digital MCP Server
- ⚠️ **Not needed**: Available cmdlet but covered by other implementations
- 🔄 **Not yet implemented**: Available but not yet added to MCP server
- ❌ **Issues**: Known problems or limitations

## 📋 **Implementation Notes**
- All cmdlets require `Connect-EpiCloud` to be called first
- PowerShell cmdlets are **significantly more reliable** than direct API calls
- Some operations return login pages when using direct API but work via PowerShell
- The EpiCloud module is cross-platform compatible as of v1.0.0
- **Jaxon Digital MCP Server** provides comprehensive error handling and user-friendly responses
- All tools include **"Powered by PowerShell EpiCloud module"** attribution