/**
 * Storage Tools Module
 * Handles all storage-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');
const PowerShellCommandBuilder = require('../powershell-command-builder');

class StorageTools {
    /**
     * List storage containers
     * 
     * IMPORTANT: Storage container listing has cross-environment read access.
     * An API key with only Integration permissions can still list Production containers.
     * This does NOT mean they can download blobs or generate SAS links for Production.
     */
    static async handleListStorageContainers(args) {
        // Validate required authentication parameters
        if (!args.apiKey || !args.apiSecret || !args.projectId) {
            return ResponseBuilder.invalidParams('Missing required parameters (apiKey, apiSecret, or projectId)');
        }

        // Default to Production if no environment specified
        if (!args.environment) {
            args.environment = 'Production';
        }

        try {
            const result = await this.listStorageContainers(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            // console.error('List storage containers error:', error);
            return ResponseBuilder.internalError('Failed to list storage containers', error.message);
        }
    }

    static async listStorageContainers(args) {
        // Extract authentication parameters
        const apiKey = args.apiKey;
        const apiSecret = args.apiSecret;
        const projectId = args.projectId;
        const environment = args.environment;
        
        // console.error(`Listing storage containers for ${environment}`);

        // Build command using the new builder
        const command = PowerShellCommandBuilder.create('Get-EpiStorageContainer')
            .addParam('ProjectId', projectId)
            .addParam('Environment', environment)
            .build();
        
        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: 'list_storage_containers',
                cacheArgs: { environment }
            }
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
    static async handleGenerateStorageSasLink(args) {
        // Validate required parameters for SAS link generation
        if (!args.apiKey || !args.apiSecret || !args.projectId || !args.containerName) {
            return ResponseBuilder.invalidParams('Missing required parameters (apiKey, apiSecret, projectId, or containerName)');
        }

        // Default to Production if no environment specified
        if (!args.environment) {
            args.environment = 'Production';
        }

        try {
            const result = await this.generateStorageSasLink(args);
            return ResponseBuilder.success(result);
        } catch (error) {
            // console.error('Generate SAS link error:', error);
            return ResponseBuilder.internalError('Failed to generate SAS link', error.message);
        }
    }

    static async generateStorageSasLink(args) {
        // Extract parameters from args
        const apiKey = args.apiKey;
        const apiSecret = args.apiSecret;
        const projectId = args.projectId;
        const { environment, containerName, permissions = 'Read', expiryHours = 24 } = args;
        // Convert expiryHours to validMinutes for PowerShell command
        const validMinutes = expiryHours * 60;
        
        // console.error(`Generating SAS link for container ${containerName} in ${environment}`);

        // Build command - note: PowerShell cmdlet uses different parameter names
        let command = `Get-EpiStorageContainerSasLink -ProjectId '${projectId}' -Environment '${environment}' -StorageContainer '${containerName}'`;
        
        // Convert hours to retention hours for the cmdlet
        const retentionHours = Math.ceil(validMinutes / 60);
        command += ` -RetentionHours ${retentionHours}`;
        
        // Add -Writable flag if Write permissions requested
        if (permissions === 'Write' || permissions === 'Delete') {
            command += ' -Writable';
        }
        
        // Execute
        const result = await PowerShellHelper.executeEpiCommand(
            command,
            { apiKey, apiSecret, projectId },
            { 
                parseJson: true,
                operation: 'generate_sas_link',
                cacheArgs: { environment, containerName, permissions }
            }
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