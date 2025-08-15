# Changelog

## v2.0.0 (2025-08-15)

### BREAKING CHANGES

- **Single Configuration Format**: Removed all backward compatibility
  - Only `OPTIMIZELY_PROJECT_<NAME>` format is now supported
  - Removed support for individual environment variables (OPTIMIZELY_PROJECT_ID, etc.)
  - Removed support for JSON array format (OPTIMIZELY_PROJECTS)
  - Simplified codebase by removing legacy configuration parsing

### Why Breaking Change?

Since we have no production users yet, this is the perfect time to simplify the codebase and provide a single, clean configuration format that's easy to understand and maintain.

### Migration Guide

**Old Format (No Longer Supported):**
```json
"OPTIMIZELY_PROJECT_ID": "xxx",
"OPTIMIZELY_API_KEY": "yyy",
"OPTIMIZELY_API_SECRET": "zzz"
```

**New Format (Required):**
```json
"OPTIMIZELY_PROJECT_PRODUCTION": "id=xxx;key=yyy;secret=zzz"
```

## v1.11.0 (2025-08-15)

### New Features

- **Simple Multi-Project Configuration**: Clean, readable environment variable format
  - New `OPTIMIZELY_PROJECT_<NAME>` pattern for defining projects
  - Project names embedded directly in variable names
  - Semicolon-separated configuration: `id=xxx;key=yyy;secret=zzz`
  - Optional parameters: `default=true`, custom environments
  - Backward compatible with existing JSON array format
  - Much easier to read and edit than escaped JSON
  - Comprehensive documentation in SIMPLE_MULTI_PROJECT.md

### Improvements

- **Better User Experience**: Configuration is now human-readable
- **Easier Maintenance**: No more JSON escaping nightmares
- **Self-Documenting**: Variable names show which projects are configured
- **Flexible Setup**: Mix and match configuration formats

### Documentation

- Added SIMPLE_MULTI_PROJECT.md with complete examples
- Updated MULTI_PROJECT_CONFIG.md to reference new format
- Added migration guide from old to new format

## v1.10.0-1.10.3

- Minor updates and dependency maintenance
- Documentation improvements

## v1.9.0 (2025-08-14)

### New Features

- **Telemetry & Analytics System**: Anonymous, opt-in telemetry for usage insights
  - Tracks tool usage patterns, performance metrics, and error rates
  - Complete privacy protection - no sensitive data collected
  - Local storage with automatic cleanup after 30 days
  - New `get_analytics` tool to view usage statistics
  - Helps improve tool performance and reliability
  - Comprehensive documentation in TELEMETRY.md

- **Rate Limiting & API Protection**: Intelligent request management
  - Per-project rate limiting (30 requests/minute, 500/hour)
  - Automatic 429 response handling with retry-after respect
  - Exponential backoff for failed requests with jitter
  - Burst protection against rapid-fire requests
  - Per-project quota tracking and state persistence
  - New `get_rate_limit_status` tool to monitor API usage
  - Integration with retry system for seamless operation

- **Intelligent Caching System**: Performance optimization for repeated operations
  - Smart caching for read operations (deployments, containers, status)
  - Operation-specific TTL (2min for deployments, 10min for containers)
  - Automatic cache invalidation for write operations
  - Per-project cache isolation and management
  - Size and entry limits with intelligent LRU eviction
  - New `get_cache_status` tool for monitoring and management
  - Cache persistence across sessions for better performance

### Improvements

- **Enhanced PowerShell Integration**: Caching and rate limiting built into core operations
- **Better Performance**: Significant speed improvements for repeated operations
- **API Protection**: Prevents abuse while maintaining high performance
- **User Experience**: Real-time feedback on rate limits and cache status
- **Enterprise Ready**: Telemetry opt-out and enterprise configuration options

### Technical Enhancements

- Added Telemetry module with EventEmitter architecture
- Added RateLimiter module with per-project quota management
- Added CacheManager module with intelligent invalidation
- Enhanced PowerShellHelper with caching and rate limiting integration
- Added three new MCP tools for system monitoring
- Integrated all systems seamlessly without breaking changes

### Documentation

- Added comprehensive TELEMETRY.md with privacy policy
- Enhanced README with new features and configuration
- Updated all tool documentation with new capabilities

## v1.8.0 (2025-08-14)

### New Features
- **Retry Logic**: Automatic retry for transient failures with exponential backoff
  - Handles network timeouts, rate limiting, and temporary service issues
  - Configurable retry attempts and delays
  - Smart detection of retryable vs non-retryable errors
  
- **Comprehensive Edge Case Handling**: Robust validation for deployment operations
  - Validates deployment paths (prevents invalid environment combinations)
  - Checks deployment state before operations
  - Detects and prevents concurrent deployments
  - Parameter validation and sanitization
  - Business hours warnings for production deployments

- **Upload Progress Tracking**: Real-time progress indicators for large files
  - Automatic progress bars for uploads >10MB
  - Shows percentage, speed, ETA, and progress bar
  - EventEmitter-based architecture for extensibility
  - Streaming PowerShell execution for real-time updates

### Improvements
- Enhanced deployment reliability with automatic retries
- Better error messages with specific troubleshooting guidance
- Smart warnings for risky operations (production deployments, Friday deployments)
- Parameter conflict detection and resolution
- Fixed GitHub URL in get_support tool
- Better user experience for large file uploads

### Technical Enhancements
- Added RetryHelper module for configurable retry logic
- Added DeploymentValidator module for comprehensive validation
- Added UploadProgress module for progress tracking
- Integrated retry logic into critical deployment operations
- PowerShell operations now support automatic retry and streaming
- Enhanced PackageTools with progress monitoring

### Testing & CI/CD
- Created comprehensive automated test suite (15 tests)
- Added GitHub Actions CI workflow for multi-platform testing
- Tests run on Ubuntu, Windows, and macOS
- Tests across Node.js versions 16, 18, 20, and 22
- Added npm test scripts for easy testing
- Security checks for hardcoded secrets
- Package structure validation

### Documentation
- Added comprehensive Windows setup guide (WINDOWS_SETUP.md)
- Covers PowerShell Core installation and configuration
- Windows-specific troubleshooting for common issues
- Firewall and Windows Defender configuration
- Performance optimization tips for Windows
- Step-by-step Claude Desktop integration

### Telemetry & Analytics
- Added optional anonymous telemetry system (opt-in only)
- Tracks tool usage, performance metrics, and error patterns
- Complete privacy protection - no sensitive data collected
- Local storage with automatic cleanup
- New `get_analytics` tool to view usage statistics
- Comprehensive documentation in TELEMETRY.md
- Helps improve tool performance and reliability

### Rate Limiting & API Protection
- Intelligent rate limiting per project (30/min, 500/hour)
- Automatic 429 response handling with retry-after respect
- Exponential backoff for failed requests
- Burst protection against rapid-fire requests
- Per-project quota tracking and state persistence
- New `get_rate_limit_status` tool to monitor usage
- Integration with retry system for seamless operation
- Prevents API abuse while maintaining performance

### Intelligent Caching System
- Smart caching for read operations (list deployments, status checks)
- Operation-specific TTL (2min for deployments, 10min for containers)
- Automatic cache invalidation for write operations
- Per-project cache isolation and management
- Size and entry limits with intelligent eviction
- New `get_cache_status` tool for monitoring and management
- Cache persistence across sessions
- Significant performance improvement for repeated operations

## v1.7.7 (2025-08-14)

### Bug Fixes
- Fixed Zod validation errors to include support email
- Now ALL error types consistently show support@jaxondigital.com

## v1.7.6 (2025-08-14)

### Bug Fixes
- **B006**: All error messages now include support@jaxondigital.com for better user support
- **B002**: Deployment errors provide specific troubleshooting guidance for invalid IDs
- **B005**: Enhanced UUID validation with warnings for non-v4 formats

### Improvements
- Clearer error messages with actionable next steps
- Better user experience with consistent support contact information
- Improved validation messages for project IDs

## v1.7.1 (2025-08-14)

### Enhancements
- Enhanced deployment status display with comprehensive details
  - Progress percentage and duration calculation
  - Full deployment configuration (apps, blob, db, maintenance page)
  - Timeline with start/end times
  - Validation links, warnings, and errors display
  - Reset parameters for rollback deployments
- Improved list view with additional info for small result sets

### Bug Fixes
- Fixed `split_package` null reference error that caused crashes
- Fixed `generate_sas_upload_url` to provide helpful guidance instead of failing
- Better error handling for missing deployment containers

### Documentation
- Updated README to use `@latest` tag for npm installation
- Ensures users always get the most recent version

## Current Version

### Features
- Built-in project list management
- Enhanced security with automatic secret masking
- Large file handling for deployment packages
- Multi-project support with seamless switching
- Smart deployment defaults (upward = code, downward = content)
- Comprehensive error handling and user feedback

### Capabilities
- 19 tools for complete DXP management
- Project switching using names or IDs
- Support for multiple configuration methods
- Automatic dependency checking on installation
- Modular architecture for maintainability

---

Built by Jaxon Digital - Optimizely Gold Partner