# Jaxon Digital - Optimizely DXP MCP Server

## Project Context
We are Jaxon Digital, an Optimizely Gold Partner, building a **PowerShell-only** MCP server for Optimizely DXP deployment operations. This project represents our commitment to giving back to the Optimizely community and showcasing our expertise in AI-powered development tools.

## Architecture Decision: PowerShell-Only Implementation
**IMPORTANT**: We have completely converted from API calls to PowerShell-only approach because:
- ✅ PowerShell cmdlets are much more reliable than direct API calls
- ✅ Direct API calls often return login pages despite correct HMAC authentication
- ✅ PowerShell provides better error handling and structured responses
- ✅ Official Optimizely support through EpiCloud module

## Installation Requirements for Clients
1. **PowerShell Core** (pwsh) - Cross-platform PowerShell 7+
2. **EpiCloud PowerShell Module** - `Install-Module EpiCloud -Force`

## Currently Working PowerShell Methods
✅ **Database Export**: `Start-EpiDatabaseExport` - Working with comprehensive error handling
✅ **Export Status**: `Get-EpiDatabaseExport` - Working with JSON parsing
✅ **Storage Containers**: `Get-EpiStorageContainer` - Working with smart JSON extraction
✅ **Content Copy**: `Start-EpiDeployment -IncludeBlob -IncludeDb` - Working (tested, detects ongoing deployments correctly)
✅ **Connection Test**: `Connect-EpiCloud` - Working with authentication verification

## Key Implementation Details
- **Error Handling**: All methods use try-catch with specific error message detection
- **Authentication**: `Connect-EpiCloud -ClientKey -ClientSecret -ProjectId` called for each operation
- **JSON Parsing**: Smart parsing handles mixed PowerShell output (table headers + JSON)
- **Variable Escaping**: Use `\\$variable` in PowerShell scripts within Node.js template literals
- **Concurrent Operations**: System correctly prevents multiple operations (expected behavior)

## Content Copy Success Pattern
When no deployments are running, content copy returns deployment object:
```json
{
  "id": "deployment-guid",
  "status": "InProgress", 
  "environment": "target-env"
}
```

## Next Priority Cmdlets to Implement
1. `Get-EpiStorageContainerSasLink` - Generate SAS links
2. `Add-EpiDeploymentPackage` - Upload deployment packages  
3. `Get-EpiDeployment` - Monitor deployment status
4. `Complete-EpiDeployment` - Complete deployments
5. `Reset-EpiDeployment` - Reset/rollback deployments

## Optimizely DXP Deployment API Documentation

### Core Functionalities
- **Deployment Management**: Start, complete, and reset deployments to individual environments
- **Content Synchronization**: Sync databases and BLOBs between environments (Production → Preproduction/Integration)
- **Database Export**: Export databases as BACPAC files with configurable retention
- **Storage Container Management**: List BLOB containers and generate SAS links

### Authentication (HMAC-SHA256)
- **Method**: Client key/secret pair with HMAC signature
- **Header Format**: `epi-hmac <api-key>:<timestamp>:<nonce>:<hmac>`
- **Signature Components**: API Key + HTTP Method + Request Target + Timestamp + Nonce + MD5 Body Hash
- **Algorithm**: SHA256 hash using API secret, base64 encoded

### API Base URLs
- Primary: `https://paasportal.episerver.net/api/v1.0`
- Alternative: `https://paasapi.episerver.net/api/v1.0`

### Key API Limitations
- Cannot include BLOB and DB packages in code deployments
- Cannot deploy code from Integration → Production
- API returns only top 10 most recent deployments
- Cannot handle single database type sync (syncs both CMS and Commerce)

### Environment Support
- Integration, Preproduction, Production
- ADE1-ADE6 (additional development environments)

### PowerShell Integration
- Official EpiCloud module available
- Wraps REST API functionality
- Required for some operations due to API permissions

### CI/CD Integration
- Azure DevOps supported
- Octopus Deploy integration available
- ARM template compatibility

### Deployment Process Steps
1. Package code from source environment
2. Create a deployment slot
3. Deploy code to the slot
4. Apply configuration transforms
5. Configure warmup
6. Start the slot
7. Validate the site
8. Go Live/Reset

### Security Notes
- Never use credentials, tokens, or endpoints from Preproduction in Production
- API secret is never transmitted across the internet
- Credentials can be associated with multiple environments