# Changelog

All notable changes to the Jaxon Optimizely DXP MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.47.4] - 2025-11-22

### Bug Fixes

#### DXP-179: Fix analyze_logs_streaming Returning 0 Logs (7 PRs - Complete Fix Chain)
- **Files:** `lib/azure-blob-streamer.ts`, `lib/tools/log-analysis-tools.ts`, `lib/log-analysis/log-parser.ts`, `README.md`
- **User Report:** Eduardo Alvarez reported analyze_logs_streaming returned 0 logs despite blobs being found and downloaded (8.19 MB)
- **Issue Chain Resolved:**

  **PR #342 - Blob Discovery Fix:**
  - Double `??` in URL construction (`?${url.search}` created `??sv=...`)
  - Azure Blob Storage rejected malformed SAS URLs
  - **Fix:** Changed to `${url.search}` (URL.search already includes `?`)
  - **Impact:** Blobs now discoverable (0 blobs → 2 blobs found)

  **PR #343 - Documentation:**
  - Added Development section to README.md
  - Documented `npm run build` requirement after TypeScript changes
  - **Impact:** Contributors understand build workflow

  **PR #344 - Debug Visibility (buildResponse):**
  - Debug info missing from buildResponse structured content
  - Users couldn't troubleshoot why logs weren't returned
  - **Fix:** Added `...(debugInfo && { debug: debugInfo })` to structured response
  - **Impact:** Debug info now visible when `debug: true` and logs found

  **PR #345 - Debug Visibility (buildEmptyResponse):**
  - Debug info missing from buildEmptyResponse (0 logs case)
  - No visibility when 0 logs returned (exact scenario needing debug!)
  - **Fix:** Added debug parameter and conditional inclusion in structured response
  - **Impact:** Debug info now visible when `debug: true` and 0 logs found

  **PR #346 - Debug Flag Propagation (streamBlob):**
  - analyze_logs_streaming didn't pass `{ debug }` option to streamBlob()
  - Parse errors silently swallowed even with `debug: true`
  - **Fix:** Pass `{ debug }` option to streamBlob() call (line 648)
  - **Impact:** Parsing errors now logged when debug enabled

  **PR #347 - Debug Flag Propagation (parseLogEntry):**
  - parseLogEntry() caught errors but didn't accept debug parameter
  - No way to see WHY parsing failed (JSON errors, format issues)
  - **Fix:** Added `debug: boolean` parameter, added OutputLogger debug calls
  - **Impact:** Parse errors now visible with line preview when debug enabled

  **PR #348 - ROOT CAUSE FIX (Import Bug):**
  - **Critical Issue:** `parseLogEntry` was **undefined** due to incorrect CommonJS import
  - `const { parseLogEntry } = require('../log-analysis/log-parser')` returned undefined
  - log-parser.ts uses `export default { parseLogEntry, ... }` (ES6)
  - CommonJS require() returns `{ default: { parseLogEntry, ... } }`
  - Destructuring `{ parseLogEntry }` from module object found nothing
  - Every log line was silently discarded in processing loop
  - **Fix:** Changed to `const logParser = require('../log-analysis/log-parser'); const { parseLogEntry } = logParser.default || logParser;`
  - **Impact:** parseLogEntry now properly defined, logs successfully parsed

- **Before Fix:**
  ```
  ✅ Found 2 blobs (8.19 MB)
  ❌ Parsed 0 logs
  ```

- **After Fix:**
  ```
  ✅ Found 2 blobs (8.19 MB)
  ✅ Parsed logs successfully
  ```

- **Testing:** All 9 CI jobs passed on all PRs (Windows/Ubuntu/macOS × Node 18/20/22)
- **Verification:** User confirmed fix working in production

## [3.47.2] - 2025-11-14

### Bug Fixes

#### DXP-185, DXP-186: Fix Download Issues with skipConfirmation and dbPath (PR #325)
- **Files:** `lib/tools/blob-download-tools.ts`, `lib/tools/download-management-tools.ts`
- **Issue #1 - DXP-185: skipConfirmation Parameter Not Working:**
  - The `skipConfirmation` parameter was not being properly passed through to download functions
  - Downloads always prompted for confirmation regardless of parameter value
  - **Fix:** Properly thread `skipConfirmation` parameter through download pipeline
  - **Impact:** Automated workflows can now skip confirmation prompts as intended
- **Issue #2 - DXP-186: dbPath Parameter Not Working:**
  - The `dbPath` parameter was not being properly handled in download configuration
  - Database downloads failed to use custom paths specified by users
  - **Fix:** Ensure `dbPath` is properly passed to download configuration and used for file paths
  - **Impact:** Users can now specify custom database download paths successfully
- **Testing:** All 9 CI jobs passed (Windows/Ubuntu/macOS × Node 18/20/22)
- **Verification:** Client team confirmed both fixes working in production

## [3.47.1] - 2025-11-14

### Bug Fixes

#### DXP-178: Complete Fix for Container Validation and Download Management (3 PRs)
- **Files:** `lib/tools/blob-download-tools.ts`, `lib/tools/download-management-tools.ts`
- **Issue #1 - Case-Sensitivity (PR #321):**
  - Container validation was case-sensitive after PR #320 converted names to lowercase
  - User input "SourceMaps" failed validation against lowercase "sourcemaps" array
  - **Fix:** Made validation case-insensitive by converting user input to lowercase before checking
  - **Impact:** All case variations now work ("sourcemaps", "SourceMaps", "SOURCEMAPS")
- **Issue #2 - download_cancel Runtime Error (PR #322 + PR #323):**
  - Part 1: Lines 455 and 592 called non-existent `DatabaseSimpleTools.getDownloadStatus()` method
  - **Fix (PR #322):** Changed to correct `.backgroundDownloads.get(downloadId)`
  - Part 2: PR #322 fixed method calls but missed `.default` on `require()` statements
  - Since `database-simple-tools.ts` uses `export default`, CommonJS `require()` needs `.default`
  - **Fix (PR #323):** Added `.default` to all three `require()` statements (lines 160, 456, 513)
  - **Impact:** download_cancel, download_status, and download_list now work correctly with database downloads
- **Testing:** All 9 CI jobs passed (Windows/Ubuntu/macOS × Node 18/20/22)
- **Verification:** Client team confirmed both fixes working in production

## [3.47.0] - 2025-11-11

### New Features

#### DXP-124-5: Audit Log Query Tool
- **File:** `src/index.ts`, `lib/audit-logger.js`
- **Feature:** Added `query_audit_log` MCP tool for querying audit trail with filtering and pagination
- **Capabilities:**
  - Filter by time range (start_time, end_time)
  - Filter by tool name (e.g., "start_deployment")
  - Filter by status (success/failure)
  - Pagination support (limit, offset)
- **Tests:** 6 comprehensive tests added
- **Documentation:** Complete API_REFERENCE.md documentation
- **Impact:** Users can now query audit history programmatically for compliance, debugging, and reporting

#### DXP-124-3, DXP-124-4: Audit Logging Integration
- **Files:** `lib/tools/deployment-tools.ts`, `lib/tools/log-download-tools.ts`, `lib/tools/database-tools.ts`
- **Feature:** Integrated audit logging into all deployment, log, and database tools
- **Tools covered:**
  - Deployment: start_deployment, complete_deployment, reset_deployment, list_deployments
  - Logs: download_logs, analyze_logs_streaming
  - Database: db_export, db_export_status, db_export_download
- **Impact:** All critical operations now automatically logged for audit trail and compliance

#### DXP-124-6: Audit Trail Documentation
- **Files:** `README.md`, `MAINTAINER.md`
- **Feature:** Comprehensive audit trail documentation
- **Includes:**
  - What is audited and example entries
  - Storage location and JSON Lines format
  - Query capabilities (MCP tool + command line examples)
  - Retention policy recommendations
  - GDPR and compliance considerations
  - Security features and monitoring

#### DXP-56-4: MCP Prompts Developer Guide
- **File:** `API_REFERENCE.md`
- **Feature:** 213-line comprehensive guide for creating MCP Prompts
- **Topics:**
  - What are MCP Prompts and when to use them
  - Prompt structure and best practices
  - Argument passing and validation
  - Testing and debugging
  - Examples and templates
- **Impact:** Developers can now create reusable prompt workflows

### Bug Fixes

#### DXP-178: Fixed Background Download Error Detection (CRITICAL)
- **File:** `lib/tools/blob-download-tools.ts`
- **Issue:** DXP-178 fix in v3.46.2 only checked for `result.error` but missed `result.isError` from ErrorHandler.handleError() format, causing background downloads to report success when they actually failed
- **Root Cause:** Two error formats exist:
  1. `ResponseBuilder.error()`: `{ error: "message" }`
  2. `ErrorHandler.handleError()`: `{ content: [...], isError: true }`
- **Fix:** Now checks BOTH error formats with comprehensive error message extraction
- **Tests:** Added 6 regression tests in `tests/blob-download-error-handling.test.js`
- **Impact:** Background blob downloads now properly detect and fail on ALL error types, preventing false success reports

#### DXP-180: Fixed ErrorHandler2 Module Import
- **File:** `lib/tools/log-download-tools.ts`
- **Issue:** ES6 default export + CommonJS require mismatch causing "ErrorHandler2.handleError is not a function"
- **Fix:** Added `.default` to all require() imports (10 imports fixed)
- **Impact:** Error handling now works correctly after esbuild bundling

## [3.46.3] - 2025-11-07

### Bug Fixes

#### DXP-176: Fixed variable scope issue in error handler
- **File:** `lib/tools/log-download-tools.ts`
- **Issue:** Variables `monitorProgress` and `progressMonitor` were declared with `const` inside try block, making them inaccessible in catch block, causing `ReferenceError: monitorProgress is not defined` when download errors occurred
- **Fix:** Declared variables outside try block with `let`, changed declarations inside try block to assignments
- **Impact:** Error handler can now properly access variables for graceful error handling and progress monitor cleanup

## [3.46.2] - 2025-11-07

### Bug Fixes

#### DXP-177: Fixed download_list undefined entries error
- **File:** `lib/tools/download-management-tools.ts`
- **Issue:** Runtime error "Cannot read properties of undefined (reading 'entries')" when `DatabaseSimpleTools.backgroundDownloads` was undefined
- **Fix:** Added null check before accessing `.entries()`, returns empty array if undefined
- **Impact:** Fixes crash in download_list tool when no database downloads are active

#### DXP-178: Fixed download_blobs silent failure in background mode
- **File:** `lib/tools/blob-download-tools.ts`
- **Issue:** Background downloads reported "Download Complete" even when they failed with errors (silently marked failures as successful)
- **Fix:** Added error response check before calling `completeDownload()`, now properly fails downloads that return error responses
- **Impact:** Background downloads now correctly report failures instead of silently succeeding

#### DXP-179: Added daysBack parameter support for analyze_logs_streaming
- **File:** `lib/tools/log-analysis-tools.ts`
- **Issue:** Users passed `daysBack` parameter but it was ignored (only `minutesBack` was supported), causing "returns 0 logs" errors
- **Fix:** Added `daysBack` to `AnalyzeLogsArgs` interface and conversion logic (`daysBack * 24 * 60 = minutesBack`)
- **Impact:** Users can now specify time ranges in days (e.g., `daysBack: 7` for last 7 days) instead of only minutes

## [3.46.1] - 2025-11-07

### Bug Fixes

#### DXP-175: Fixed ProgressMonitor class reference error
- **File:** `lib/tools/log-download-tools.ts`
- **Issue:** Code was calling `(ProgressMonitor as any).error()` on the class constructor instead of on the progressMonitor instance
- **Fix:** Changed to `progressMonitor.error()` with proper guard condition `if (monitorProgress && progressMonitor)`
- **Impact:** Fixes runtime error during log download error handling

#### DXP-173: Fixed ESM/CommonJS interop for analyzer functions
- **File:** `lib/tools/log-analysis-tools.ts`
- **Issue:** When requiring ESM `export default` from CommonJS, functions were on `.default` property causing "analyzeErrors2 is not a function" errors
- **Fix:** Added `analyzers.default || analyzers` fallback pattern for proper interop
- **Impact:** Fixes runtime error during streaming log analysis

## [3.46.0] - 2025-11-04

### 🎉 Major Release: Documentation Refresh & Feature Consolidation

This release consolidates 6 months of improvements (v3.44-v3.46) with comprehensive documentation updates for the public repository.

### Major Features Since v3.44

#### TypeScript Migration (DXP-142)
- **Complete codebase conversion** from JavaScript to TypeScript
- **Strict mode compliance**: Fixed 479 type errors across entire codebase
- **Better IDE support**: Full IntelliSense, type checking, and auto-completion
- **Improved maintainability**: Type-safe interfaces for all tools and utilities
- **Build system**: esbuild with separate `build:bundle` and `build:lib` scripts

#### PowerShell Fully Removed (DXP-101)
- **Direct REST API**: HMAC-SHA256 authentication, no external dependencies
- **Performance**: 3-10x faster operations vs PowerShell execution
- **Cross-platform consistency**: Identical behavior on macOS, Linux, Windows
- **Zero dependencies**: No PowerShell, no Python, no external tools needed
- **Deployment operations**: 3-10x faster
- **Database exports**: 5x faster
- **Log downloads**: 3x faster

#### Streaming Log Analysis (DXP-110, DXP-114)
- **`analyze_logs_streaming` tool**: 2x faster than download+analyze approach
- **`compare_logs` tool**: Side-by-side comparison for deployment decisions
- **Memory efficient**: Streaming processing, no disk I/O required
- **Structured output**: Perfect for automation workflows
- **Simultaneous analysis**: Supports both console and HTTP logs at once

#### n8n Integration (DXP-89, DXP-90, DXP-100)
- **HTTP Streamable transport**: Native n8n MCP Client Tool support
- **Dual-mode operation**: stdio for Claude Desktop, HTTP for automation platforms
- **45 tools exposed**: All tools available to automation workflows
- **Docker support**: Containerized deployment with security hardening
- **Lenient headers**: Compatibility fix for n8n MCP Client Tool v1.114.4+

#### MCP Resources Subscription (DXP-134, DXP-139, DXP-146)
- **Real-time deployment monitoring**: Event-driven updates via MCP Resources
- **Webhook notifications**: Integration with external systems
- **Event streaming**: Live progress updates without polling
- **Test coverage**: Comprehensive unit tests for subscription lifecycle

#### Redis Integration (DXP-143, DXP-145)
- **Circuit breaker pattern**: Automatic fallback when Redis unavailable
- **Reconnection logic**: Self-healing connections with exponential backoff
- **Optional caching**: Improves performance for repeated queries
- **Test coverage**: 12 integration tests covering all scenarios

#### Mobile Workflow System (DXP-161-171)
- **Ticket folder system**: `.tickets/` for autonomous processing
- **Queue management**: `QUEUE.md` for backlog tracking
- **Autonomous execution**: Claude Code mobile can process tickets independently
- **Complete documentation**: CLAUDE.md refactored for AI agent workflow

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