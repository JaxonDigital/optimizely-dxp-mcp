# Jaxon Optimizely DXP MCP - Comprehensive Test Plan

## Test Environment Setup

### Prerequisites
- [ ] Verify installed MCP version: `npm list -g jaxon-optimizely-dxp-mcp` (Current: v1.7.0)
- [ ] Verify PowerShell Core installed: `pwsh --version`
- [ ] Verify EpiCloud module available: `pwsh -c "Get-Module -ListAvailable EpiCloud"`
- [ ] Verify Node.js version: `node --version` (should be v18+)
- [ ] Check Claude Desktop is using global package (not local dev)

### Test Credentials
- [ ] Prepare test project with valid API credentials
- [ ] Prepare invalid credentials for error testing
- [ ] Document project ID format (UUID)

## 1. Core Information Tools

### 1.1 get_project_info
- [ ] **Basic Tests**:
  - [ ] Run without parameters (should show no projects or env-configured)
  - [ ] Run with inline credentials (projectName, projectId, apiKey, apiSecret)
  - [ ] Run with only projectName (after registration)
  - [ ] Run with projectId only
- [ ] **Dynamic Registration Tests**:
  - [ ] Provide all 4 inline credentials - should auto-register
  - [ ] Update existing project with new credentials
  - [ ] Verify project persists in memory
- [ ] **Edge Cases**:
  - [ ] Missing environment variables
  - [ ] Invalid project ID format
  - [ ] Empty project name
  - [ ] Special characters in project name
  - [ ] Duplicate project names
  - [ ] Very long project names

### 1.2 list_projects (NEW in v1.7.0)
- [ ] **Basic Tests**:
  - [ ] List with no projects configured
  - [ ] List with environment-configured project
  - [ ] List after adding projects dynamically
  - [ ] List shows correct project count
- [ ] **Dynamic Project Tests**:
  - [ ] Projects added via inline credentials appear
  - [ ] Project names shown with friendly labels
  - [ ] Last used timestamps update correctly
  - [ ] Default project marked with star
- [ ] **Edge Cases**:
  - [ ] Many projects (10+)
  - [ ] Projects with same name but different IDs

## 2. Dynamic Project Management (NEW in v1.7.0)

### 2.1 Inline Credential Provision
- [ ] **All Tools Support**:
  - [ ] export_database with inline credentials
  - [ ] start_deployment with inline credentials
  - [ ] list_deployments with inline credentials
  - [ ] upload_deployment_package with inline credentials
  - [ ] generate_storage_sas_link with inline credentials
- [ ] **Project Persistence**:
  - [ ] First use with full credentials registers project
  - [ ] Second use with just projectName works
  - [ ] Projects persist across multiple tool calls
  - [ ] Projects remain in memory during session
- [ ] **Project Switching**:
  - [ ] Switch between projects using names
  - [ ] Correct credentials used for each project
  - [ ] No credential leakage between projects

### 2.2 Multi-Project Workflows
- [ ] **Scenario: Managing Multiple Environments**:
  1. Add "Production" project with inline credentials
  2. Add "Staging" project with inline credentials
  3. Add "Development" project with inline credentials
  4. List all projects - should show 3
  5. Deploy from Dev to Staging using project names
  6. Deploy from Staging to Prod using project names
- [ ] **Scenario: Project Updates**:
  1. Add project with initial credentials
  2. Update same project with new API key
  3. Verify new credentials are used
  4. Old credentials should be replaced

## 3. Database Operations

### 3.1 export_database
- [ ] **Basic Tests**:
  - [ ] Export epicms from Integration
  - [ ] Export epicms from Preproduction
  - [ ] Export epicms from Production
  - [ ] Export epicommerce from Integration
  - [ ] Export epicommerce from Preproduction
  - [ ] Export epicommerce from Production
- [ ] **Edge Cases**:
  - [ ] Invalid environment name
  - [ ] Invalid database name
  - [ ] Missing permissions
  - [ ] Simultaneous exports
  - [ ] Export when another is in progress

### 2.2 check_export_status
- [ ] **Basic Tests**:
  - [ ] Check valid export ID
  - [ ] Check completed export
  - [ ] Check in-progress export
- [ ] **Edge Cases**:
  - [ ] Invalid export ID format
  - [ ] Non-existent export ID
  - [ ] Expired export ID
  - [ ] Empty export ID

## 3. Deployment Operations

### 3.1 list_deployments
- [ ] **Basic Test**: List all deployments
- [ ] **Pagination Tests**:
  - [ ] Default limit (20)
  - [ ] Custom limit (5, 50, 100)
  - [ ] With offset
- [ ] **Edge Cases**:
  - [ ] No deployments exist
  - [ ] Invalid limit values (negative, zero, too large)
  - [ ] Invalid offset values

### 3.2 start_deployment
- [ ] **Code Deployments (Upward)**:
  - [ ] Integration → Preproduction (should default to Code)
  - [ ] Preproduction → Production (should default to Code)
  - [ ] With explicit deploymentType: "Code"
  - [ ] With sourceApps specified
- [ ] **Content Deployments (Downward)**:
  - [ ] Production → Preproduction (should default to Content)
  - [ ] Production → Integration (should default to Content)
  - [ ] Preproduction → Integration (should default to Content)
- [ ] **Database Deployments**:
  - [ ] With includeBlobs: true
  - [ ] With includeBlobs: false
  - [ ] Database only (no content/code)
- [ ] **Edge Cases**:
  - [ ] Same source and target environment
  - [ ] Invalid environment names
  - [ ] Missing required SourceApp for code deployment
  - [ ] Invalid sourceApps values
  - [ ] Deployment already in progress
  - [ ] Direct deploy with maintenance enabled

### 3.3 get_deployment_status
- [ ] **Basic Tests**:
  - [ ] Check in-progress deployment
  - [ ] Check completed deployment
  - [ ] Check failed deployment
  - [ ] Check deployment in verification
- [ ] **Edge Cases**:
  - [ ] Invalid deployment ID
  - [ ] Non-existent deployment ID
  - [ ] Empty deployment ID

### 3.4 complete_deployment
- [ ] **Basic Test**: Complete deployment in verification state
- [ ] **Edge Cases**:
  - [ ] Deployment not in verification state
  - [ ] Already completed deployment
  - [ ] Failed deployment
  - [ ] Invalid deployment ID

### 3.5 reset_deployment
- [ ] **Basic Tests**:
  - [ ] Reset deployment in verification
  - [ ] Reset failed deployment
- [ ] **Edge Cases**:
  - [ ] Reset completed deployment
  - [ ] Reset in-progress deployment
  - [ ] Invalid deployment ID

## 4. Storage Operations

### 4.1 list_storage_containers
- [ ] **Basic Tests**:
  - [ ] List containers for Integration
  - [ ] List containers for Preproduction
  - [ ] List containers for Production
- [ ] **Edge Cases**:
  - [ ] Invalid environment name
  - [ ] No containers exist

### 4.2 generate_storage_sas_link
- [ ] **Basic Tests**:
  - [ ] Generate Read permission link
  - [ ] Generate Write permission link
  - [ ] Generate Delete permission link
  - [ ] Generate List permission link
- [ ] **Expiry Tests**:
  - [ ] Default expiry (24 hours)
  - [ ] Custom expiry (1, 12, 48, 72 hours)
- [ ] **Edge Cases**:
  - [ ] Invalid container name
  - [ ] Invalid permissions
  - [ ] Negative expiry hours
  - [ ] Zero expiry hours
  - [ ] Expiry > 168 hours

## 5. Package Operations

### 5.1 upload_deployment_package
- [ ] **Basic Tests**:
  - [ ] Upload small package (<10MB)
  - [ ] Upload medium package (10-100MB)
  - [ ] Upload large package (>100MB, should trigger helper)
- [ ] **File Format Tests**:
  - [ ] .nupkg file
  - [ ] .zip file
  - [ ] Invalid file format
- [ ] **Edge Cases**:
  - [ ] Non-existent file path
  - [ ] Empty file
  - [ ] Corrupted package
  - [ ] File without read permissions
  - [ ] Path with spaces
  - [ ] Relative path (should fail)

### 5.2 deploy_package_and_start
- [ ] **Basic Tests**:
  - [ ] Direct deploy (directDeploy: true)
  - [ ] Non-direct deploy (directDeploy: false)
  - [ ] Integration → Preproduction
  - [ ] Preproduction → Production
- [ ] **Edge Cases**:
  - [ ] Invalid package format
  - [ ] Package too large
  - [ ] Deployment already in progress

### 5.3 analyze_package
- [ ] **Basic Tests**:
  - [ ] Small package analysis
  - [ ] Large package analysis
  - [ ] Check recommendation logic
- [ ] **Edge Cases**:
  - [ ] Non-existent file
  - [ ] Non-package file

### 5.4 prepare_deployment_package
- [ ] **Basic Tests**:
  - [ ] Create standard package
  - [ ] Create optimized package
- [ ] **Edge Cases**:
  - [ ] Invalid source directory
  - [ ] Empty directory
  - [ ] No deployable content

### 5.5 generate_sas_upload_url
- [ ] **Basic Tests**:
  - [ ] Generate for Integration
  - [ ] Generate for Preproduction
  - [ ] Generate for Production
- [ ] **Edge Cases**:
  - [ ] Invalid environment

### 5.6 split_package
- [ ] **Basic Tests**:
  - [ ] Split large package
  - [ ] Verify chunk sizes
  - [ ] Verify chunk count
- [ ] **Edge Cases**:
  - [ ] Package smaller than chunk size
  - [ ] Invalid chunk size
  - [ ] Non-existent package

## 6. Logging Operations

### 6.1 get_edge_logs
- [ ] **Basic Tests**:
  - [ ] Get logs for last hour (default)
  - [ ] Get logs for custom hours (2, 6, 12, 24)
- [ ] **Environment Tests**:
  - [ ] Integration logs
  - [ ] Preproduction logs
  - [ ] Production logs
- [ ] **Edge Cases**:
  - [ ] Logs not enabled for project
  - [ ] Invalid hours value (negative, zero, >168)
  - [ ] Invalid environment

## 7. Content Operations

### 7.1 copy_content
- [ ] **Basic Tests**:
  - [ ] Copy Production → Preproduction
  - [ ] Copy Production → Integration
  - [ ] Copy Preproduction → Integration
- [ ] **Edge Cases**:
  - [ ] Copy to higher environment (should work but unusual)
  - [ ] Same source and target
  - [ ] Content operation already in progress
  - [ ] Invalid environments

## 8. Error Handling & Recovery

### 8.1 Authentication Errors
- [ ] Invalid API key
- [ ] Invalid API secret
- [ ] Expired credentials
- [ ] Missing credentials
- [ ] Malformed credentials

### 8.2 Network Errors
- [ ] Network timeout
- [ ] Connection refused
- [ ] DNS resolution failure
- [ ] Proxy issues

### 8.3 PowerShell Errors
- [ ] PowerShell not installed
- [ ] EpiCloud module missing
- [ ] PowerShell command timeout
- [ ] PowerShell syntax errors

### 8.4 API Response Errors
- [ ] 400 Bad Request
- [ ] 401 Unauthorized
- [ ] 403 Forbidden
- [ ] 404 Not Found
- [ ] 429 Rate Limited
- [ ] 500 Internal Server Error
- [ ] 503 Service Unavailable

## 9. Cross-Platform Considerations

### 9.1 Windows vs macOS
- [ ] **Path Handling**:
  - [ ] Windows path separators (backslash)
  - [ ] macOS/Linux path separators (forward slash)
  - [ ] UNC paths on Windows
  - [ ] Path length limitations

- [ ] **PowerShell Differences**:
  - [ ] PowerShell Core vs Windows PowerShell
  - [ ] Command availability
  - [ ] Module loading differences

- [ ] **File System**:
  - [ ] Case sensitivity (macOS can be case-insensitive)
  - [ ] File permissions
  - [ ] Symbolic links
  - [ ] Hidden files

- [ ] **Environment Variables**:
  - [ ] Variable expansion differences
  - [ ] Path separator (: vs ;)
  - [ ] System vs User variables on Windows

### 9.2 Claude Desktop Integration
- [ ] **Different Clients**:
  - [ ] Claude Desktop (macOS)
  - [ ] Claude Desktop (Windows)
  - [ ] Claude Code CLI
  - [ ] Different Claude Desktop versions

- [ ] **Configuration Locations**:
  - [ ] macOS: ~/Library/Application Support/Claude/
  - [ ] Windows: %APPDATA%\Claude\
  - [ ] Linux: ~/.config/claude/

## 10. Performance Testing

### 10.1 Response Times
- [ ] Tool initialization time
- [ ] Average response time per tool
- [ ] Timeout handling

### 10.2 Concurrent Operations
- [ ] Multiple tools called simultaneously
- [ ] Rate limiting behavior
- [ ] Queue management

### 10.3 Large Data Handling
- [ ] Large log outputs
- [ ] Many deployments in list
- [ ] Large package uploads
- [ ] Long-running operations

## 11. Security Testing

### 11.1 Credential Protection
- [ ] Secrets masked in outputs
- [ ] Secrets masked in error messages
- [ ] No secrets in logs
- [ ] No secrets in command history

### 11.2 Input Validation
- [ ] SQL injection attempts
- [ ] Command injection attempts
- [ ] Path traversal attempts
- [ ] Special characters in inputs

### 11.3 File Operations
- [ ] Access outside allowed directories
- [ ] Overwriting system files
- [ ] Creating files in protected locations

## 12. Integration Testing

### 12.1 End-to-End Workflows
- [ ] **Complete Code Deployment**:
  1. Upload package
  2. Start deployment
  3. Check status
  4. Complete verification
  
- [ ] **Database Export and Import**:
  1. Export database
  2. Check export status
  3. Download export
  4. Import to another environment

- [ ] **Content Synchronization**:
  1. Copy content
  2. Verify completion
  3. Check target environment

### 12.2 Rollback Scenarios
- [ ] Deploy and rollback
- [ ] Failed deployment recovery
- [ ] Interrupted operations

## 13. Documentation & Help

### 13.1 Error Messages
- [ ] Clear error descriptions
- [ ] Helpful suggestions
- [ ] No exposed secrets
- [ ] Proper formatting

### 13.2 Tool Descriptions
- [ ] Accurate parameter descriptions
- [ ] Clear examples
- [ ] Default values documented

## 14. Regression Testing

### 14.1 Version Compatibility
- [ ] Test with different Node.js versions
- [ ] Test with different npm versions
- [ ] Test with different PowerShell versions

### 14.2 Backward Compatibility
- [ ] Old API responses
- [ ] Deprecated parameters
- [ ] Legacy workflows

## Test Execution Notes

### Environment Setup
```bash
# Test with globally installed version
npm list -g jaxon-optimizely-dxp-mcp

# Ensure not using local development
which jaxon-optimizely-dxp-mcp

# Test initialization
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1.0.0"}}' | jaxon-optimizely-dxp-mcp
```

### Platform-Specific Testing
```bash
# On Windows (PowerShell)
$env:OPTIMIZELY_PROJECT_NAME = "TestProject"
# ... set other env vars
jaxon-optimizely-dxp-mcp

# On Windows (Command Prompt)
set OPTIMIZELY_PROJECT_NAME=TestProject
# ... set other env vars
jaxon-optimizely-dxp-mcp

# On macOS/Linux
export OPTIMIZELY_PROJECT_NAME="TestProject"
# ... set other env vars
jaxon-optimizely-dxp-mcp
```

### Test Results Tracking
- **✅ Passed**: Feature works as expected
- **❌ Failed**: Feature does not work
- **⚠️ Partial**: Works with issues
- **⏭️ Skipped**: Cannot test in current environment
- **🔄 In Progress**: Currently testing

## Known Limitations

1. **Platform-Specific**:
   - MCP only works with Claude Desktop and Claude Code CLI
   - Does not work with web interface
   - Requires local Node.js installation

2. **PowerShell Requirements**:
   - Must have PowerShell Core installed
   - EpiCloud module must be available
   - Windows may have execution policy restrictions

3. **File Size Limits**:
   - Packages >100MB require special handling
   - Very large files may timeout
   - Network stability affects large uploads

## Test Report Summary

| Category | Total Tests | Passed | Failed | Skipped | Notes |
|----------|------------|--------|--------|---------|-------|
| Core Info | 5 | 3 | 2 | 0 | Project validation issues |
| Database | 2 | 0 | 0 | 2 | Not tested (would impact env) |
| Deployment | 10 | 7 | 3 | 0 | Environment names showing as Unknown |
| Storage | 4 | 4 | 0 | 0 | All working correctly |
| Package | 6 | 2 | 3 | 1 | analyze_package broken |
| Logging | 5 | 0 | 5 | 0 | Credential loading issues in test |
| Content | 1 | 0 | 0 | 1 | Not tested (would modify env) |
| Error Handling | 10 | 8 | 2 | 0 | Some edge cases not handled |
| Cross-Platform | 0 | 0 | 0 | 10 | Only tested on macOS |
| Performance | 0 | 0 | 0 | 3 | Not tested |
| Security | 6 | 4 | 2 | 0 | Path traversal concerns |
| Integration | 0 | 0 | 0 | 3 | Not tested |

**Test Date**: 2025-08-14
**Tester**: Automated Testing & Manual Verification
**MCP Version**: 1.7.0 (latest release)
**Node Version**: v22.16.0
**PowerShell Version**: 7.2.1
**Operating System**: macOS Darwin 23.6.0
**Claude Desktop Version**: Not tested directly

## Notes & Observations

_Add any notable findings, issues, or suggestions here during testing._

## Issues & Improvements Tracker

### 🐛 Bugs Found

| ID | Tool | Description | Severity | Status | Notes |
|----|------|-------------|----------|---------|-------|
| B001 | list_deployments | Environment names showing as "Unknown" instead of actual names | 🟠 High | ✅ Fixed v1.5.1 | Deployment info missing environment details |
| B002 | get_deployment_status | Generic error for invalid deployment ID instead of specific message | 🟡 Medium | ⏳ Pending | Should say "Deployment not found" |
| B003 | analyze_package | PowerShellHelper.executePowerShell is not a function error | 🔴 Critical | ✅ Fixed v1.5.1 | Breaking functionality in v1.5.0 |
| B004 | list_deployments | No response with negative/zero limit values | 🟠 High | ✅ Fixed v1.5.1 | Should validate limit > 0 |
| B005 | Project validation | Accepts invalid UUID format for project ID | 🟡 Medium | ⏳ Pending | Shows warning but continues |

**Severity Levels**: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

### 🔧 Technical Improvements

| ID | Area | Description | Priority | Status | Notes |
|----|------|-------------|----------|---------|-------|
| T001 | Validation | Project ID should validate UUID format | 📌 Medium | 📝 Planned | Currently accepts any string |
| T002 | Error Messages | Improve error specificity for not found resources | ⚡ High | 📝 Planned | Generic errors don't help users |
| T003 | Input Validation | Add limit parameter validation (>0, <max) | ⚡ High | 📝 Planned | Prevents hangs with invalid limits |
| T004 | Security | Validate file paths to prevent traversal | 🔥 Urgent | 📝 Planned | Security vulnerability |

**Priority Levels**: 🔥 Urgent | ⚡ High | 📌 Medium | 💭 Low

### 💡 Feature Ideas

| ID | Feature | Description | Value | Effort | Status |
|----|---------|-------------|-------|--------|---------|
| F001 | Batch Operations | Add batch deployment status checks | 💎 High | 🏕️ Small | 💭 Idea |
| F002 | Retry Logic | Auto-retry on transient failures | 💰 Medium | ⛰️ Medium | 💭 Idea |
| F003 | Progress Tracking | Real-time progress for long operations | 💎 High | 🏔️ Large | 💭 Idea |
| F004 | Dynamic Projects | Auto-register projects from inline credentials | 💎 High | ⛰️ Medium | ✅ Done v1.7.0 |
| F005 | Project Names | Reference projects by friendly names | 💎 High | 🏕️ Small | ✅ Done v1.7.0 |
| F006 | No Config Required | Work without pre-configuration | 💎 High | ⛰️ Medium | ✅ Done v1.7.0 |

**Value**: 💎 High | 💰 Medium | 🪙 Low
**Effort**: 🏔️ Large | ⛰️ Medium | 🏕️ Small

### 📚 Documentation Needs

| ID | Type | Description | Priority | Status |
|----|------|-------------|----------|---------|
| D001 | | | | 📝 Todo |
| D002 | | | | |

### 🎯 Action Items

- [ ] **Immediate Actions** (Fix before release):
  - [ ] 
  
- [ ] **Short-term** (Next version):
  - [ ] 
  
- [ ] **Long-term** (Future versions):
  - [ ] 

### 🔄 Testing Observations

#### Platform-Specific Issues
- **Windows**:
  - Not tested yet
  
- **macOS**:
  - ✅ Works with PowerShell Core 7.2.1
  - ✅ EpiCloud module loads correctly
  - ⚠️ analyze_package broken in v1.5.0
  
- **Linux**:
  - 

#### Claude Client Differences
- **Claude Desktop**:
  - 
  
- **Claude Code CLI**:
  - 

#### Performance Observations
- 

#### Security Concerns
- ⚠️ Path traversal attempts not fully blocked
- ✅ SQL injection in deployment ID handled (no response)
- ✅ Invalid enum values properly validated
- ⚠️ Empty/special characters in project name accepted

### 📈 Metrics & Statistics

| Metric | Value | Target | Notes |
|--------|-------|--------|-------|
| Average response time | | <2s | |
| Memory usage | | <100MB | |
| Error rate | | <1% | |
| Success rate | | >99% | |

### 🚀 Release Checklist

Before releasing based on test results:
- [ ] All critical bugs resolved
- [ ] Security issues addressed
- [ ] Documentation updated
- [ ] Performance acceptable
- [ ] Cross-platform tested
- [ ] Error messages helpful
- [ ] Secrets properly masked
- [ ] Version number updated
- [ ] Changelog updated
- [ ] README current

### 📝 Test Session Log

| Date | Tester | Version | Key Findings | Actions Taken |
|------|--------|---------|--------------|---------------|
| | | | | |

### 🎨 UX/DX Improvements

Things that would make the MCP better to use:
1. Better error messages with specific deployment/export not found messages
2. Show actual environment names instead of "Unknown" in deployments
3. Add progress indicators for long-running operations
4. Validate inputs before making API calls to fail fast
5. Add --dry-run option for dangerous operations
6. Better handling of rate limiting with automatic backoff 

### 🔗 Integration Opportunities

Potential integrations or extensions:
1. GitHub Actions integration for CI/CD pipelines
2. Slack notifications for deployment status changes
3. Terraform provider for infrastructure as code
4. VS Code extension for direct IDE integration
5. Web dashboard for visual monitoring 

### 📊 Test Coverage Gaps

Areas not adequately tested:
1. Windows platform compatibility
2. Large file uploads (>100MB)
3. Concurrent operations and race conditions
4. Rate limiting behavior
5. Network failure recovery
6. Very long-running operations (>10 minutes)
7. Multi-project switching
8. Direct Claude Desktop integration 

### 💬 User Feedback

Feedback received during testing:
1. 
2. 
3. 

## Summary & Next Steps

**Overall Test Result**: ⚠️ Partially Passed with Critical Issues

**Key Achievements**:
- Global installation works correctly
- Core functionality operational
- Good error handling for invalid parameters
- Security validation for enums working

**Major Issues**:
1. 🔴 **CRITICAL**: analyze_package broken - PowerShellHelper.executePowerShell not a function
2. 🟠 **HIGH**: Deployment environment names showing as "Unknown"
3. 🟠 **HIGH**: No response with invalid limit values (negative/zero)
4. 🟡 **MEDIUM**: Path traversal attempts not fully validated
5. 🟡 **MEDIUM**: Project ID accepts non-UUID formats

**Recommended Actions**:
1. Fix analyze_package PowerShellHelper issue immediately
2. Investigate deployment environment name mapping
3. Add input validation for numeric parameters
4. Strengthen path validation for security
5. Add UUID format validation for project IDs 

**Sign-off**:
- [ ] Development Team
- [ ] QA Team
- [ ] Product Owner
- [ ] Release Manager

---
*Last Updated: [Date]*
*Version Tested: [Version]*
*Test Environment: [Environment]*