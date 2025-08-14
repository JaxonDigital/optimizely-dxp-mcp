# Changelog

## [1.5.1] - 2025-08-13

### Fixed
- **CRITICAL**: Fixed `analyze_package` PowerShellHelper.executePowerShell error - added missing method with UTF-16LE encoding for proper PowerShell script execution
- **HIGH**: Fixed deployment environment names showing as "Unknown" - now correctly reads from `parameters.sourceEnvironment` and `parameters.targetEnvironment`
- **HIGH**: Fixed no response with invalid limit values - added proper Zod validation for limit parameter (min: 1, max: 100)
- Added missing VERIFICATION status icon for deployments awaiting verification

### Added
- Comprehensive test suite for validating all critical fixes
- Limit parameter to `list_deployments` with proper validation

### Technical Details
- PowerShell scripts now use base64 UTF-16LE encoding to avoid escaping issues
- Deployment formatters now check parameters object for environment names
- Added Zod schema validation for limit and offset parameters

## [1.5.0] - 2025-08-13

### Added
- Security enhancements with comprehensive SecurityHelper module
- Modular architecture with separated deployment tools
- PowerShellCommandBuilder for safe command construction
- .env file support for local development

### Changed
- Refactored deployment tools into logical components
- Removed hardcoded version references

## Previous Versions
See git history for earlier releases