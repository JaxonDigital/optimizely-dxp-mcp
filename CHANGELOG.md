# Changelog

All notable changes to the Jaxon Optimizely DXP MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **DXP-77: Tool Description Cleanup**: Optimized all 45 tool descriptions for token efficiency
  - Removed AI instructions from descriptions (moved to system prompts/documentation)
  - Removed verbose "returns structured data: ..." listings (kept concise param hints)
  - Removed debug markers (HIJACKED, TESTING, etc.)
  - Standardized format: [emoji] [verb] [object] ([key params])
  - **Bundle size reduction**: 153.4kb → 150.6kb (2.8kb saved)
  - **Token savings**: ~390 tokens per conversation (average 35 chars saved per tool × 45 tools)
  - Examples:
    - Before: `'download_logs': '📊 Download logs (AI: PROACTIVELY call get_ai_guidance BEFORE using this tool - returns structured data: environment, logType, container, downloadPath, counts, size)'`
    - After: `'download_logs': '📊 Download logs from environment (dateFilter, logType)'`

### Added
- **Complete structuredContent Support (DXP-66 Extension)**: Added native MCP structuredContent to ALL automation tools
  - **New Tools with structuredContent** (15 additional tools):
    - `export_database` - Export ID, environment, database name, status, download URL, monitoring
    - `check_export_status` - Export status, progress, download URL, auto-download flag
    - `check_download_status` - Download ID, type, status, progress, speed, ETA, file path
    - `download_database_export` - Download ID, file path, size, status, type
    - `download_logs` - Environment, log type, container, download path, counts, size, sparse logging flag
    - `download_blobs` - Container, environment, download path, counts, size, files list
    - `get_download_status` - Download ID, type, status, progress, metadata (supports both log and database downloads)
    - `list_active_downloads` - Total downloads, database downloads array, log downloads array with progress
    - `list_projects` - Total projects, project array with type, credentials, paths, last used
    - `get_version` - Current version, update availability, latest version, system info
    - `list_storage_containers` - Environment, container count, container names array
    - `generate_storage_sas_link` - Container, environment, permissions, expiry, SAS URL
    - `copy_content` - Deployment ID, source/target environments, type, status, includes flags
    - `health_check` - Status, checks object (PowerShell, EpiCloud, credentials, connection), environment access
  - **Already Supported** (from v3.35.0 - 7 tools):
    - test_connection, list_deployments, start_deployment, monitor_deployment, complete_deployment, get_deployment_status, reset_deployment
  - **Coverage**: 22 tools now support automation workflows (n8n, Zapier, Make, etc.)
  - **Benefits**:
    - **Direct property access**: `response.structuredContent.data.exportId` - no JSON.parse() needed
    - **Consistent format** across all major operations (database, logs, blobs, deployments, downloads)
    - **Dual audience**: Human-readable message for AI assistants PLUS structured data for automation
    - **Download management**: Full coverage for background downloads with progress tracking
    - **Project management**: Complete project configuration and version info
    - **Health monitoring**: System status and connection checks with detailed breakdown
  - **Implementation Pattern**:
    - Tool formatters return `{data, message}` format
    - Handlers use `ResponseBuilder.successWithStructuredData(data, message)` when structured format detected
    - src/index.js automatically adds structuredContent field to MCP response
    - Maintains backward compatibility with string-only responses

- **Deployment Progress Logging**: Added -ShowProgress switch to all Start-EpiDeployment calls
  - Enables detailed progress logging during deployment (::PROGRESS::, Information messages)
  - Progress output goes to PowerShell verbose/information streams
  - Applied to both code deployments (deployment-actions.js) and content deployments (content-tools.js)

### Improved
- **Deployment Error/Warning Display**: Enhanced deployment status to show errors and warnings
  - deploymentErrors and deploymentWarnings arrays now displayed in formatted output
  - Already implemented in formatSingleDeployment (deployment-formatters.js:379-393)
  - Helps users see issues without needing to check DXP Portal

- **Cleaner structuredContent Format (DXP-66 Follow-up)**: Removed duplicate message field
  - **Issue**: Message was being returned twice - in `content[0].text` AND in `structuredContent.message`
  - **Solution**: Removed `message` from `structuredContent` object to reduce duplication
  - **Impact**: Cleaner response format, smaller payload size
  - **Breaking Change**: None - automation tools should only access `structuredContent.data` fields
  - **New Format**:
    ```javascript
    {
      content: [{ text: "Human message for AI" }],
      structuredContent: {
        success: true,
        data: { deploymentId: "...", status: "..." }
        // No message field - it's already in content[0].text
      }
    }
    ```

### Fixed
- **Structured Response Format (DXP-66 Complete Fix)**: All critical tools now use native MCP structuredContent field
  - **Issue**: v3.34.1 only had structuredContent logic in src/index.js, but ResponseBuilder was still JSON.stringify-ing
  - **Root Cause**: ResponseBuilder.successWithStructuredData() was wrapping data in old nested format
  - **Solution**: Updated ResponseBuilder to return flat `{data, message}` format that src/index.js expects
  - **Impact**: ALL 6 critical workflow tools now properly expose structuredContent field
    - test_connection (connection status, environment access, capabilities)
    - list_deployments (deployment list with metadata)
    - start_deployment (deployment ID, status, preview URL)
    - monitor_deployment (deployment progress, ETA)
    - complete_deployment (completion status, verification)
    - get_deployment_status (current status, progress percentage)
  - **Benefits**:
    - Automation tools (n8n, Zapier) can access data directly: `response.structuredContent.data.deploymentId`
    - NO JSON.parse() needed - data is already structured
    - AI assistants still get human-readable message in `content[0].text`
    - One response serves both audiences natively
  - **Implementation**:
    - src/index.js:1758-1798 - response formatting with structuredContent support
    - lib/response-builder.js:31-38 - updated successWithStructuredData() to return flat format
    - lib/tools/deployment/deployment-formatters.js:66-232 - formatDeploymentList returns {data, message}
    - lib/tools/deployment/deployment-list.js:15-39 - handleListDeployments uses successWithStructuredData
    - lib/tools/connection-test-tools.js:21-195 - testConnection returns {data, message}
  - **MCP Protocol**: Leverages official structuredContent field from @modelcontextprotocol/sdk

- **PowerShell Error Detection (DXP-72)**: Fixed success:true being returned for actual failures
  - Root cause: PowerShell execution caught errors and enhanced error messages, but success check happened after enhancement
  - Enhanced error messages (with ❌ emoji) didn't contain keywords 'error' or 'Exception', so were marked as success
  - Added hasError flag to track if exception was caught in try/catch block
  - Success now requires: no exception caught AND no stderr with error indicators (error/Exception/❌)
  - Fixed in executeEpiCommand (powershell-helper.js:236) and executeEpiCommandDirect (powershell-helper.js:323)
  - Prevents false positives like "EpiCloud module not installed" being reported as success
  - Ensures tools return success:false when operations actually fail

- **Complete/Reset Deployment Monitoring (DXP-71)**: Fixed premature "complete" messages for transitional states
  - complete_deployment now recognizes "Completing" status as transitional, not final
  - reset_deployment now recognizes "Resetting" status as transitional, not final
  - Both operations now provide transparent monitoring instructions when in transitional states
  - AI receives clear instructions to monitor until deployment reaches final state (Succeeded/Reset/Failed)
  - Prevents contradictory messages like "deployment complete" when status shows "Completing"
  - Updated formatDeploymentCompleted, formatDeploymentReset, generateMonitoringInstructions, and handleMonitorDeployment
  - Completion/reset typically takes 2-15 minutes (shown in monitoring instructions)

- **Deployment Timing Expectations**: Updated AI guidance for more realistic deployment durations
  - Changed full deployment estimate from "5-15 minutes" to "30-90 minutes depending on complexity"
  - Changed completion phase from "30-120 seconds" to "2-15 minutes"
  - Added explicit instruction to be patient and not raise concerns unless stuck for several hours
  - Prevents AI from getting worried too quickly during normal long-running deployments
  - Updated in monitor_deployment tool, generateMonitoringInstructions, formatDeploymentCompleted, and config tips

- **UUID Display Truncation**: Fixed deployment/export IDs appearing cut off at first dash
  - Changed substring(0, 8) to substring(0, 13) for better visual clarity
  - Before: "c88fa98f..." (looks cut off at dash)
  - After: "c88fa98f-9d3c..." (clearly intentional truncation)
  - Affects deployment dashboard, export monitoring, and list monitors tools

- **Deployment Monitoring (DXP-70)**: Fixed deployment monitoring not following through on promises
  - Claude Desktop was offering to monitor deployments but never actually polling for updates
  - Implemented transparent monitoring pattern similar to database export monitoring
  - Added waitBeforeCheck and monitor parameters to get_deployment_status tool
  - get_deployment_status now supports wait-then-check pattern with clear AI instructions
  - monitor_deployment now returns actionable monitoring instructions instead of empty promises
  - AI now receives explicit instructions on what tool to call next and with what parameters
  - User sees each status check happen transparently (no hidden background polling)
  - Monitoring stops automatically when deployment reaches terminal state

- **Database Export Monitoring (DXP-64)**: Fixed monitor=false parameter being ignored
  - MCP prompt arguments are passed as strings, causing "false" string to be truthy
  - Added parseBoolean() helper to properly convert string values to booleans
  - monitor="false" now correctly disables automatic monitoring
  - Affects export-database prompt in Claude Desktop and other MCP clients

- **Download Status Tracking (DXP-65)**: Fixed "download not found" error for database exports
  - Root cause: Two separate download tracking systems (logs vs database exports)
  - get_download_status now checks both downloadManager and DatabaseSimpleTools
  - list_active_downloads now shows both log downloads and database exports
  - download_history now includes both download types
  - Race condition eliminated - database export downloads immediately visible

- **Export Time Reporting**: Now shows actual export duration instead of total time since user request
  - parseExportStatus now extracts startTime and completedAt from API response
  - Completed exports show actual export time (e.g., "7m (actual export time)")
  - In-progress exports show time since export started, not since user request
  - More accurate timing when monitoring is disabled and user waits to check status

### Improved
- **User-Facing Text**: Removed "Azure" references - now shows "Optimizely DXP" consistently
  - Retention message now says "how long export remains available" instead of "how long Azure keeps export available"

## [3.44.0] - 2025-10-10

### Fixed
- **n8n MCP Client Compatibility (DXP-100)**: Added lenient Accept header mode for n8n MCP Client Tool v1.114.4+
  - **Issue**: n8n's MCP Client Tool doesn't send required `Accept: application/json, text/event-stream` headers per MCP spec
  - **Impact**: n8n workflows couldn't connect to DXP MCP HTTP server (HTTP 406 errors)
  - **Solution**: Patched MCP SDK to add optional `strictHeaders` parameter
    - Defaults to `true` (spec-compliant) for backward compatibility
    - When `false`, skips Accept header validation in HTTP POST requests
    - Enables n8n workflows while maintaining spec compliance for standard clients
  - **Implementation**:
    - Created automatic SDK patcher (`scripts/patch-mcp-sdk.js`)
    - Patches both ESM and CJS versions of `@modelcontextprotocol/sdk` after npm install
    - DXP MCP HTTP server uses `strictHeaders: false` in transport options
    - Idempotent patching system (safe to run multiple times)
  - **Files Changed**:
    - `src/index.js` - Enable lenient headers for n8n compatibility
    - `scripts/patch-mcp-sdk.js` - Automatic SDK patcher
    - `package.json` - Added postinstall script to apply patches
    - `N8N_INTEGRATION.md` - Updated troubleshooting section
  - **Testing**: Build successful, HTTP server initializes with patched SDK
  - **Related**: n8n issue #18938, blocks AI orchestration workflows (AA-2)

## [3.28.0] - 2025-09-25

### Added
- **Enhanced Database Export Workflow (DXP-53)**: Interactive prompts for better user experience
  - New transparent monitoring mode that shows real-time export progress
  - Smart detection of concurrent export operations
  - Improved error handling with graceful fallbacks
  - Added `latest` parameter to check_export_status for most recent export
  - Clear guidance between automatic vs transparent monitoring options

### Fixed
- **Database Export Monitoring (DXP-53)**: Removed broken queryPaaSExports implementation
  - Eliminated indefinite hanging when checking export status
  - Replaced with working listPaaSDBExports API call
  - Fixed option numbering confusion in user prompts

### Improved
- **Export Status Checking**: Better progress indicators and user feedback
  - Shows download link immediately when export completes
  - Clearer messaging about concurrent exports
  - Improved error detection and reporting

## [3.27.0] - 2025-09-21

### Fixed
- **Non-Blocking Telemetry (DXP-41)**: Ensures telemetry never blocks MCP operations
  - All telemetry tracking methods now use `setImmediate()` for asynchronous execution
  - Complete error isolation prevents telemetry failures from affecting MCP operations
  - Performance: 1000 telemetry calls complete in under 2ms
  - Added comprehensive test suite verifying non-blocking behavior
  - Meets spec TW-21 requirement that telemetry should never impact tool execution

## [3.26.0] - 2025-09-20

### Added
- **Enhanced Health Monitoring (DXP-40)**: Comprehensive health checks and monitoring patterns
  - Created new `TelemetryHealth` module with endpoint and system monitoring
  - Endpoint health checks every 5 minutes with response time tracking
  - System health monitoring every minute (memory, buffer usage)
  - Event-driven health alerts with configurable thresholds
  - Health state persistence across MCP server restarts
  - 11 comprehensive test cases covering all health monitoring functionality

### Added
- **Health Event System**: Event-driven architecture for health monitoring
  - Health event handlers for endpoint failures, slow responses, high memory/buffer usage
  - Configurable thresholds for performance warnings
  - Integration with existing telemetry error tracking
  - Real-time health status and summary reporting

### Improved
- **Telemetry Integration**: Seamless integration of health monitoring with existing telemetry
  - Health monitoring automatically starts/stops with telemetry initialization
  - Health events tracked as telemetry errors and performance metrics
  - Health status accessible via telemetry API methods
  - Updated telemetry documentation with DXP-40 implementation details

## [3.25.11] - 2025-09-20

### Fixed
- **Telemetry Re-enabled**: Removed temporary disable flags that were blocking all telemetry
  - Tool invocations are now properly tracked and sent to analytics endpoints
  - Telemetry follows opt-out model as designed (enabled by default)
  - Users can still disable via OPTIMIZELY_MCP_TELEMETRY=false environment variable

## [3.25.10] - 2025-09-20

### Added
- **Telemetry Buffering and Retry Logic (DXP-39)**: Implemented robust buffering and retry mechanism for telemetry events
  - Created new `TelemetryBuffer` module with exponential backoff and jitter
  - Events now persist to disk in `buffer.json` for recovery across restarts
  - Maximum 1000 events buffered to prevent unlimited growth
  - Automatic retry every 30 seconds with exponential backoff (1s base, 60s max)
  - Added 25% jitter to prevent thundering herd problems
  - Maximum 3 retry attempts per event before dropping

### Added
- **Circuit Breaker Pattern (DXP-39)**: Implemented circuit breaker to prevent cascading failures
  - Opens after 5 consecutive telemetry failures
  - Automatically resets after 5 minutes
  - Events dropped while circuit is open to prevent resource exhaustion
  - Debug logging for circuit breaker state changes

### Added
- **Comprehensive Buffer Tests**: New test suite `tests/test-telemetry-buffer.js`
  - Tests buffering, persistence, and retry logic
  - Validates exponential backoff calculations with jitter
  - Tests circuit breaker functionality
  - Verifies retry tracking and statistics
  - 11 comprehensive test cases covering all buffer functionality

### Improved
- **Telemetry Documentation**: Updated `TELEMETRY_EVENT_FORMAT.md` with DXP-39 implementation details
  - Documented retry configuration parameters
  - Added circuit breaker specifications
  - Updated error handling section with implementation status

## [3.25.9] - 2025-09-20

### Added
- **Telemetry Event Format Documentation (DXP-38)**: Comprehensive technical specification for telemetry events
  - Created detailed `TELEMETRY_EVENT_FORMAT.md` with complete event structure documentation
  - Documented all event types: session_start, tool_invocation, tool_error, session_end
  - Specified required fields, validation rules, and data types for each event
  - Added examples with proper JSON structure for all event types
  - Documented AI client detection methods and geographic location collection
  - Included session ID generation algorithm and privacy considerations
  - Referenced recent telemetry improvements (DXP-34, DXP-35, DXP-37)

### Fixed
- **Session End Event Compliance (DXP-38)**: Added missing platform field to session_end events
  - Ensures all events have consistent required field structure
  - Maintains compliance with documented telemetry specification

### Added
- **Telemetry Format Validation Test**: New test file `tests/test-telemetry-format-compliance.js`
  - Validates actual events against documented specification
  - Tests all event types for required fields and proper structure
  - Ensures flat field structure compliance (no nested objects)
  - Verifies field types and format validation

## [3.25.8] - 2025-09-20

### Improved
- **Project Switching Error Handling (DXP-36)**: Significantly enhanced error handling when switching to non-existent projects
  - Added fuzzy matching with intelligent suggestions for typos and abbreviations
  - Implemented comprehensive try-catch blocks for configuration errors
  - Enhanced error messages with detailed troubleshooting steps
  - Added graceful handling of corrupted project configurations
  - Improved "no projects configured" and "no active project" error messages
  - Better distinction between configuration errors and missing projects
  - Added context-aware help based on available projects

### Added
- **Smart Project Name Suggestions**: Fuzzy matching algorithm suggests similar project names for typos
- **Edit Distance Calculation**: Levenshtein distance algorithm for intelligent name matching
- **Project Switch Test Suite**: New test file `tests/test-project-switch-errors.js` validates error handling

## [3.25.7] - 2025-09-20

### Fixed
- **Telemetry Data Structure (DXP-37)**: Fixed malformed ai_client and location field structures
  - Converted all nested ai_client objects to flat fields (ai_client, ai_client_version)
  - Converted nested location objects to flat fields (location_region, location_timezone, location_country)
  - Ensures consistent data structure across all event types (session_start, session_end, tool_invocation)
  - Fixes analytics dashboard 500 errors caused by inconsistent nested vs flat structures
  - All telemetry events now use standardized flat field format

### Added
- **Telemetry Structure Test Suite**: New test file `tests/test-telemetry-structure.js` validates flat field format

## [3.25.6] - 2025-09-20

### Fixed
- **Session ID Stabilization (DXP-35)**: Implemented deterministic session ID generation for accurate user counting
  - Session IDs now persist across MCP server restarts using machine-specific stable identifiers
  - Uses hardware UUID on macOS, machine-id on Linux, and registry GUID on Windows
  - Daily rotation maintains privacy while providing consistent tracking within a day
  - Significantly reduces inflated user counts caused by frequent MCP restarts
  - All session data remains fully anonymous through SHA-256 hashing

### Added
- **Session Stability Test Suite**: New test file `tests/test-session-stability.js` validates ID persistence

## [3.25.5] - 2025-09-20

### Fixed
- **Critical Telemetry Fix (DXP-34)**: Fixed complete telemetry outage introduced in v3.25.4
  - Changed overly strict validation that blocked ALL telemetry when tool name was missing
  - Now uses 'unknown_tool' as fallback instead of blocking telemetry entirely
  - Session events (session_start, session_end) no longer require tool_name field
  - Added comprehensive debug logging for analytics dashboard 500 errors
  - Ensures all events have required fields: type, timestamp, session_id, platform
  - Created comprehensive telemetry test suite for validation

### Added
- **Enhanced Telemetry Debugging**: Better error logging with response bodies for failed analytics calls
- **Event Validation**: Automatic addition of missing required fields with sensible defaults
- **Test Coverage**: New telemetry test suite (tests/test-telemetry.js)

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