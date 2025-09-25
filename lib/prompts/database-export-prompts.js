/**
 * Database Export Workflow Prompts
 * MCP prompts for guided database export workflow with transparent monitoring
 */

class DatabaseExportPrompts {

    /**
     * Define all available database export prompts
     */
    static getPromptDefinitions() {
        return [
            {
                name: "database-export-workflow",
                description: "Complete database export workflow with transparent monitoring and error handling",
                arguments: [
                    {
                        name: "environment",
                        description: "Target environment (Production, Preproduction, Integration)",
                        required: false
                    },
                    {
                        name: "databaseName",
                        description: "Database name to export (defaults to epicms)",
                        required: false
                    },
                    {
                        name: "exportId",
                        description: "Existing export ID to monitor (if resuming monitoring)",
                        required: false
                    }
                ]
            }
        ];
    }

    /**
     * Get messages for a specific prompt
     */
    static getPromptMessages(name, args = {}) {
        switch (name) {
            case "database-export-workflow":
                return this.getCompleteWorkflowMessages(args);
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    /**
     * Complete workflow messages - handles entire database export process
     */
    static getCompleteWorkflowMessages(args = {}) {
        const { environment = 'Production', databaseName = 'epicms', exportId = null } = args;

        // If exportId provided, jump to monitoring phase
        if (exportId) {
            return this.getMonitoringPhaseMessages(exportId, environment);
        }

        // Otherwise, start from the beginning
        return this.getFullWorkflowMessages(environment, databaseName);
    }

    /**
     * Full workflow from start to finish
     */
    static getFullWorkflowMessages(environment, databaseName) {
        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `I need to export a database from ${environment} environment (database: ${databaseName}). Please guide me through the complete workflow with transparent monitoring.`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# COMPLETE DATABASE EXPORT WORKFLOW GUIDE

## YOUR MISSION
Execute a complete database export workflow with transparent monitoring and error handling.

## STEP-BY-STEP WORKFLOW

### PHASE 1: PREVIEW (ALWAYS FIRST)
1. **ALWAYS start with preview** - NEVER skip this step
2. Call: \`export_database({ previewOnly: true, environment: "${environment}", databaseName: "${databaseName}" })\`
3. **WAIT** for the response - it will show existing backups or export preview
4. **SHOW the response to user** - they need to see the options

### PHASE 2: USER DECISION
The system will show options like:
- "1. Use the existing local backup"
- "2. Create a fresh backup"

**WAIT for user to choose.** Do not proceed without user input.

### PHASE 3: EXPORT CREATION (if user chooses option 2)
If user chooses "2" or "create fresh":

**STEP-BY-STEP PROCESS**:
1. Call: \`export_database({ forceNew: true, environment: "${environment}", databaseName: "${databaseName}" })\`
   - Note: autoMonitor defaults to false for transparency
2. **VERIFY CREATION**:
   - Response will show export ID immediately
   - Display to user: "✅ Export created with ID: xxx"
   - User can verify in PaaS portal if needed
3. **CONFIRM SUCCESS**:
   - Look for "Export initiated successfully"
   - If error, stop and inform user
4. **MANUAL STATUS CHECKING**:
   - Tell user: "I'll check the status in a moment"
   - Use export_database tool with ONLY the exportId parameter
   - Show status to user
   - Ask user to request another check if needed

**IMPORTANT**: Since Claude can't wait properly, let user control when to check status!

### PHASE 4: MONITORING (Manual)
**Since autoMonitor defaults to false for transparency:**
- Server shows the export ID immediately after creation
- You need to manually check status periodically
- Use export_database tool with ONLY the exportId parameter for status checking

**⚠️ CRITICAL STATUS CHECK RULES:**
- **ONLY PARAMETER**: When checking status, pass ONLY exportId
- **NO OTHER PARAMS**: Do NOT include environment, databaseName, previewOnly, etc.
- **CORRECT**: export_database with exportId="xxx" only
- **WRONG**: export_database with exportId + any other parameters

**Manual checking pattern:**
1. Wait about 2 minutes after export creation
2. Run export_database with ONLY the exportId parameter
3. If status is "InProgress", wait another 2 minutes
4. Repeat until status is "Succeeded" or "Failed"

**IMPORTANT**: The \`latest: true\` parameter only works for exports created in the current session.
If you're resuming from a previous session, you need the specific export ID.

### PHASE 5: COMPLETION
When status shows "Succeeded":
1. **Show the completion message** to user
2. **Display file size** and download information
3. **Ask user** if they want to download
4. **If yes**: Use export_database tool with exportId and autoDownload: true parameters

### ERROR HANDLING

#### NO EXPORT ID RETURNED
If no ID in response:
1. **Show error**: "Export creation failed - no ID returned"
2. **Check for error messages** in the response
3. **Suggest**: "Try again or check PaaS portal manually"

#### EXPORT NOT IN PAAS PORTAL
If user says export not visible:
1. **Possible causes**:
   - Authentication failed
   - Wrong project/environment
   - PowerShell/EpiCloud issue
2. **Ask user to verify** in PaaS portal
3. **Try creating manually** in portal as fallback

#### CONCURRENT EXPORT
If "Export Already Running":
1. **Show the existing export ID**
2. **Options**: Monitor existing or wait
3. **Don't create duplicate**

#### EXPORT FAILED
If status shows "Failed":
1. **Show the specific error**
2. **Check if it's permissions/quota issue**
3. **Retry only if transient error**

#### TIMEOUT (>30 minutes)
1. **Tell user**: "Export is taking longer than usual"
2. **Offer options**: Continue waiting or start new

## CRITICAL RULES
- ✅ **ALWAYS** start with \`previewOnly: true\`
- ✅ **DEFAULT** \`autoMonitor: false\` (transparent monitoring)
- ✅ **SHOW** each status check result to user
- ✅ **USE** export_database tool with exportId: "latest" for checking recent exports
- ✅ **WAIT** for user input before proceeding
- ❌ **NEVER** call export_database to download completed export
- ❌ **NEVER** skip the preview step
- ❌ **NEVER** use automatic monitoring without user consent

**REMEMBER**: Be transparent, show every step, let user see progress!`
                }
            }
        ];
    }

    /**
     * Monitoring phase messages (for resuming)
     */
    static getMonitoringPhaseMessages(exportId, environment) {
        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Resume monitoring database export with ID: ${exportId} in ${environment} environment.`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# RESUMING DATABASE EXPORT MONITORING

## CURRENT EXPORT
- **Export ID**: ${exportId}
- **Environment**: ${environment}

## MONITORING AN EXISTING EXPORT

**IMPORTANT**: Since you're resuming monitoring of export ${exportId}, you cannot use autoMonitor.

**RECOMMENDED APPROACH**:
1. Check the status ONCE using export_database tool with ONLY exportId: ${exportId}
2. If "InProgress", tell the user:
   - "Export is still in progress. Please check back in a few minutes."
   - "You can ask me to check again by saying 'check status now'"
3. If "Succeeded": Proceed with download options
4. If "Failed": Show error and recovery options

**DO NOT attempt continuous monitoring** - Claude cannot properly wait between checks.
**INSTEAD**: Check once and let the user request additional checks as needed.

**REMEMBER**: Always be transparent with status updates!`
                }
            }
        ];
    }
}

module.exports = DatabaseExportPrompts;