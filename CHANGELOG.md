# Changelog

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