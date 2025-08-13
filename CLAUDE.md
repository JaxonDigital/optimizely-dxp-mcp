# Jaxon Optimizely DXP MCP Server - Development Notes

## Project Overview
MCP (Model Context Protocol) server for Optimizely DXP operations, enabling AI assistants to manage deployments, databases, and environments through natural language.

Built by Jaxon Digital - Optimizely Gold Partner

## Architecture

### Core Components
- **Main Server**: `jaxon-optimizely-dxp-mcp.js` - Uses @modelcontextprotocol/sdk
- **PowerShell Integration**: All DXP operations use EpiCloud PowerShell module
- **Modular Tools**: Organized into separate tool modules for maintainability

### Project Structure
```
/Users/bgerby/Documents/dev/deployment-mcp/
├── jaxon-optimizely-dxp-mcp.js         # Main MCP server
├── lib/                                 # Core libraries
│   ├── config.js                        # Configuration constants
│   ├── error-handler.js                 # Error detection and formatting
│   ├── powershell-helper.js            # PowerShell execution wrapper
│   ├── powershell-command-builder.js   # Fluent interface for command building
│   ├── response-builder.js             # Response formatting
│   └── tools/                          # Tool implementations
│       ├── database-tools.js           # Database operations
│       ├── deployment/                 # Modular deployment tools
│       │   ├── deployment-list.js      # List and status operations
│       │   ├── deployment-actions.js   # Start, complete, reset
│       │   └── deployment-formatters.js # Response formatting
│       ├── storage-tools.js            # Storage and SAS operations
│       ├── package-tools.js            # Package upload/deployment
│       ├── logging-tools.js            # Edge/CDN logs
│       ├── content-tools.js            # Content synchronization
│       └── deployment-helper-tools.js  # Large file handling
└── package.json                         # NPM package configuration
```

## Available Tools

### Core Operations (18 tools)
1. **get_project_info** - Display project configuration
2. **export_database** - Export database from environment
3. **check_export_status** - Check database export status
4. **list_deployments** - List all deployments
5. **start_deployment** - Start new deployment
6. **get_deployment_status** - Get deployment status
7. **complete_deployment** - Complete deployment in verification
8. **reset_deployment** - Rollback deployment
9. **list_storage_containers** - List storage containers
10. **generate_storage_sas_link** - Generate SAS links
11. **upload_deployment_package** - Upload deployment package
12. **deploy_package_and_start** - Combined upload and deploy
13. **get_edge_logs** - Get CDN logs (requires enablement)
14. **copy_content** - Copy content between environments
15. **analyze_package** - Analyze package for upload strategy
16. **prepare_deployment_package** - Create optimized packages
17. **generate_sas_upload_url** - Get SAS URL for direct upload
18. **split_package** - Split large packages into chunks

## Key Features

### Smart Deployment Defaults
- **Upward** (Int→Pre, Pre→Prod): Deploys CODE
- **Downward** (Prod→Pre/Int): Copies CONTENT
- Override with deploymentType parameter

### Multi-Project Support
Configure multiple projects in Claude Desktop:
```json
{
  "mcpServers": {
    "project1": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "Project 1",
        "OPTIMIZELY_PROJECT_ID": "...",
        "OPTIMIZELY_API_KEY": "...",
        "OPTIMIZELY_API_SECRET": "..."
      }
    }
  }
}
```

### Large File Handling
For packages >100MB:
1. Use `analyze_package` to get recommendations
2. Use `generate_sas_upload_url` for direct upload
3. Or use `split_package` to break into chunks

## Testing

### Quick Test
```bash
node test-refactored.js
```

### Manual Testing
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | jaxon-optimizely-dxp-mcp
```

## Development Guidelines

### Code Style
- Use PowerShellCommandBuilder for all PowerShell commands
- No hardcoded version numbers in code
- Follow modular architecture patterns
- Keep formatters separate from business logic

### Error Handling
- All errors go through ErrorHandler for consistent formatting
- Detect specific DXP errors and provide helpful guidance
- Always include projectId in error context

### Response Formatting
- Use ResponseBuilder for consistent formatting
- Include visual indicators (✅, ⚠️, ❌)
- Always show preview URLs for verification state
- Provide clear next steps

## Deployment

### NPM Publishing
```bash
npm version patch/minor/major
npm publish
git push origin main --tags
```

### Global Installation
```bash
npm install -g jaxon-optimizely-dxp-mcp@latest
```

## Important Notes

### Public vs Private Repository
- **Private repo**: Contains all development files, tests, and client-specific code
- **Public repo**: Only required files, no client names or sensitive data
- Always check before pushing to public repository
- CLAUDE.md is tracked in private repo only

### PowerShell Requirements
- Requires PowerShell Core (`pwsh`) installed
- EpiCloud module must be available
- Authentication handled via API keys

### Claude Desktop Integration
- Restart Claude Desktop after config changes
- MCP servers run as separate processes
- Environment variables provide project context

## Security Measures

### Secret Protection
- **SecurityHelper module** - Provides comprehensive secret protection
  - Masks secrets in logs and error messages
  - Validates credential formats
  - Sanitizes command output
  - Detects potential secret exposure

### Security Features
1. **Automatic Secret Masking**
   - API keys and secrets are masked in all outputs
   - Error messages are sanitized before display
   - Command logs show masked credentials

2. **Credential Validation**
   - Checks for proper UUID format for project IDs
   - Validates API key/secret length and format
   - Prevents exposure of malformed credentials

3. **Git Pre-commit Hooks**
   - `scripts/check-secrets.sh` - Scans for secrets before commit
   - `.gitleaks.toml` - Configuration for secret detection
   - Blocks commits containing real credentials

### Security Best Practices
- Never hardcode credentials in code
- Always use environment variables for secrets
- Test with fake credentials in examples
- Review all error messages for secret exposure
- Use the SecurityHelper for any new error handling

### Running Security Checks
```bash
# Manual secret scan
./scripts/check-secrets.sh

# Install as git hook
ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit
```

## Common Issues

### Connection Issues
- Ensure Node.js is in PATH
- Check PowerShell Core is installed
- Verify API credentials are correct (use SecurityHelper.validateCredentials)

### Deployment Failures
- Check SourceApp parameter for code deployments
- Verify environment names are correct
- Ensure package format is valid

### Large File Uploads
- Use SAS URLs for files >100MB
- Consider splitting very large packages
- Check network stability for uploads

## Git Workflow

### Pushing to Public Repository
```bash
# Push to public repo (excludes CLAUDE.md and other dev files)
git push public main
```

### Keeping Repos in Sync
The private repo is the source of truth. Public repo gets selective pushes without development files.