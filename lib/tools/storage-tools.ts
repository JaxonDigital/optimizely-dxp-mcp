/**
 * Storage Tools Module
 * Handles all storage-related operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import ResponseBuilder from '../response-builder';
// import ErrorHandler - unused
import Config from '../config';
import DXPRestClient from '../dxp-rest-client';
import ProjectTools from './project-tools';
import SelfHostedStorage from '../self-hosted-storage';

/**
 * Storage container (self-hosted)
 */
interface SelfHostedContainer {
    name: string;
    friendlyName?: string;
    downloadHint?: string;
    properties?: {
        description?: string;
    };
}

/**
 * Storage containers result
 */
interface StorageContainersData {
    environment: string;
    containerCount: number;
    containers: string[];
}

/**
 * Storage containers result with data and message
 */
interface StorageContainersResult {
    data: StorageContainersData;
    message: string;
}

/**
 * SAS link data
 */
interface SasLinkData {
    containerName: string;
    environment: string;
    permissions: string;
    validMinutes: number;
    expiresAt: string;
    sasUrl: string | null;
}

/**
 * SAS link result with data and message
 */
interface SasLinkResult {
    data: SasLinkData;
    message: string;
}

/**
 * Storage operation arguments
 */
interface StorageArgs {
    apiKey?: string;
    apiSecret?: string;
    projectId?: string;
    projectName?: string;
    environment?: string;
    containerName?: string;
    permissions?: string;
    expiryHours?: number;
    connectionString?: string;
    isSelfHosted?: boolean;
    apiUrl?: string;
}

/**
 * API response for storage containers
 */
interface StorageContainersResponse {
    storageContainers?: string[];
}

/**
 * API response for SAS link
 */
interface SasLinkResponse {
    sasLink?: string;
    url?: string;
}

class StorageTools {
    /**
     * List storage containers
     *
     * IMPORTANT: Storage container listing has cross-environment read access.
     * An API key with only Integration permissions can still list Production containers.
     * This does NOT mean they can download blobs or generate SAS links for Production.
     */
    static async handleListStorageContainers(args: StorageArgs): Promise<any> {
        try {
            // Check if this is a self-hosted project
            if (args.connectionString || args.isSelfHosted) {
                const containers = await SelfHostedStorage.listContainers(args.connectionString!);
                return ResponseBuilder.success(this.formatSelfHostedContainers(containers));
            }

            // Resolve project configuration if credentials not provided
            let resolvedArgs = args;
            if (!args.apiKey || !args.apiSecret || !args.projectId) {
                const resolved = ProjectTools.resolveCredentials(args);

                // Check if the resolved project is self-hosted
                if (resolved.project?.isSelfHosted) {
                    const containers = await SelfHostedStorage.listContainers(resolved.project.connectionString as string);
                    return ResponseBuilder.success(this.formatSelfHostedContainers(containers));
                }

                if (!resolved.success || !resolved.credentials) {
                    return ResponseBuilder.invalidParams('Missing required parameters. Either provide apiKey/apiSecret/projectId or configure a project.');
                }
                resolvedArgs = {
                    ...args,
                    apiKey: resolved.credentials.apiKey || undefined,
                    apiSecret: resolved.credentials.apiSecret || undefined,
                    projectId: resolved.credentials.projectId || undefined,
                    projectName: resolved.project?.name
                };
            }

            // Default to Production if no environment specified
            if (!resolvedArgs.environment) {
                resolvedArgs.environment = 'Production';
            }

            const result = await this.listStorageContainers(resolvedArgs);

            // DXP-66: Check if result is structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error: any) {
            // console.error('List storage containers error:', error);
            return ResponseBuilder.internalError('Failed to list storage containers', error.message);
        }
    }

    static async listStorageContainers(args: StorageArgs): Promise<StorageContainersResult | string> {
        // Extract authentication parameters
        const apiKey = args.apiKey!;
        const apiSecret = args.apiSecret!;
        const projectId = args.projectId!;
        const environment = args.environment!;

        // console.error(`Listing storage containers for ${environment}`);

        // DXP-102: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        try {
            const result: StorageContainersResponse | string[] = await DXPRestClient.getStorageContainers(
                projectId,
                apiKey,
                apiSecret,
                environment,
                false, // writable parameter
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            // Format response - REST API returns array of container names directly
            if (result && Array.isArray(result) && result.length > 0) {
                // Wrap in structure that formatStorageContainers expects
                return this.formatStorageContainers(result, environment);
            } else if (result) {
                // Might be wrapped in object with storageContainers property
                return this.formatStorageContainers(result, environment);
            }

            return ResponseBuilder.addFooter('No storage containers found');

        } catch (error: any) {
            // Handle REST API errors
            throw new Error(`Failed to list storage containers: ${error.message}`);
        }
    }

    static formatSelfHostedContainers(containers: SelfHostedContainer[]): string {
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

    static formatStorageContainers(data: StorageContainersResponse | string[], environment: string): StorageContainersResult {
        const { FORMATTING: { STATUS_ICONS } } = Config;

        let response = `${STATUS_ICONS.FOLDER} **Storage Containers - ${environment}**\n\n`;

        // DXP-66: Build structured data for automation tools
        let containers: string[] = [];

        if (data && typeof data === 'object' && 'storageContainers' in data && Array.isArray(data.storageContainers) && data.storageContainers.length > 0) {
            containers = data.storageContainers;
            response += '**Available Containers:**\n';
            data.storageContainers.forEach((container, index) => {
                response += `${index + 1}. 📦 ${container}\n`;
            });
        } else if (Array.isArray(data) && data.length > 0) {
            containers = data;
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

        // DXP-66: Return structured data and message
        const structuredData: StorageContainersData = {
            environment: environment,
            containerCount: containers.length,
            containers: containers
        };

        return {
            data: structuredData,
            message: ResponseBuilder.addFooter(response)
        };
    }

    /**
     * Generate storage SAS link
     */
    static async handleGenerateStorageSasLink(args: StorageArgs): Promise<any> {
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
                    apiKey: resolved.credentials.apiKey || undefined,
                    apiSecret: resolved.credentials.apiSecret || undefined,
                    projectId: resolved.credentials.projectId || undefined,
                    projectName: resolved.project?.name
                };
            }

            // Default to Production if no environment specified
            if (!resolvedArgs.environment) {
                resolvedArgs.environment = 'Production';
            }

            const result = await this.generateStorageSasLink(resolvedArgs);

            // DXP-66: Check if result is structured response with data and message
            if (result && typeof result === 'object' && 'data' in result && 'message' in result) {
                return ResponseBuilder.successWithStructuredData(result.data, result.message);
            }

            // Fallback for legacy string responses
            return ResponseBuilder.success(result);
        } catch (error: any) {
            // console.error('Generate SAS link error:', error);
            return ResponseBuilder.internalError('Failed to generate SAS link', error.message);
        }
    }

    static async generateStorageSasLink(args: StorageArgs): Promise<SasLinkResult | string> {
        // Extract parameters from args
        const apiKey = args.apiKey!;
        const apiSecret = args.apiSecret!;
        const projectId = args.projectId!;
        const { environment, containerName, permissions = 'Read', expiryHours = 24 } = args;
        // Convert expiryHours to validMinutes for display
        const validMinutes = expiryHours * 60;

        // console.error(`Generating SAS link for container ${containerName} in ${environment}`);

        // DXP-102: Use REST API instead of PowerShell (3-10x faster, no PowerShell dependency)
        try {
            // Determine if writable based on permissions
            const writable = (permissions === 'Write' || permissions === 'Delete');

            // Convert hours to retention hours for API
            const retentionHours = Math.ceil(expiryHours);

            const result: SasLinkResponse = await DXPRestClient.getContainerSasLink(
                projectId,
                apiKey,
                apiSecret,
                environment!,
                containerName!,
                {
                    retentionHours: retentionHours,
                    writable: writable
                },
                { apiUrl: args.apiUrl } // Support custom API URLs
            );

            // Format response
            if (result) {
                return this.formatSasLink(result, containerName!, environment!, permissions, validMinutes);
            }

            return ResponseBuilder.addFooter('SAS link generation completed');

        } catch (error: any) {
            // Handle REST API errors
            throw new Error(`Failed to generate SAS link for ${containerName}: ${error.message}`);
        }
    }

    static formatSasLink(data: SasLinkResponse, containerName: string, environment: string, permissions: string, validMinutes: number): SasLinkResult {
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

        // DXP-66: Return structured data and message
        const structuredData: SasLinkData = {
            containerName: containerName,
            environment: environment,
            permissions: permissions,
            validMinutes: validMinutes,
            expiresAt: new Date(Date.now() + validMinutes * 60000).toISOString(),
            sasUrl: data.sasLink || data.url || null
        };

        return {
            data: structuredData,
            message: ResponseBuilder.addFooter(response)
        };
    }
}

export default StorageTools;
