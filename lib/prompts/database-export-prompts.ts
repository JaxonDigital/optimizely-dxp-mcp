/**
 * Database Export Workflow Prompts
 * MCP prompts for guided database export workflow with transparent monitoring
 */

import { PromptDefinition, PromptMessage } from './autonomous-deployment-prompts';

/**
 * Database export prompt arguments
 */
export interface DatabaseExportArgs {
    environment?: string;
    database?: string;
    retention?: number;
    monitor?: boolean | string;
    autoDownload?: boolean | string;
}

class DatabaseExportPrompts {

    /**
     * Define all available database export prompts
     */
    static getPromptDefinitions(): PromptDefinition[] {
        return [
            {
                name: "export-database",
                description: "Start database export with preview and monitoring",
                arguments: [
                    {
                        name: "environment",
                        description: "Production, Preproduction, Integration",
                        required: false
                    },
                    {
                        name: "database",
                        description: "epicms or epicommerce",
                        required: false
                    },
                    {
                        name: "retention",
                        description: "Number between 1-168 hours",
                        required: false
                    },
                    {
                        name: "monitor",
                        description: "true or false",
                        required: false
                    },
                    {
                        name: "autoDownload",
                        description: "true or false",
                        required: false
                    }
                ]
            },
            {
                name: "database_export_workflow",
                description: "Guide for exporting and downloading DXP databases",
                arguments: [
                    {
                        name: "environment",
                        description: "Target environment (Integration, Preproduction, Production)",
                        required: true
                    }
                ]
            }
        ];
    }

    /**
     * Get messages for a specific prompt
     */
    static getPromptMessages(name: string, args: DatabaseExportArgs = {}): PromptMessage[] {
        switch (name) {
            case "export-database":
                return this.getCompleteWorkflowMessages(args);
            case "database_export_workflow":
                return this.getDatabaseExportWorkflowMessages(args);
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    /**
     * Complete workflow messages - handles entire database export process
     */
    static getCompleteWorkflowMessages(args: DatabaseExportArgs = {}): PromptMessage[] {
        let {
            environment = 'Production',
            database = 'epicms',
            retention = 168,
            monitor = true,
            autoDownload = false
        } = args;

        // Parse boolean values from strings (MCP sends arguments as strings)
        const monitorBool = this.parseBoolean(monitor, true); // Default to true
        const autoDownloadBool = this.parseBoolean(autoDownload, false); // Default to false

        // Validation: autoDownload requires monitoring to be enabled
        let finalMonitor = monitorBool;
        if (autoDownloadBool && !monitorBool) {
            console.error('[DatabaseExportPrompts] VALIDATION ERROR: autoDownload=true requires monitor=true');
            console.error('[DatabaseExportPrompts] Forcing monitor=true to enable autoDownload');
            finalMonitor = true; // Force monitoring on if autoDownload is requested
        }

        return this.getFullWorkflowMessages(environment, database, retention, finalMonitor, autoDownloadBool);
    }

    /**
     * Parse boolean values from strings or booleans
     * MCP protocol sends arguments as strings, so "false" needs to be parsed as boolean false
     */
    static parseBoolean(value: any, defaultValue: boolean = false): boolean {
        if (value === undefined || value === null) {
            return defaultValue;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        if (typeof value === 'string') {
            const lower = value.toLowerCase().trim();
            if (lower === 'false' || lower === '0' || lower === 'no') {
                return false;
            }
            if (lower === 'true' || lower === '1' || lower === 'yes') {
                return true;
            }
        }
        // If we can't parse it, use default
        return defaultValue;
    }

    /**
     * Full workflow from start to finish
     */
    static getFullWorkflowMessages(
        environment: string,
        database: string,
        retention: number,
        monitor: boolean,
        autoDownload: boolean
    ): PromptMessage[] {
        // Build monitoring instructions conditionally
        const monitoringInstructions = monitor ? `
**Monitor export:**
- db_export returns immediately with export ID
- Call db_export_status with waitBeforeCheck: 30 (waits 30s, then checks)
- Required parameters for db_export_status:
  * exportId: <export-id>
  * environment: "${environment}"
  * waitBeforeCheck: 30
  * monitor: ${monitor}
  * autoDownload: ${autoDownload}
- Keep calling db_export_status until complete
${autoDownload ? '- Auto-download will happen when complete' : '- When complete, file size and download URL will be shown'}` : `
**After export creation:**
- Export ID will be provided (monitoring disabled)
- User can manually check status later with db_export_status tool
- Export typically takes 5-15 minutes to complete
- DO NOT automatically check status - monitoring is disabled (monitor: false)`;

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Export database from ${environment}: ${database}, retention: ${retention} hours`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# DATABASE EXPORT

**Simple 3-step workflow:**

1. **Call** db_export with:
   - previewOnly: true
   - environment: "${environment}"
   - database: "${database}"
   - retentionHours: ${retention}
   - monitor: ${monitor}
   - autoDownload: ${autoDownload}
2. **Show** the preview to user
3. **Wait** for user to confirm, then call db_export (same params, WITHOUT previewOnly)

${monitoringInstructions}`
                }
            }
        ];
    }

    /**
     * Database export workflow guidance messages
     * Provides step-by-step guidance for exporting and downloading databases
     */
    static getDatabaseExportWorkflowMessages(args: DatabaseExportArgs = {}): PromptMessage[] {
        const environment = args.environment || 'not specified';

        return [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: `Guide me through exporting a database from the ${environment} environment`
                }
            },
            {
                role: 'assistant',
                content: {
                    type: 'text',
                    text: `# Database Export Workflow for ${environment}

I'll guide you through the complete database export and download process.

## Overview

This workflow will help you:
1. ✅ Verify environment status
2. 📋 Choose export options (simple vs detailed)
3. 🚀 Initiate the database export
4. 📊 Monitor export progress
5. 💾 Download the exported database
6. ✔️ Verify successful completion

---

## Step 1: Check Environment Status

**Before exporting, verify the environment is accessible:**

\`\`\`
Use: list_environments
Purpose: Confirm ${environment} is available and check current status
What to look for: Environment should be accessible and not in maintenance mode
\`\`\`

---

## Step 2: Choose Export Options

**Simple Export (Recommended):**
- Use when you just need a database backup
- Accepts defaults for most settings
- Faster to set up

**Detailed Export (Advanced):**
- Specify database type (epicms or epicommerce)
- Set custom retention hours (1-168)
- Control monitoring and auto-download options

**Best Practice:** Start with simple export unless you have specific requirements.

---

## Step 3: Initiate Export

**Use the db_export tool:**

**For simple export (preview first):**
\`\`\`
db_export({
  environment: "${environment}",
  previewOnly: true,
  monitor: true
})
\`\`\`

**Show the preview to user and wait for confirmation**

**Then execute (remove previewOnly):**
\`\`\`
db_export({
  environment: "${environment}",
  monitor: true
})
\`\`\`

**For detailed export with options:**
\`\`\`
db_export({
  environment: "${environment}",
  database: "epicms",        // or "epicommerce"
  retentionHours: 168,        // 1-168 hours (default: 168 = 7 days)
  monitor: true,              // Enable progress monitoring
  autoDownload: false,        // Set true to auto-download when complete
  previewOnly: true          // ALWAYS preview first
})
\`\`\`

**Important:** Always use \`previewOnly: true\` first to show the user what will happen.

---

## Step 4: Monitor Export Status

**The export takes 5-15 minutes typically.**

If you set \`monitor: true\`, the tool will automatically check progress:

\`\`\`
Use: db_export_status
Parameters:
  - exportId: (returned from db_export)
  - environment: "${environment}"
  - waitBeforeCheck: 30        // Wait 30 seconds before first check
  - monitor: true
\`\`\`

**Status progression:**
1. InProgress → Export is being created
2. Succeeded → Export is ready for download

**If monitor: false was used:**
- User can manually check later with db_export_status
- Provide the exportId for future reference

---

## Step 5: Download Database Export

**When export status shows "Succeeded":**

\`\`\`
Use: download_db_export
Parameters:
  - exportId: (from previous steps)
  - environment: "${environment}"
  - destination: (optional - specify download folder)
\`\`\`

**If autoDownload: true was set:**
- Download happens automatically when export completes
- You'll see the download progress and final location

**If autoDownload: false (default):**
- Call download_db_export manually when ready
- Allows reviewing export details before downloading

---

## Step 6: Verify Success

**Confirmation checklist:**
- ✅ Export status shows "Succeeded"
- ✅ File size is reasonable (typically 50MB-5GB depending on database)
- ✅ Download completed successfully
- ✅ File exists at reported location
- ✅ File size matches reported size

---

## Best Practices

**Before exporting:**
- ✅ Confirm you're exporting from the correct environment
- ✅ Check available disk space (exports can be several GB)
- ✅ Note the retention period (default: 7 days)

**During export:**
- ⏱️ Exports typically take 5-15 minutes
- 🔄 Don't start multiple exports of the same database simultaneously
- 📊 Monitor progress if you need real-time updates

**After download:**
- 🔒 Database exports contain sensitive data - store securely
- 📅 Exports expire after retention period (default: 7 days)
- 🗑️ Clean up old exports to save storage space

**Troubleshooting:**
- If export fails, check environment status
- If download fails, the export remains available for retry
- Contact support if exports consistently fail

---

**Ready to start?** Begin with Step 1: Check the ${environment} environment status using \`list_environments\`.`
                }
            }
        ];
    }
}

export default DatabaseExportPrompts;
// OLD COMPLEX WORKFLOW REMOVED - was causing UI freezes
