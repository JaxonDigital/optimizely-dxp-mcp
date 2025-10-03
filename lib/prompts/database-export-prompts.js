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
                name: "export-database",
                description: "Export database with monitoring options",
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
            }
        ];
    }

    /**
     * Get messages for a specific prompt
     */
    static getPromptMessages(name, args = {}) {
        switch (name) {
            case "export-database":
                return this.getCompleteWorkflowMessages(args);
            default:
                throw new Error(`Unknown prompt: ${name}`);
        }
    }

    /**
     * Complete workflow messages - handles entire database export process
     */
    static getCompleteWorkflowMessages(args = {}) {
        let { environment = 'Production', database = 'epicms', retention = 168, monitor = true, autoDownload = false } = args;

        // Parse boolean values from strings (MCP sends arguments as strings)
        // "false" string is truthy, so we need to explicitly parse it
        monitor = this.parseBoolean(monitor, true); // Default to true
        autoDownload = this.parseBoolean(autoDownload, false); // Default to false

        // Validation: autoDownload requires monitoring to be enabled
        if (autoDownload && !monitor) {
            console.error('[DatabaseExportPrompts] VALIDATION ERROR: autoDownload=true requires monitor=true');
            console.error('[DatabaseExportPrompts] Forcing monitor=true to enable autoDownload');
            monitor = true; // Force monitoring on if autoDownload is requested
        }

        return this.getFullWorkflowMessages(environment, database, retention, monitor, autoDownload);
    }

    /**
     * Parse boolean values from strings or booleans
     * MCP protocol sends arguments as strings, so "false" needs to be parsed as boolean false
     */
    static parseBoolean(value, defaultValue = false) {
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
    static getFullWorkflowMessages(environment, database, retention, monitor, autoDownload) {
        // Build monitoring instructions conditionally
        const monitoringInstructions = monitor ? `
**Monitor export:**
- Automatic monitoring every 2 minutes
- IMMEDIATELY start monitoring by calling check_export_status with:
  * exportId: <export-id>
  * environment: "${environment}"
  * waitBeforeCheck: 120 (2 minutes)
  * monitor: ${monitor}
  * autoDownload: ${autoDownload}
- Repeat until complete
${autoDownload ? '- Auto-download will happen when complete' : '- When complete, file size and download URL will be shown'}` : `
**After export creation:**
- Export ID will be provided (monitoring disabled)
- User can manually check status later with check_export_status tool
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

1. **Call** export_database with:
   - previewOnly: true
   - environment: "${environment}"
   - databaseName: "${database}"
   - retentionHours: ${retention}
   - monitor: ${monitor}
   - autoDownload: ${autoDownload}
2. **Show** the preview to user
3. **Wait** for user to confirm, then call export_database (same params, WITHOUT previewOnly)
${monitoringInstructions}

That's it!`
                }
            }
        ];
    }
}

module.exports = DatabaseExportPrompts;
// OLD COMPLEX WORKFLOW REMOVED - was causing UI freezes
