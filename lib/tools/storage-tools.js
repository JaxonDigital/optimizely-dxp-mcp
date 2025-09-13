/**
 * Storage Tools Module
 * Handles all storage-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const { PowerShellHelper, ResponseBuilder, ErrorHandler, Config } = require('../index');
const PowerShellCommandBuilder = require('../powershell-command-builder');
const ProjectTools = require('./project-tools');
const SelfHostedStorage = require('../self-hosted-storage');

class StorageTools {
    /**
     * List storage containers
     * 
     * IMPORTANT: Storage container listing has cross-environment read access.
     * An API key with only Integration permissions can still list Production containers.
     * This does NOT mean they can download blobs or generate SAS links for Production.
     */
    static async handleListStorageContainers(args) {
        try {
            // Check if this is a self-hosted project
            if (args.connectionString || args.isSelfHosted) {
                const containers = await SelfHostedStorage.listContainers(args.connectionString);
                return ResponseBuilder.success(this.formatSelfHostedContainers(containers));
            }
            
            // Resolve project configuration if credentials not provided
            let resolvedArgs = args;
            if (!args.apiKey || !args.apiSecret || !args.projectId) {
                const resolved = ProjectTools.resolveCredentials(args);
                
                // Check if the resolved project is self-hosted
                if (resolved.project?.isSelfHosted) {
                    const containers = await SelfHostedStorage.listContainers(resolved.project.connectionString);
                    return ResponseBuilder.success(this.formatSelfHostedContainers(containers));
                }
                
                if (!resolved.success || !resolved.credentials) {
                    return ResponseBuilder.invalidParams('Missing required parameters. Either provide apiKey/apiSecret/projectId or configure a project.');
                }
                resolvedArgs = {
                    ...args,
                    apiKey: resolved.credentials.apiKey,
                    apiSecret: resolved.credentials.apiSecret,
                    projectId: resolved.credentials.projectId,
                    projectName: resolved.project?.name
                };
            }

            // Default to Production if no environment specified
            if (!resolvedArgs.environment) {
                resolvedArgs.environment = 'Production';
            }

            const result = await this.listStorageContainers(resolvedArgs);
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
            .addParam('ClientKey', apiKey)
            .addParam('ClientSecret', apiSecret)
            .addParam('Environment', environment)
            .build();
        
        // Execute using direct method to avoid Connect-EpiCloud issues
        const result = await PowerShellHelper.executeEpiCommandDirect(
            command,
            { 
                parseJson: true
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

    static formatSelfHostedContainers(containers) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.FOLDER} **Self-Hosted Azure Storage Containers**\n\n`;
        
        if (containers && containers.length > 0) {
            response += '**Available Containers:**\n\n';
            containers.forEach((container, index) => {
                // Show friendly name if available
                const displayName = container.friendlyName || container.name;
                response += `${index + 1}. **${displayName}**`;
                
                // Show description if available
                if (container.properties?.description) {
                    response += ` - ${container.properties.description}`;
                }
                response += '\n';
                
                // Show actual container name if different from display name
                if (container.friendlyName && container.friendlyName !== container.name) {
                    response += `   Container: \`${container.name}\`\n`;
                }
                
                // Show download hint if available
                if (container.downloadHint) {
                    response += `   📥 ${container.downloadHint}\n`;
                }
                
                response += '\n';
            });
            
            response += '**💡 Tip:** You can use the friendly names shown above in download commands!\n';
            response += 'For example: `download_logs "Console Logs"` or `download_logs "HTTP Logs"`\n';
        } else {
            response += 'No storage containers found.\n';
        }
        
        return response;
    }

    static formatStorageContainers(data, environment) {
        const { FORMATTING: { STATUS_ICONS } } = Config;
        
        let response = `${STATUS_ICONS.FOLDER} **Storage Containers - ${environment}**\n\n`;
        
        if (data && data.storageContainers && Array.isArray(data.storageContainers) && data.storageContainers.length > 0) {
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
        try {
            // Check if this is a self-hosted project
            if (args.isSelfHosted || args.connectionString) {
                return ResponseBuilder.invalidParams('SAS link generation is not available for self-hosted projects. Self-hosted projects already have direct access via the connection string.');
            }
            
            // Validate container name is provided
            if (!args.containerName) {
                return ResponseBuilder.invalidParams('Missing required parameter: containerName');
            }

            // Resolve project configuration if credentials not provided
            let resolvedArgs = args;
            if (!args.apiKey || !args.apiSecret || !args.projectId) {
                const resolved = ProjectTools.resolveCredentials(args);
                if (!resolved.success || !resolved.credentials) {
                    return ResponseBuilder.invalidParams('Missing required parameters. Either provide apiKey/apiSecret/projectId or configure a project.');
                }
                resolvedArgs = {
                    ...args,
                    apiKey: resolved.credentials.apiKey,
                    apiSecret: resolved.credentials.apiSecret,
                    projectId: resolved.credentials.projectId,
                    projectName: resolved.project?.name
                };
            }

            // Default to Production if no environment specified
            if (!resolvedArgs.environment) {
                resolvedArgs.environment = 'Production';
            }

            const result = await this.generateStorageSasLink(resolvedArgs);
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
        let command = `Get-EpiStorageContainerSasLink -ProjectId '${projectId}' -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -Environment '${environment}' -StorageContainer '${containerName}'`;
        
        // Convert hours to retention hours for the cmdlet
        const retentionHours = Math.ceil(validMinutes / 60);
        command += ` -RetentionHours ${retentionHours}`;
        
        // Add -Writable flag if Write permissions requested
        if (permissions === 'Write' || permissions === 'Delete') {
            command += ' -Writable';
        }
        
        // Execute using direct method to avoid Connect-EpiCloud issues
        const result = await PowerShellHelper.executeEpiCommandDirect(
            command,
            { 
                parseJson: true
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
            response += `\`\`\`\n${data.sasLink || data.url}\n\`\`\`\n\n`;
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