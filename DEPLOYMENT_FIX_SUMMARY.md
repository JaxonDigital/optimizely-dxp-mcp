# Start Deployment Fix Summary

## Issue
The `start_deployment` tool was failing with "An unexpected error occurred" when attempting to deploy between environments (e.g., Integration → Preproduction).

## Root Cause
The PowerShell command for `Start-EpiDeployment` was missing required parameters:
1. **Missing ClientKey/ClientSecret**: Start-EpiDeployment requires explicit `-ClientKey` and `-ClientSecret` parameters, unlike some other commands that can use the authenticated session from `Connect-EpiCloud`
2. **Wrong parameter name**: Was using `-PackageLocation` instead of `-DeploymentPackage` for package deployments

## Fix Applied
Updated `/lib/tools/deployment-tools.js`:

### 1. Added ClientKey/ClientSecret to command
```javascript
// Before:
let command = `Start-EpiDeployment -ProjectId '${projectId}' -TargetEnvironment '${targetEnvironment}'`;

// After:
let command = `Start-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -TargetEnvironment '${targetEnvironment}'`;
```

### 2. Fixed package deployment parameter
```javascript
// Before:
command += ` -PackageLocation @(${packageList})`;

// After:
command += ` -DeploymentPackage @(${packageList})`;
```

### 3. Added detailed error logging
Added console.error statements to capture full PowerShell execution results for better debugging.

## Files Modified
- `/lib/tools/deployment-tools.js` - Fixed Start-EpiDeployment command construction

## Testing Required
1. Test environment-to-environment deployment (Integration → Preproduction)
2. Test package deployment
3. Verify deployment with various options (DirectDeploy, UseMaintenancePage, etc.)

## Version Update Needed
Current version: 1.2.13
Should be updated to: 1.2.14 to reflect this fix