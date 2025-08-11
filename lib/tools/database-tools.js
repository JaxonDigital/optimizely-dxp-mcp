/**
 * Database Tools Module
 * Handles all database-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');

class DatabaseTools {
    /**
     * Export database handler
     */
    static async handleExportDatabase(requestId, args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.databaseName) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters for database export');
        }

        try {
            const result = await this.exportDatabase(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Database export error:', error);
            return ResponseBuilder.internalError(requestId, 'Database export failed', error.message);
        }
    }

    /**
     * Export database implementation
     */
    static async exportDatabase(args) {
        const { apiKey, apiSecret, projectId, environment, databaseName, retentionHours = Config.DEFAULTS.RETENTION_HOURS } = args;
        
        console.error(`Starting database export for ${databaseName} in ${environment}`);

        // Build PowerShell command
        const command = `Start-EpiDatabaseExport -ProjectId '${projectId}' -Environment '${environment}' -DatabaseName '${databaseName}' -RetentionHours ${retentionHours}`;
        
        // Execute command
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Database Export',
                projectId,
                environment,
                databaseName
            });

            if (error) {
                return ErrorHandler.formatError(error, { projectId, environment });
            }
        }

        // Parse and format successful response
        if (result.parsedData) {
            return this.formatExportResponse(result.parsedData, environment, databaseName);
        }

        // Fallback to raw output
        return ResponseBuilder.addFooter(
            `Database export initiated.\n${result.stdout}`,
            true
        );
    }

    /**
     * Format database export response
     */
    static formatExportResponse(exportData, environment, databaseName) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Database Export Started**\n\n`;
        response += `**Export ID:** \`${exportData.id}\`\n`;
        response += `**Database:** ${databaseName}\n`;
        response += `**Environment:** ${environment}\n`;
        response += `**Status:** ${exportData.status}\n`;
        
        if (exportData.downloadLink) {
            response += `**Download Link:** ${exportData.downloadLink}\n`;
        }

        const tips = [
            'Use check_export_status to monitor progress',
            'Export typically takes 5-30 minutes depending on database size',
            'Download link will be available once export completes'
        ];

        response += ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response, true);
    }

    /**
     * Check export status handler
     */
    static async handleCheckExportStatus(requestId, args) {
        // Validate parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || 
            !args.databaseName || !args.exportId) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters for export status check');
        }

        try {
            const result = await this.checkExportStatus(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Export status check error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to check export status', error.message);
        }
    }

    /**
     * Check export status implementation
     */
    static async checkExportStatus(args) {
        const { apiKey, apiSecret, projectId, environment, databaseName, exportId } = args;
        
        console.error(`Checking export status for ${exportId}`);

        // Build PowerShell command
        const command = `Get-EpiDatabaseExport -ProjectId '${projectId}' -Environment '${environment}' -DatabaseName '${databaseName}' -Id '${exportId}'`;
        
        // Execute command
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Check Export Status',
                projectId,
                exportId
            });

            if (error) {
                return ErrorHandler.formatError(error, { projectId, exportId });
            }
        }

        // Parse and format successful response
        if (result.parsedData) {
            return this.formatExportStatus(result.parsedData);
        }

        // Handle export not found
        if (result.stdout?.includes('EXPORT_NOT_FOUND')) {
            return this.formatExportNotFound(exportId);
        }

        // Fallback to raw output
        return ResponseBuilder.addFooter(
            `Export status:\n${result.stdout}`,
            true
        );
    }

    /**
     * Format export status response
     */
    static formatExportStatus(exportData) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        const status = exportData.status?.toLowerCase() || 'unknown';
        
        let statusIcon = STATUS_ICONS.IN_PROGRESS;
        let statusMessage = 'Export in progress';
        
        if (status === 'succeeded' || status === 'completed') {
            statusIcon = STATUS_ICONS.SUCCESS;
            statusMessage = 'Export completed successfully';
        } else if (status === 'failed') {
            statusIcon = STATUS_ICONS.ERROR;
            statusMessage = 'Export failed';
        }

        let response = `${statusIcon} **Database Export Status**\n\n`;
        response += `**Status:** ${statusMessage}\n`;
        response += `**Export ID:** \`${exportData.id}\`\n`;
        response += `**Database:** ${exportData.databaseName}\n`;
        response += `**Environment:** ${exportData.environment}\n`;
        
        if (exportData.downloadLink) {
            response += `\n${STATUS_ICONS.SUCCESS} **Download Ready!**\n`;
            response += `**Download URL:** \`${exportData.downloadLink}\`\n`;
            response += `\n**Note:** This link expires after the retention period.`;
        }

        return ResponseBuilder.addFooter(response, true);
    }

    /**
     * Format export not found response
     */
    static formatExportNotFound(exportId) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.WARNING} **Export Not Found**\n\n`;
        response += `The export ID \`${exportId}\` was not found.\n\n`;
        response += `**Possible reasons:**\n`;
        response += `- Export ID is incorrect\n`;
        response += `- Export has expired (retention period passed)\n`;
        response += `- Export was deleted\n`;

        return ResponseBuilder.addFooter(response, true);
    }
}

module.exports = DatabaseTools;