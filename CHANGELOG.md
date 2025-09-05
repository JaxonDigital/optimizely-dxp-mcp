# Changelog

All notable changes to the Jaxon Optimizely DXP MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.14.3] - 2025-08-30

### Removed
- **Tool Architecture Consolidation**: Major cleanup of redundant and thin-wrapper tools
  - Removed AI-friendly tools (5 thin wrapper functions that reduced transparency)
  - Removed legacy backup aliases (`backup`, `backup_status`, `list_backups`) - use `export_database`, `check_export_status`, `list_exports` instead
  - Consolidated 6 permission checker tools into unified `PermissionChecker` class
  - Merged `database-tools.js` into `database-simple-tools.js` for cleaner architecture

### Improved
- **Unified Permission Detection**: Single, comprehensive permission checker with direct PowerShell execution
- **Streamlined Database Operations**: Consolidated database functionality with internal method implementations
- **Cleaner Architecture**: Reduced tool file count by 50%, eliminated redundant dependencies
- **Better Transparency**: Removed "thin wrapper" pattern in favor of direct, clear tool functionality

### Fixed
- **Settings Isolation**: Fixed critical bug where global settings contaminated project-based MCP usage
- **Project Context Detection**: Improved detection of MCP project context vs global CLI usage

## [3.8.0] - 2025-08-19

### Added
- **Rock-Solid Simple Commands**: Production-ready enhancements to deploy, status, rollback, and quick commands
  - Smart retry logic with exponential backoff for all operations
  - Connection validation before operations with helpful error messages
  - Dry-run mode for safe testing (`--dry-run` flag)
  - Real-time deployment progress estimation with ETA
  - Stuck deployment detection (warns when deployments run >20 minutes)
  - Enhanced error classification (retryable vs non-retryable)
- **Natural Language Database Operations**: Simple commands for database backups
  - `backup` - Create database backup (defaults to production for safety)
  - `backup_status` - Check backup status (automatically finds latest)
  - `list_backups` - Show recent backup history
  - **Auto-Download Option**: `--auto-download` flag monitors and downloads backup when complete
  - Progress tracking for downloads with real-time percentage
  - Smart environment parsing (prod→Production, staging→Preproduction)
- **Comprehensive Integration Tests**: Full test coverage for simple commands
- **Better Project Resolution**: Graceful handling of single project, multiple projects, and no default scenarios

### Improved
- **Status Command Intelligence**: Shows deployment progress percentage and estimated completion time
- **Error Recovery**: All simple commands now retry automatically on transient failures
- **JSON Parsing Safety**: Robust handling of malformed or missing deployment data
- **Environment Validation**: Prevents invalid deployments with clear error messages
- **Project Configuration**: Smart fallbacks when no default project is set

### Fixed
- Fixed potential crashes when project configuration is missing
- Fixed JSON parsing errors in status commands
- Prevented same-environment deployments which would fail
- Fixed undefined behavior when no projects are configured

## [3.7.0] - 2025-08-19

### Added
- **Dead Simple Commands**: 4 new natural language commands for 80% of daily operations
  - `deploy` - Universal deployment with smart defaults
  - `status` - Intelligent status overview with actionable suggestions  
  - `rollback` - Emergency one-click safety
  - `quick` - Ultra-fast status check
- **Smart Environment Detection**: Handles all common aliases (prod→Production, staging→Preproduction)
- **Deployment Type Intelligence**: Automatically determines code vs content based on direction
- **SIMPLE_COMMANDS.md**: Comprehensive documentation for the new simple commands

## [3.6.0] - 2025-08-18

### Added
- **Smart Executor Module**: Intelligent command execution with automatic retry, caching, and error handling
- **Deployment Monitoring Dashboard**: Comprehensive real-time deployment monitoring with analytics
  - Environment status overview
  - Active deployment tracking with progress estimation
  - Success rate analytics and deployment patterns
  - Actionable recommendations based on deployment history
- **Enhanced Error Messages**: Clear, actionable error messages with copy-paste ready fixes
- **Improved PowerShell Detection**: Better cross-platform detection with helpful installation instructions
- **Batch Operations Support**: Execute multiple commands efficiently with concurrency control
- **Real-time Progress Tracking**: Monitor long-running operations with progress updates

### Improved
- PowerShell error handling now provides platform-specific installation instructions
- Rate limiting errors include wait time and helpful guidance
- Authentication failures provide specific troubleshooting steps
- Cache system now supports intelligent invalidation for write operations
- Retry logic includes exponential backoff with jitter

### Fixed
- PowerShell detection on Windows now properly finds PowerShell 5.1+
- Error messages now properly escape and format for better readability
- Rate limit handling respects retry-after headers from API

## [3.5.0] - 2025-08-19

### Added
- **Setup Wizard Tool**: Interactive configuration guide for first-time users
  - Validates PowerShell installation
  - Checks EpiCloud module availability
  - Tests API credentials
  - Provides configuration templates and actionable recommendations

## [3.4.0] - 2025-08-19

### Added
- **Connection Testing Tools**: Better onboarding experience
  - `test_connection`: Comprehensive setup validation
  - `health_check`: Quick status check with minimal output
- **Quick Start Guide**: Streamlined onboarding in CLAUDE.md

## [3.3.0] - 2025-08-18

### Fixed
- Cross-platform PowerShell detection improvements
- Automatic detection of PowerShell 5.1+ on Windows
- Better error messages when PowerShell is not found

## [3.2.0] - 2025-08-18

### Removed
- `get_analytics` tool (not useful for end users)

### Added
- Live telemetry endpoints at accelerator.jaxondigital.com
- Telemetry analysis scripts for monitoring usage

### Improved
- Telemetry system fully operational with aggregated analytics

## [3.1.1] - 2025-08-18

### Fixed
- `get_version` tool: Fixed missing imports and method names
- Version checking now properly displays current and latest versions

## [3.1.0] - 2025-08-18

### Added
- `get_version` tool for checking MCP version and updates
- Automatic update notifications when new versions are available

## [3.0.0] - 2025-08-17 (BREAKING CHANGE)

### Breaking Changes
- **Complete configuration freedom**: Any environment variable name now works
- Removed requirement for `OPTIMIZELY_API_KEY_` or `OPTIMIZELY_PROJECT_` prefixes
- Configuration format remains the same: `id=<uuid>;key=<key>;secret=<secret>`

### Migration Guide
If you have existing configuration:
- Old: `OPTIMIZELY_API_KEY_PROJECT1`, `OPTIMIZELY_PROJECT_CLIENT2`
- New: Can use any name: `ACME`, `CONTOSO`, `PRODUCTION`, `MY_CLIENT`, etc.

## [2.0.0] - 2025-08-17

### Changed
- Major configuration overhaul for better multi-project support
- Simplified credential management
- Improved project name resolution across all tools

## [1.9.0] - 2025-08-16

### Added
- **Enterprise Features Suite**:
  - Anonymous telemetry and analytics (opt-in)
  - Intelligent rate limiting with per-project quotas
  - Smart caching system with operation-specific TTL
  - Real-time progress tracking for large operations

### Improved
- Performance optimizations for repeated operations
- Better handling of API rate limits
- Enhanced error recovery mechanisms

## [1.8.0] - 2025-08-15

### Added
- `get_rate_limit_status` tool for monitoring API usage
- `get_cache_status` tool for cache management
- Progress bars for file uploads over 10MB

### Improved
- Rate limiting now tracks per-project quotas
- Cache invalidation for related operations
- Better handling of 429 responses

## [1.7.0] - 2025-08-14

### Added
- Dynamic project registration and management
- Inline credential provision for all tools
- Project persistence across sessions

### Improved
- Multi-project workflow support
- Credential validation and error messages
- Project name resolution logic

## [1.6.0] - 2025-08-13

### Added
- Large file handling utilities
- Package analysis and splitting tools
- SAS URL generation for direct uploads

### Improved
- Upload strategy for packages over 100MB
- Better progress tracking for large operations

## [1.5.0] - 2025-08-12

### Added
- Content synchronization tools
- Storage container management
- Edge/CDN log access (beta feature)

### Improved
- Deployment status visualization
- Error message formatting
- Response consistency across tools

## [1.4.0] - 2025-08-11

### Added
- Package upload and deployment tools
- Database export status checking
- Deployment completion with verification URLs

### Improved
- Smart deployment defaults (code up, content down)
- Better handling of deployment states
- Enhanced error detection

## [1.3.0] - 2025-08-10

### Added
- Multi-project configuration support
- Project switching capabilities
- Default project selection

### Improved
- Credential management for agencies
- Project name resolution
- Configuration flexibility

## [1.2.0] - 2025-08-09

### Added
- Database export tools
- Deployment reset capabilities
- Storage SAS link generation

### Improved
- PowerShell command building
- Error handling and suggestions
- Response formatting consistency

## [1.1.0] - 2025-08-08

### Added
- Basic deployment listing
- Deployment status checking
- Environment name normalization

### Improved
- PowerShell execution wrapper
- JSON parsing from mixed output
- Security helper for credential masking

## [1.0.0] - 2025-08-07

### Initial Release
- Core MCP server implementation
- PowerShell + EpiCloud integration
- Basic deployment operations
- Multi-project support foundation
- Claude Desktop and CLI compatibility

---

For more details on each release, see the [GitHub Releases](https://github.com/JaxonDigital/optimizely-dxp-mcp/releases) page.