# Changelog

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

### Improvements
- Enhanced deployment reliability with automatic retries
- Better error messages with specific troubleshooting guidance
- Smart warnings for risky operations (production deployments, Friday deployments)
- Parameter conflict detection and resolution
- Fixed GitHub URL in get_support tool

### Technical Enhancements
- Added RetryHelper module for configurable retry logic
- Added DeploymentValidator module for comprehensive validation
- Integrated retry logic into critical deployment operations
- PowerShell operations now support automatic retry

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