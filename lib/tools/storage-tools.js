/**
 * Storage Tools Module
 * Handles all storage-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');

class StorageTools {
    /**
     * List storage containers
     */
    static async handleListStorageContainers(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.listStorageContainers(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('List storage containers error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to list storage containers', error.message);
        }
    }

    static async listStorageContainers(args) {
        const { apiKey, apiSecret, projectId, environment } = args;
        
        console.error(`Listing storage containers for ${environment}`);

        // Build command
        const command = `Get-EpiStorageContainer -ProjectId '${projectId}' -Environment '${environment}'`;
        
        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'List Storage Containers',
                projectId,
                environment
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return this.formatStorageContainers(result.parsedData, environment);
        }

        return ResponseBuilder.addFooter('No storage containers found');
    }

    static formatStorageContainers(data, environment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.FOLDER} **Storage Containers - ${environment}**\n\n`;
        
        if (data.storageContainers && data.storageContainers.length > 0) {
            response += '**Available Containers:**\n';
            data.storageContainers.forEach((container, index) => {
                response += `${index + 1}. 📦 ${container}\n`;
            });
        } else if (Array.isArray(data) && data.length > 0) {
            response += '**Available Containers:**\n';
            data.forEach((container, index) => {
                response += `${index + 1}. 📦 ${container}\n`;
            });
        } else {
            response += 'No storage containers found.\n';
        }
        
        const tips = [
            'Use generate_storage_sas_link to get access URLs',
            'Containers store BLOBs and media files',
            'Each environment has its own containers'
        ];
        
        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }

    /**
     * Generate storage SAS link
     */
    static async handleGenerateStorageSasLink(requestId, args) {
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.containerName) {
            return ResponseBuilder.invalidParams(requestId, 'Missing required parameters');
        }

        try {
            const result = await this.generateStorageSasLink(args);
            return ResponseBuilder.success(requestId, result);
        } catch (error) {
            console.error('Generate SAS link error:', error);
            return ResponseBuilder.internalError(requestId, 'Failed to generate SAS link', error.message);
        }
    }

    static async generateStorageSasLink(args) {
        const { apiKey, apiSecret, projectId, environment, containerName, permissions = 'Read', validMinutes = 60 } = args;
        
        console.error(`Generating SAS link for container ${containerName} in ${environment}`);

        // Build command
        let command = `Get-EpiStorageContainerSasLink -ProjectId '${projectId}' -Environment '${environment}' -Container '${containerName}'`;
        if (permissions) command += ` -Permissions '${permissions}'`;
        if (validMinutes) command += ` -ValidMinutes ${validMinutes}`;
        
        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { parseJson: true }
        );

        // Check for errors
        if (result.stderr) {
            const error = ErrorHandler.detectError(result.stderr, {
                operation: 'Generate SAS Link',
                projectId,
                environment,
                containerName
            });

            if (error) {
                return ErrorHandler.formatError(error);
            }
        }

        // Format response
        if (result.parsedData) {
            return this.formatSasLink(result.parsedData, containerName, environment, permissions, validMinutes);
        }

        return ResponseBuilder.addFooter('SAS link generation completed');
    }

    static formatSasLink(data, containerName, environment, permissions, validMinutes) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.SUCCESS} **Storage SAS Link Generated**\n\n`;
        response += `**Container:** ${containerName}\n`;
        response += `**Environment:** ${environment}\n`;
        response += `**Permissions:** ${permissions}\n`;
        response += `**Valid for:** ${validMinutes} minutes\n\n`;
        
        if (data.sasLink || data.url) {
            response += `${STATUS_ICONS.UNLOCK} **SAS URL:**\n`;
            response += `\`${data.sasLink || data.url}\`\n\n`;
            response += `**Note:** This link expires after ${validMinutes} minutes.\n`;
        }
        
        const tips = [
            'Use this URL to access the storage container',
            'The link includes authentication credentials',
            'Do not share this link publicly'
        ];
        
        response += '\n' + ResponseBuilder.formatTips(tips);
        return ResponseBuilder.addFooter(response);
    }
}

module.exports = StorageTools;