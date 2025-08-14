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

### Core Operations (19 tools)
1. **get_project_info** - Display project configuration or register new project
2. **list_projects** - List all configured and dynamically added projects
3. **export_database** - Export database from environment
4. **check_export_status** - Check database export status
5. **list_deployments** - List all deployments (supports limit: 1-100)
6. **start_deployment** - Start new deployment
7. **get_deployment_status** - Get deployment status
8. **complete_deployment** - Complete deployment in verification
9. **reset_deployment** - Rollback deployment
10. **list_storage_containers** - List storage containers
11. **generate_storage_sas_link** - Generate SAS links
12. **upload_deployment_package** - Upload deployment package
13. **deploy_package_and_start** - Combined upload and deploy
14. **get_edge_logs** - Get CDN logs (requires enablement)
15. **copy_content** - Copy content between environments
16. **analyze_package** - Analyze package for upload strategy
17. **prepare_deployment_package** - Create optimized packages
18. **generate_sas_upload_url** - Get SAS URL for direct upload
19. **split_package** - Split large packages into chunks

## Key Features

### Smart Deployment Defaults
- **Upward** (Int→Pre, Pre→Prod): Deploys CODE
- **Downward** (Prod→Pre/Int): Copies CONTENT
- Override with deploymentType parameter

### Multi-Project Support (Enhanced in v1.6.0)

#### Method 1: Using OPTIMIZELY_PROJECTS (NEW!)
Configure all projects in one place:
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECTS": "[{\"name\":\"production\",\"id\":\"abc-123\",\"apiKey\":\"key1\",\"apiSecret\":\"secret1\",\"isDefault\":true},{\"name\":\"development\",\"id\":\"def-456\",\"apiKey\":\"key2\",\"apiSecret\":\"secret2\"}]"
      }
    }
  }
}
```

#### Method 2: Individual Environment Variables
Configure a single project:
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "My Project",
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
# Test basic functionality
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0.0","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | jaxon-optimizely-dxp-mcp

# Test dynamic project registration (v1.7.0+)
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_project_info","arguments":{"projectName":"Test Site","projectId":"test-123","apiKey":"key-456","apiSecret":"secret-789"}}}' | jaxon-optimizely-dxp-mcp
```

### Comprehensive Testing
See `MCP_TEST_PLAN.md` for full test coverage including:
- Dynamic project management tests
- Inline credential provision
- Multi-project workflows
- Cross-platform compatibility
- Security validation

### Testing Priorities (v1.7.0+)
1. **Critical**: Dynamic project registration and persistence
2. **High**: Project name resolution across all tools
3. **High**: Multi-project switching without credential leakage
4. **Medium**: Edge cases (special characters, long names)
5. **Low**: Performance with many projects (10+)

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
- **NEVER push .env files to public repo** (including .env.example, .env.christie, .env.vhb, etc.)
- **NEVER push test files to public repo** (test-*.js, test-*.txt, *.zip test files)
- **NEVER push client-specific files to public repo**

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

## Testing Session Results (2025-08-14)

### Successfully Tested ✅
- Deployment rollback/reset functionality
- Enhanced deployment information display
- Database exports (epicms & epicommerce)
- Storage container operations & SAS links
- Content copy between environments (11 minutes for Cambro)
- Multi-project switching (VHB, Christie, Cambro)
- Package analysis tools
- Error handling with invalid inputs
- Support tool functionality

### Bugs Fixed ✅
- **split_package**: Fixed null reference error (v1.7.1)
- **generate_sas_upload_url**: Now provides helpful guidance instead of failing (v1.7.1)
- **Deployment formatters**: Enhanced with full details display (v1.7.1)

### Known Limitations
- Edge logs require beta access (not available for most clients)
- Package containers not exposed via storage API (use upload_deployment_package)
- split_package PowerShell script needs further refinement

## Common Issues & Fixes (v1.5.1+)

### ✅ FIXED: analyze_package PowerShellHelper.executePowerShell error
- **Issue**: Method was missing, causing TypeError
- **Fix**: Added `executePowerShell` method with UTF-16LE encoding for PowerShell scripts
- **File**: `lib/powershell-helper.js`

### ✅ FIXED: Deployment environment names showing as "Unknown"
- **Issue**: Environment names were not being read from correct properties
- **Fix**: Read from `parameters.sourceEnvironment` and `parameters.targetEnvironment`
- **File**: `lib/tools/deployment/deployment-formatters.js`

### ✅ FIXED: No response with invalid limit values
- **Issue**: Negative/zero limits caused no response
- **Fix**: Added Zod validation (min: 1, max: 100) for limit parameter
- **File**: `jaxon-optimizely-dxp-mcp.js`

### ✅ FIXED: Missing VERIFICATION status icon
- **Issue**: `undefined` appeared in deployment status display
- **Fix**: Added VERIFICATION: '👁️' to STATUS_ICONS
- **File**: `lib/config.js`

### Connection Issues
- Ensure Node.js is in PATH
- Check PowerShell Core is installed
- Verify API credentials are correct (use SecurityHelper.validateCredentials)
- PowerShell scripts use UTF-16LE base64 encoding for -EncodedCommand

### Deployment Failures
- Check SourceApp parameter for code deployments
- Verify environment names are correct
- Ensure package format is valid

### Large File Uploads
- Use SAS URLs for files >100MB
- Consider splitting very large packages
- Check network stability for uploads

## Git Workflow

### Repository Management

#### Initial Setup
Run this once to configure remotes and git hooks:
```bash
./scripts/setup-repo.sh
```

#### Daily Workflow
1. **All development work** happens in the private repository
2. **Push to private repo** regularly: `git push origin main`
3. **Sync to public repo** when ready: `./scripts/sync-public-repo.sh`

#### Repository Structure
- **Private Repo** (`origin`): Contains everything - all code, tests, client configs, development notes
- **Public Repo** (`public`): Clean subset defined in `.public-files` manifest

#### Safety Features
- **Pre-push hook**: Prevents accidental push of sensitive files to public repo
- **Pre-commit hook**: Checks for secrets before any commit
- **Sync script**: Safely copies only public files with validation

### Syncing to Public Repository

#### Automated Method (RECOMMENDED)
```bash
# This script handles everything safely
./scripts/sync-public-repo.sh
```

The script will:
1. Check for uncommitted changes
2. Copy only files listed in `.public-files`
3. Scan for sensitive files
4. Create a clean commit
5. Ask for confirmation before pushing
6. Force push to public repo (clean history)

#### Manual Method (if needed)
```bash
# Only if automated sync fails
git push public main --force
```

### Files That Should NEVER Go to Public Repo
- `CLAUDE.md` - This file (internal notes)
- `MCP_TEST_PLAN.md` - Internal testing documentation
- `.env*` - All environment files (credentials)
- `test-*` - All test files
- `*.bacpac`, `*.nupkg`, `*.zip` - Package/backup files
- `scripts/check-secrets.sh` - Security tooling
- `.gitleaks.toml` - Security configuration

### Adding New Files
1. Develop and test in private repo
2. If file should be public, add to `.public-files` manifest
3. Run sync script to update public repo

### Emergency Fixes
If sensitive files accidentally get pushed to public:
```bash
# Immediately force push clean version
./scripts/sync-public-repo.sh

# Or manually create clean commit
git checkout --orphan clean-branch
# Copy only public files
git add [public files only]
git commit -m "Clean release"
git push public clean-branch:main --force
```

## Environment Configuration

### Local Development with .env Files
The MCP server now supports loading credentials from `.env` files in the current directory:

```bash
# Create project-specific .env files
cp .env.christie .env  # For Christie project
cp .env.vhb .env       # For VHB project
```

### Claude Code CLI Configuration
```bash
# Add global MCP (uses npm package)
claude mcp add jaxon-optimizely-dxp-mcp "jaxon-optimizely-dxp-mcp"

# Add local development MCP (uses local files)
claude mcp add optimizely-dev "node /Users/bgerby/Documents/dev/deployment-mcp/jaxon-optimizely-dxp-mcp.js"

# List configured MCPs
claude mcp list

# Use MCP in Claude Code
claude "Use jaxon-optimizely-dxp-mcp to check deployment status"
```

### .env File Format
```env
OPTIMIZELY_PROJECT_NAME=YourProjectName
OPTIMIZELY_PROJECT_ID=your-project-uuid-here
OPTIMIZELY_API_KEY=your-api-key-here
OPTIMIZELY_API_SECRET=your-api-secret-here
```

**Note**: `.env` files are gitignored for security

## Latest Updates (v1.7.5 - Released 2025-08-14)

### Support & Help Features (v1.7.4-1.7.5)
- **get_support Tool**: Easy access to all support options
- **Error Enhancement**: All errors now include support@jaxondigital.com
- **Documentation**: Comprehensive support section in README
- **Enterprise Support**: Information about priority support plans

### Version Update Notifications (v1.7.3)
- **Automatic Check**: Checks npm for updates on startup
- **Visual Notification**: Beautiful boxed notification when updates available
- **Non-Intrusive**: 3-second timeout, fails gracefully
- **Clear Instructions**: Shows exact update command

### Enhanced Deployment Information (v1.7.1-1.7.2)
- **Full Details**: Progress, duration, timeline, configuration
- **Error/Warning Display**: Shows deployment errors and warnings
- **Rollback Information**: Reset parameters for rollback deployments
- **Rich List View**: More info when viewing fewer deployments

### Dynamic Project Management (v1.7.0)
- **Inline Credentials**: Provide project details directly in commands
- **Auto-Registration**: Projects automatically saved when credentials provided
- **Name-Based Access**: Reference projects by friendly names after first use
- **No Configuration Required**: Start using immediately without setup
- **Project Persistence**: Projects remain available during session

### Usage Examples
```
# First use with full credentials
"Deploy for project 'Production Site' with ID abc-123, key xxx, secret yyy"

# Subsequent uses - just the name
"List deployments for Production Site"
"Deploy on Production Site"
```

### Multi-Project Management (v1.6.0 features)
- Added `list_projects` tool to show all configured projects
- Enhanced `get_project_info` to support specific project queries
- Support for `OPTIMIZELY_PROJECTS` JSON array configuration
- Automatic project switching using project names
- Smart credential resolution across projects

## Previous Updates (v1.5.1 - Released 2025-08-13)

### Critical Bug Fixes
- Fixed `analyze_package` PowerShellHelper.executePowerShell error
- Fixed deployment environment names showing as "Unknown"
- Fixed no response with invalid limit values
- Added missing VERIFICATION status icon

### Testing Results
- Comprehensive test suite created (`test-global-v1.5.1.js`)
- All critical fixes verified in production (npm v1.5.1)
- Test plan documented in `MCP_TEST_PLAN.md`

## Previous Updates (v1.5.0)

### Security Enhancements
- Comprehensive SecurityHelper module for API secret protection
- Automatic masking of secrets in all outputs
- Git pre-commit hooks to prevent accidental secret commits
- Sanitization of error messages and command outputs

### Code Refactoring
- Modular architecture with separated concerns
- PowerShellCommandBuilder for safe command construction
- Split deployment tools into logical components
- Removed hardcoded version references

### MCP Platform Notes
- MCP only works with Claude Desktop and Claude Code CLI
- Does NOT work with Claude web interface (browser)
- Requires local Node.js installation
- Claude Desktop workspace issues may require support intervention

## Version History
- **v1.7.5** - Support email updated to support@jaxondigital.com
- **v1.7.4** - Added comprehensive support features and get_support tool
- **v1.7.3** - Automatic update notifications on startup
- **v1.7.1-1.7.2** - Enhanced deployment information display
- **v1.7.0** - Dynamic project management with inline credentials
- **v1.6.0** - Built-in project list management, multi-project support
- **v1.5.1** - Critical bug fixes for deployment and package analysis
- **v1.5.0** - Security enhancements, modular refactoring, .env support
- **v1.4.1** - PowerShell command builder, deployment fixes
- **v1.3.0** - Initial security measures
- **v1.2.26** - SDK migration for Claude compatibility

## Important Development Guidelines

### Versioning Strategy (Semver)
**IMPORTANT: Follow semantic versioning strictly from v1.7.0 onwards**

- **PATCH (1.7.x)**: Bug fixes, documentation updates, dependency updates
  - Examples: Fix typo, update README, fix error handling
  - Command: `npm version patch`
  
- **MINOR (1.x.0)**: New features, non-breaking changes
  - Examples: Add new tool, enhance existing features, add new options
  - Command: `npm version minor`
  
- **MAJOR (x.0.0)**: Breaking changes
  - Examples: Remove tools, change API signatures, require new dependencies
  - Command: `npm version major`

**Current Status**: v1.7.0 - Stable release, no known users yet

### Repository Management
- **ALWAYS commit changes to both repos when necessary**
- Private repo is the source of truth
- Use `./scripts/sync-public-repo.sh` to sync to public
- Never manually push sensitive files to public repo
- Always publish to npm every time we update the public repo and vice versa

### Release Process
1. Make changes in private repo
2. Test thoroughly
3. Update version: `npm version [patch|minor|major]`
4. Commit and push to private repo
5. Run `./scripts/sync-public-repo.sh` (answer 'y' to push)
6. Publish to npm: `npm publish`