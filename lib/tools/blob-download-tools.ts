/**
 * Blob Download Tools - Download media/assets from Azure Storage
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import fs from 'fs';
const fsPromises = fs.promises;
import path from 'path';
import https from 'https';
import { URL } from 'url';
import ProjectTools from './project-tools';
import StorageTools from './storage-tools';
import ResponseBuilder from '../response-builder';
import ErrorHandler from '../error-handler';
import OutputLogger from '../output-logger';
import DownloadConfig from '../download-config';
import PermissionChecker from './permission-checker';
import downloadManager from '../download-manager';
import ManifestManager from '../manifest-manager';
import SelfHostedStorage from '../self-hosted-storage';
import ProjectResolutionFix from './project-resolution-fix';
import ProgressMonitor from '../progress-monitor';

/**
 * Blob download arguments
 */
interface BlobDownloadArgs {
    environment?: string;
    project?: string;
    containerName?: string;
    downloadPath?: string;
    filter?: string;
    previewOnly?: boolean;
    incremental?: boolean;
    forceFullDownload?: boolean;
    monitor?: boolean;
    background?: boolean;
    skipConfirmation?: boolean;
    force?: boolean;
    // Legacy parameters for compatibility
    projectName?: string;
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    isSelfHosted?: boolean;
    connectionString?: string;
    apiUrl?: string;
    // Internal flags
    __backgroundDownload?: boolean;
    __downloadKey?: string;
}

/**
 * Project configuration
 */
interface ProjectConfig {
    name: string;
    projectId?: string;
    apiKey?: string;
    apiSecret?: string;
    connectionString?: string;
    isSelfHosted?: boolean;
    blobPath?: string;
    dbPath?: string;
    logPath?: string;
}

/**
 * Blob information
 */
interface BlobInfo {
    name: string;
    size?: number;
    lastModified?: string | null;
}

/**
 * File type information
 */
interface FileTypeInfo {
    count: number;
    size: number;
}

/**
 * Container preview result
 */
interface PreviewResult {
    totalFiles: number;
    totalSize: number;
    filteredFiles: number;
    filteredSize: number;
    pageCount: number;
    fileTypes: Record<string, FileTypeInfo>;
    largestFiles: BlobInfo[];
    blobs: BlobInfo[];
    incrementalInfo?: {
        skippedFiles: number;
        skippedSize: number;
        toDownload: number;
    };
}

/**
 * Download result
 */
interface DownloadResult {
    downloadedFiles: Array<{ name: string; size?: number }>;
    failedFiles: Array<{ name: string; error: string }>;
    totalSize: number;
}

/**
 * Blob list result with pagination
 */
interface BlobListResult {
    blobs: BlobInfo[];
    pageCount: number;
    totalBlobs: number;
}

/**
 * Blob page result
 */
interface BlobPageResult {
    blobs: BlobInfo[];
    nextMarker: string | null;
}

/**
 * Manifest file info
 */
interface ManifestFileInfo {
    name: string;
    size: number;
    lastModified: string | null;
    source?: string;
}

/**
 * Incremental download info
 */
interface IncrementalInfo {
    manifest: any;
    skippedFiles: ManifestFileInfo[];
    filesToDownload: ManifestFileInfo[];
}

class BlobDownloadTools {
    private static _permissionsShown = false;

    /**
     * Convert glob pattern to regex pattern
     * Handles common patterns like *.pdf, *.jpg, etc.
     */
    static globToRegex(glob: string | null | undefined): string | null {
        if (!glob) return null;

        // Check if pattern contains glob characters
        const hasGlobChars = glob.includes('*') || glob.includes('?');

        // If no glob characters, treat as substring match
        if (!hasGlobChars) {
            return glob;
        }

        // Escape special regex characters except * and ?
        let regexPattern = glob
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
            .replace(/\*/g, '.*')  // * matches any characters
            .replace(/\?/g, '.');  // ? matches single character

        return regexPattern;
    }

    /**
     * Parse natural language container names for blob downloads
     */
    static parseNaturalLanguageContainer(input: string | undefined): string | undefined {
        if (!input || typeof input !== 'string') return input;

        const normalized = input.toLowerCase().trim();

        // Map friendly names to actual container names
        const mappings: Record<string, string> = {
            'media files': 'mysitemedia',
            'media': 'mysitemedia',
            'web content': '$web',
            'web': '$web',
            'backups': 'backups',
            'backup': 'backups'
        };

        // Check for exact matches
        if (mappings[normalized]) {
            OutputLogger.info(`📝 Interpreted "${input}" as container: ${mappings[normalized]}`);
            return mappings[normalized];
        }

        // Check for partial matches
        for (const [phrase, container] of Object.entries(mappings)) {
            if (normalized.includes(phrase)) {
                OutputLogger.info(`📝 Interpreted "${input}" as container: ${container}`);
                return container;
            }
        }

        // Return original if no match
        return input;
    }

    /**
     * Main entry point for downloading blobs/media/assets
     */
    static async handleDownloadBlobs(args: BlobDownloadArgs): Promise<any> {
        try {
            // Parse natural language container names
            if (args.containerName) {
                args.containerName = this.parseNaturalLanguageContainer(args.containerName);
            }

            OutputLogger.info('🚀 Starting blob download process...');

            const {
                environment,
                project,
                containerName,
                downloadPath,
                filter,
                previewOnly,
                monitor = false,  // DXP-3: Progress monitoring (default: false for opt-in)
                // Legacy parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret
            } = args;

            // DXP-3: Extract monitor and background parameters for progress tracking
            const monitorProgress = monitor === true;
            const backgroundMode = args.background === true;

            if (process.env.DEBUG === 'true') {
                if (monitorProgress) console.error('[DEBUG] Blob download progress monitoring enabled');
                if (backgroundMode) console.error('[DEBUG] Background mode enabled - will return immediately');
            }

            OutputLogger.info(`📋 Args: env=${environment}, project=${project || projectName}, container=${containerName}`);

            // Get project configuration (needed even for background mode to get proper project name)
            OutputLogger.info('🔑 Resolving project configuration...');
            const projectConfig = await this.getProjectConfig(
                project || projectName,
                {
                    ...args,
                    projectId: projectId || args.projectId,
                    apiKey: apiKey || args.apiKey,
                    apiSecret: apiSecret || args.apiSecret
                }
            );

            OutputLogger.info(`✅ Project config resolved: ${projectConfig.name} (${projectConfig.projectId ? projectConfig.projectId.substring(0, 8) + '...' : 'no ID'})`);

            // DXP-3: If background mode, delegate to background download handler with resolved project name
            if (backgroundMode) {
                return await this.handleBackgroundBlobDownload({...args, projectName: projectConfig.name}, monitorProgress);
            }

            // Check if we're in self-hosted mode FIRST before checking permissions
            // CRITICAL: Only self-hosted if has connectionString AND no DXP credentials
            const hasDxpCredentials = projectConfig.projectId && projectConfig.apiKey && projectConfig.apiSecret;
            const isSelfHosted = (projectConfig.connectionString || projectConfig.isSelfHosted) && !hasDxpCredentials;

            if (isSelfHosted) {
                OutputLogger.info('🏢 Self-hosted Azure Storage mode detected');

                // Determine download location using new config system
                const targetPath = await DownloadConfig.getDownloadPath(
                    'blobs',
                    projectConfig.name,
                    downloadPath || null,
                    'self-hosted'
                );

                return await this.handleSelfHostedDownload({...args, ...projectConfig}, targetPath);
            }

            // Check environment permissions if not explicitly specified (only for DXP projects)
            let targetEnv: string;
            if (!environment) {
                // Get or check permissions
                const permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);

                // Use Production as default for downloads (safer for production data)
                const defaultEnv = PermissionChecker.getDefaultEnvironment(permissions, 'download');
                if (defaultEnv) {
                    targetEnv = defaultEnv;
                    OutputLogger.info(`🎯 Using default environment for downloads: ${targetEnv}`);

                    // Show permissions info on first use
                    if (!this._permissionsShown) {
                        const permissionMsg = PermissionChecker.formatPermissionsMessage(permissions);
                        OutputLogger.info(permissionMsg);
                        this._permissionsShown = true;
                    }
                } else {
                    // No accessible environments
                    return ResponseBuilder.error(
                        `❌ **No Accessible Environments**\n\n` +
                        `This API key does not have access to any environments.\n` +
                        `Please check your API key configuration in the Optimizely DXP Portal.`
                    );
                }
            } else {
                // Environment was explicitly specified
                const envToUse = environment;
                OutputLogger.info(`🎯 Environment explicitly specified: ${envToUse}`);
                targetEnv = this.parseEnvironment(envToUse);

                // Verify access to specified environment
                const permissions = await PermissionChecker.getOrCheckPermissionsSafe(projectConfig);
                if (!permissions.accessible.includes(targetEnv)) {
                    return ResponseBuilder.error(
                        `❌ **Access Denied to ${targetEnv}**\n\n` +
                        `Your API key does not have access to the ${targetEnv} environment.\n\n` +
                        `**Available environments:** ${permissions.accessible.join(', ') || 'None'}\n\n` +
                        `Please use one of the available environments or update your API key permissions.`
                    );
                }
            }

            // Determine download location using new config system
            const targetPath = await DownloadConfig.getDownloadPath(
                'blobs',
                projectConfig.name,
                downloadPath || null,
                targetEnv
            );

            OutputLogger.info(`🔍 Discovering storage containers for ${projectConfig.name} in ${targetEnv}...`);

            // List available containers
            let containersResult: any;
            try {
                containersResult = await StorageTools.handleListStorageContainers({
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId,
                    environment: targetEnv
                });
            } catch (error: any) {
                return ResponseBuilder.error(
                    `Failed to list storage containers: ${error.message}`
                );
            }

            // Parse container list
            const containers = this.parseContainerList(containersResult);

            OutputLogger.info(`📋 Found ${containers.length} containers: ${containers.join(', ')}`);

            if (!containers || containers.length === 0) {
                // Add helpful debug info only in development
                if (process.env.DEBUG) {
                    OutputLogger.error(`Container list result type: ${typeof containersResult}`);
                    OutputLogger.error(`Container list result keys: ${containersResult ? Object.keys(containersResult) : 'null'}`);
                    if (containersResult && typeof containersResult === 'object') {
                        OutputLogger.error(`Container list raw content: ${JSON.stringify(containersResult, null, 2)}`);
                    }
                }
                return ResponseBuilder.error(
                    `No storage containers found in ${targetEnv} environment`
                );
            }

            // Determine which container to download
            let targetContainer = containerName;

            if (!targetContainer) {
                // Try to auto-detect the media/assets container
                targetContainer = this.detectMediaContainer(containers) || undefined;

                if (!targetContainer) {
                    // If multiple containers, ask user to specify
                    return this.formatContainerChoice(containers, targetEnv);
                }

                OutputLogger.info(`📦 Auto-selected container: ${targetContainer}`);
            }

            // Verify container exists (case-insensitive)
            // DXP-178 FIX: parseContainerList returns lowercase names, so compare case-insensitively
            const targetContainerLower = targetContainer.toLowerCase();
            if (!containers.includes(targetContainerLower)) {
                return ResponseBuilder.error(
                    `Container '${targetContainer}' not found. Available: ${containers.join(', ')}`
                );
            }

            // DXP-178 FIX: Use the lowercase version for API calls (Azure container names are case-sensitive lowercase)
            targetContainer = targetContainerLower;

            OutputLogger.info(`🔑 Generating SAS link for container: ${targetContainer}...`);

            // Log what we're sending (without secrets)
            OutputLogger.info(`Request params: env=${targetEnv}, container=${targetContainer}, project=${projectConfig.projectId ? projectConfig.projectId.substring(0, 8) + '...' : 'missing'}`);

            // Call the handler method which returns a properly formatted response
            const sasResponse = await StorageTools.handleGenerateStorageSasLink({
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                projectId: projectConfig.projectId,
                environment: targetEnv,
                containerName: targetContainer,
                permissions: 'Read',
                expiryHours: 2 // 2 hours should be enough for download
            });

            // Extract SAS URL from the response
            const sasUrl = this.extractSasUrl(sasResponse);

            if (!sasUrl) {
                OutputLogger.error('Failed to extract SAS URL from response');
                OutputLogger.error(`SAS Response type: ${typeof sasResponse}`);
                OutputLogger.error(`SAS Response keys: ${sasResponse ? Object.keys(sasResponse) : 'null'}`);

                // Check if it's an error response
                if (sasResponse && sasResponse.error) {
                    return ResponseBuilder.error(`Storage API Error: ${sasResponse.error.message || 'Unknown error'}`);
                }

                // Log the actual response for debugging
                if (sasResponse && sasResponse.result && sasResponse.result.content && sasResponse.result.content[0]) {
                    const content = sasResponse.result.content[0];
                    if (content && content.text) {
                        OutputLogger.error(`Response text (first 500 chars): ${content.text.substring(0, 500)}`);

                        // Check if the response contains an error message
                        if (content.text.includes('Error') || content.text.includes('Failed')) {
                            return ResponseBuilder.error(content.text);
                        }
                    }
                }

                if (typeof sasResponse === 'string' && sasResponse.includes('Error')) {
                    return ResponseBuilder.error(sasResponse);
                }

                return ResponseBuilder.error(
                    'Failed to generate SAS link for container. Please verify the container exists and you have access.'
                );
            }

            // Always show preview first (unless explicitly skipped)
            // CRITICAL: When previewOnly is true, never skip confirmation to ensure preview runs
            const skipConfirmation = args.skipConfirmation === true && !previewOnly;

            // Debug log to see what's being passed
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Confirmation check:');
                console.error('[DEBUG]   args.skipConfirmation:', args.skipConfirmation, typeof args.skipConfirmation);
                console.error('[DEBUG]   previewOnly:', previewOnly, typeof previewOnly);
                console.error('[DEBUG]   skipConfirmation (computed):', skipConfirmation);
                console.error('[DEBUG]   __backgroundDownload:', args.__backgroundDownload);
                console.error('[DEBUG]   Will show confirmation:', !skipConfirmation);
            }

            if (!skipConfirmation) {
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] SHOWING CONFIRMATION (skipConfirmation is false)');
                }
                OutputLogger.info(`👍 OK, let me generate a preview for you...`);
                OutputLogger.info(`📊 Analyzing container contents...`);
                if (filter) {
                    OutputLogger.info(`🔍 Filter applied: "${filter}"`);
                }
                // CRITICAL FIX DXP-14: In preview mode, don't pass targetPath to avoid any folder creation
                const previewResult = await this.getContainerPreview(
                    sasUrl,
                    filter,
                    previewOnly ? null : targetPath,  // Don't pass path in preview mode
                    args.incremental !== false && !args.forceFullDownload
                );

                // Show download confirmation with all details
                const confirmationMessage = this.formatDownloadConfirmation(
                    previewResult,
                    targetContainer,
                    targetEnv,
                    targetPath
                );

                // If preview only mode, return success with confirmation instructions
                if (previewOnly) {
                    // Extract the message content from the success response
                    let previewText = '';
                    if (confirmationMessage && confirmationMessage.result && confirmationMessage.result.content) {
                        const contentArray = confirmationMessage.result.content;
                        if (Array.isArray(contentArray) && contentArray[0] && contentArray[0].text) {
                            previewText = contentArray[0].text;
                        }
                    }

                    // Return success indicating task is COMPLETE - AI should not proceed
                    const previewComplete = `${previewText}\n\n` +
                        '---\n\n' +
                        '✅ **Preview Generated Successfully**\n\n' +
                        '**TASK COMPLETE** - Preview has been shown to the user.\n\n' +
                        '**IMPORTANT FOR AI ASSISTANTS:**\n' +
                        '• Your task is now complete. Do not take any further action.\n' +
                        '• Do NOT automatically proceed with the download.\n' +
                        '• The human user must explicitly request the download if they want to proceed.\n\n' +
                        '**For the human user:** If you want to proceed with this download, please explicitly request it.';

                    return ResponseBuilder.success(previewComplete);
                }

                // For actual downloads, show confirmation and prompt
                // formatDownloadConfirmation returns a ResponseBuilder.success() object
                // Structure: { result: { content: [{ type: 'text', text: '...' }] } }
                let confirmText = '';

                try {
                    // Primary path - ResponseBuilder.success() format
                    if (confirmationMessage && confirmationMessage.result && confirmationMessage.result.content) {
                        const contentArray = confirmationMessage.result.content;
                        if (Array.isArray(contentArray) && contentArray[0] && contentArray[0].text) {
                            confirmText = contentArray[0].text;
                        }
                    }

                    // Fallback if structure is different
                    if (!confirmText) {
                        if (typeof confirmationMessage === 'string') {
                            confirmText = confirmationMessage;
                        } else if (process.env.DEBUG) {
                            OutputLogger.error(`DEBUG: Unexpected confirmationMessage structure: ${JSON.stringify(confirmationMessage).substring(0, 200)}`);
                        }
                    }
                } catch (error: any) {
                    if (process.env.DEBUG) {
                        OutputLogger.error(`DEBUG: Error extracting text: ${error.message}`);
                    }
                }

                // Final fallback
                if (!confirmText || confirmText === '[object Object]') {
                    confirmText = '# Download Preview\n\nPreview generation encountered an issue. Please try again with DEBUG=true for more details.';
                }

                // Build the complete message with preview and instructions
                let fullMessage = confirmText;
                fullMessage += '\n\n⚠️  **Download Confirmation Required**\n';
                fullMessage += 'Please review the above details and confirm you want to proceed.\n\n';
                fullMessage += '**To proceed with download**, say:\n';
                fullMessage += '   "Yes" or "Yes, proceed with the download"\n\n';
                fullMessage += '**To use a different folder**, specify:\n';
                fullMessage += '   "Download to /your/preferred/path"\n\n';
                fullMessage += '**To cancel**, say "No" or just ignore this message.';

                // Also log for debugging
                if (process.env.DEBUG) {
                    OutputLogger.info(fullMessage);
                }

                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Returning confirmation message (download NOT started)');
                }

                return ResponseBuilder.success(fullMessage);
            }

            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Confirmation skipped - proceeding with download');
            }

            // Register the download (skip if already registered by background handler)
            let downloadKey: string;

            if (args.__backgroundDownload && args.__downloadKey) {
                // Background download - use existing registration
                downloadKey = args.__downloadKey;

                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Using existing download key from background handler:', downloadKey);
                }
            } else {
                // Normal download - register new download
                const downloadInfo = {
                    projectName: projectConfig.name,
                    containerName: targetContainer,
                    environment: targetEnv,
                    downloadPath: targetPath,
                    filter: filter || null,
                    type: 'blobs'
                };

                const overlaps = downloadManager.checkOverlap(downloadInfo);
                if (overlaps.length > 0 && !args.force) {
                    const activeDownload = overlaps[0].active;
                    return ResponseBuilder.error(
                        `⚠️ **Download Already In Progress**\n\n` +
                        `There's already an active download for this container:\n` +
                        `• **Project**: ${activeDownload.projectName}\n` +
                        `• **Container**: ${activeDownload.containerName}\n` +
                        `• **Progress**: ${activeDownload.progress}%\n\n` +
                        `**Options:**\n` +
                        `• Wait for the current download to complete\n` +
                        `• Use \`list_active_downloads\` to see all active downloads\n` +
                        `• Use \`cancel_download\` to cancel the active download\n` +
                        `• Add \`force: true\` to override and start anyway`
                    );
                }

                downloadKey = downloadManager.registerDownload(downloadInfo);

                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Registered new download:', downloadKey);
                }
            }

            OutputLogger.info(`\n📦➡️💾 DOWNLOADING: ${targetContainer} ➡️ ${targetPath}\n`);
            OutputLogger.info(`📥 Starting download process...`);

            try {
                // Start the download process
                const downloadResult = await this.downloadContainerContents(
                    sasUrl,
                    targetPath,
                    filter,
                    downloadKey,  // Pass the key for progress updates
                    args.incremental !== false,  // Default to true
                    args.forceFullDownload === true,  // Default to false
                    monitorProgress  // DXP-3: Pass monitor flag
                );

                // Mark download as complete
                downloadManager.completeDownload(downloadKey, {
                    filesDownloaded: downloadResult.downloadedFiles.length,
                    totalSize: downloadResult.totalSize,
                    failed: downloadResult.failedFiles.length
                });

                // Format success response
                return this.formatDownloadResult(
                    downloadResult,
                    targetContainer,
                    targetEnv,
                    targetPath
                );
            } catch (error: any) {
                // Mark download as failed
                downloadManager.failDownload(downloadKey, error.message);
                throw error;
            }

        } catch (error: any) {
            return ErrorHandler.handleError(error, 'download-blobs', args);
        }
    }

    /**
     * Get project configuration
     */
    static async getProjectConfig(project: string | undefined, args: BlobDownloadArgs): Promise<ProjectConfig> {
        // If we have inline credentials, use them
        if (args.projectId && args.apiKey && args.apiSecret) {
            // Try to get the project name and path config from ProjectTools
            let projectName = project;
            let blobPath: string | undefined, dbPath: string | undefined, logPath: string | undefined;

            try {
                // Try to find the project by ID to get its configuration
                const projects = ProjectTools.getConfiguredProjects();
                const matchingProject = projects.find(p => p.projectId === args.projectId);

                if (matchingProject) {
                    projectName = matchingProject.name;
                    // Include the path configurations if they exist
                    blobPath = matchingProject.blobPath;
                    dbPath = matchingProject.dbPath;
                    logPath = matchingProject.logPath;
                } else if (!projectName && projects && projects.length > 0 && projects[0]) {
                    // Use first project as fallback for name only
                    projectName = projects[0].name;
                }
            } catch (e) {
                // If all else fails, use a generic name
                projectName = projectName || 'optimizely-blobs';
            }

            const config: ProjectConfig = {
                name: projectName || 'optimizely-blobs',
                projectId: args.projectId,
                apiKey: args.apiKey,
                apiSecret: args.apiSecret
            };

            // Add path configurations if they exist
            if (blobPath) config.blobPath = blobPath;
            if (dbPath) config.dbPath = dbPath;
            if (logPath) config.logPath = logPath;

            return config;
        }

        // Otherwise get from ProjectTools - use proper multi-project resolution
        // Use ProjectResolutionFix to handle multi-project scenarios
        const resolution = ProjectResolutionFix.resolveProjectSafely({
            project: project,
            projectName: args.projectName
        }, ProjectTools as any);

        if (!resolution.success) {
            // Handle multi-project scenario
            if (resolution.requiresSelection) {
                const selectionError = ProjectResolutionFix.showProjectSelection(resolution.availableProjects as any);
                throw new Error(selectionError.result.content.join('\n'));
            }
            throw new Error(resolution.message || 'Failed to resolve project');
        }

        return (resolution.project || resolution.credentials) as any;
    }

    /**
     * Parse environment aliases
     */
    static parseEnvironment(env: string): string {
        const envLower = env.toLowerCase();
        const aliases: Record<string, string> = {
            'prod': 'Production',
            'production': 'Production',
            'staging': 'Preproduction',
            'stage': 'Preproduction',
            'pre': 'Preproduction',
            'preproduction': 'Preproduction',
            'int': 'Integration',
            'integration': 'Integration',
            'dev': 'Integration',
            'development': 'Integration'
        };

        return aliases[envLower] || env;
    }

    /**
     * Parse container list from storage tools result
     */
    static parseContainerList(result: any): string[] {
        try {
            let text = '';

            // Handle different response formats
            if (typeof result === 'object' && result !== null) {
                // Direct content array format
                if (result.content && Array.isArray(result.content) && result.content[0]) {
                    const content = result.content[0];
                    if (content && content.text) {
                        text = content.text;
                    }
                }
                // ResponseBuilder.success format
                else if (result.result && result.result.content && Array.isArray(result.result.content) && result.result.content[0]) {
                    const content = result.result.content[0];
                    if (content && content.text) {
                        text = content.text;
                    }
                }
                // Error format
                else if (result.error) {
                    OutputLogger.error(`Error in container list response: ${result.error}`);
                    return [];
                }
                // Direct object - try to stringify
                else {
                    text = JSON.stringify(result);
                }
            } else if (typeof result === 'string') {
                text = result;
            }

            // Return empty if no text found
            if (!text || text.trim() === '') {
                return [];
            }

            // Extract container names - DXP-178 FIX: Simplified robust extraction
            const containers: string[] = [];
            const seen = new Set<string>();

            // DXP-178 FIX: Extract ALL valid container-name-like strings from text
            // Pattern matches container names: alphanumeric with hyphens/underscores, 3+ chars
            const allMatches = text.match(/[a-z][a-z0-9-_]{2,}/gi);

            if (allMatches) {
                for (const match of allMatches) {
                    const containerName = match.toLowerCase();

                    // Skip common non-container words
                    if (containerName &&
                        containerName.length > 2 &&
                        !containerName.includes('available') &&
                        !containerName.includes('built') &&
                        !containerName.includes('tips') &&
                        !containerName.includes('use') &&
                        !containerName.includes('select') &&
                        !containerName.includes('container') &&
                        !containerName.includes('storage') &&
                        !seen.has(containerName)) {

                        seen.add(containerName);
                        containers.push(containerName);

                        // DXP-178 DEBUG: Log extracted container name
                        if (process.env.DEBUG === 'true') {
                            console.error(`[DEBUG] Extracted container: "${containerName}"`);
                        }
                    }
                }
            }

            // DXP-178 DEBUG: Log final container list
            if (process.env.DEBUG === 'true') {
                console.error(`[DEBUG] Final container list: ${JSON.stringify(containers)}`);
            }

            return containers;
        } catch (error: any) {
            OutputLogger.error(`Failed to parse container list: ${error.message}`);
            return [];
        }
    }

    /**
     * Auto-detect the media/assets container
     */
    static detectMediaContainer(containers: string[]): string | null {
        // Common media container names
        const mediaPatterns = [
            'mysitemedia',
            'media',
            'assets',
            'blobs',
            'public',
            'content'
        ];

        // Check for exact matches first
        for (const pattern of mediaPatterns) {
            const found = containers.find(c => c.toLowerCase() === pattern);
            if (found) return found;
        }

        // Check for containers containing these patterns
        for (const pattern of mediaPatterns) {
            const found = containers.find(c => c.toLowerCase().includes(pattern));
            if (found) return found;
        }

        // If only one container, use it
        if (containers.length === 1 && containers[0]) {
            return containers[0];
        }

        return null;
    }

    /**
     * Format container choice message
     */
    static formatContainerChoice(containers: string[], environment: string): any {
        let message = `📦 **Multiple Storage Containers Found**\n\n`;
        message += `**Environment**: ${environment}\n`;
        message += `**Available Containers**:\n`;

        containers.forEach((container, index) => {
            message += `${index + 1}. ${container}\n`;
        });

        message += `\n💡 **Specify which container to download**:\n`;
        message += `\`claude "download blobs from ${containers[0]}"\`\n`;

        if (containers.find(c => c.toLowerCase().includes('media'))) {
            message += `\n**Tip**: The 'media' container likely contains your CMS assets`;
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Extract SAS URL from storage tools result
     */
    static extractSasUrl(result: any): string | null {
        try {
            let textToSearch = '';

            // Handle ResponseBuilder format (from handleGenerateStorageSasLink)
            if (typeof result === 'object' && result !== null) {
                if (result.result && result.result.content && Array.isArray(result.result.content) && result.result.content[0]) {
                    // Extract text from ResponseBuilder format
                    const content = result.result.content[0];
                    if (content && content.text) {
                        textToSearch = content.text;
                    }
                } else if (result.error) {
                    // Error response
                    return null;
                } else {
                    // Check common property names
                    const urlProps = ['sasLink', 'url', 'sasUrl', 'link'];
                    for (const prop of urlProps) {
                        if (result[prop] && typeof result[prop] === 'string' && result[prop].startsWith('https://')) {
                            return result[prop];
                        }
                    }

                    // Try stringifying
                    textToSearch = JSON.stringify(result);
                }
            } else if (typeof result === 'string') {
                textToSearch = result;
            }

            // Now search for URL in the text
            if (textToSearch) {
                // Look for URL in backticks (the format used by StorageTools)
                const backtickMatch = textToSearch.match(/`(https:\/\/[^`]+)`/);
                if (backtickMatch) {
                    return backtickMatch[1];
                }

                // Fallback: Look for any HTTPS URL
                const urlMatch = textToSearch.match(/https:\/\/[^\s"'`<>\\]+/);
                if (urlMatch) {
                    return urlMatch[0];
                }
            }

            return null;
        } catch (error: any) {
            OutputLogger.error(`Failed to extract SAS URL: ${error.message}`);
            return null;
        }
    }

    /**
     * Download all contents from a container using SAS URL
     */
    static async downloadContainerContents(
        sasUrl: string,
        targetPath: string,
        filter: string | undefined,
        downloadKey: string | null = null,
        incremental = true,
        forceFullDownload = false,
        monitorProgress = false
    ): Promise<DownloadResult> {
        const downloadedFiles: Array<{ name: string; size?: number }> = [];
        const failedFiles: Array<{ name: string; error: string }> = [];
        let totalSize = 0;

        // DXP-3: Initialize progress monitor
        let progressMonitor: any = null;

        try {
            // Ensure target directory exists
            await fsPromises.mkdir(targetPath, { recursive: true });

            // Parse the SAS URL
            const url = new URL(sasUrl);
            const containerUrl = `${url.protocol}//${url.host}${url.pathname}`;
            const sasToken = url.search;

            OutputLogger.info('📋 Listing blobs in container (supports >5000 files via pagination)...');

            // List blobs in the container
            const blobResult = await this.listBlobsInContainer(containerUrl, sasToken);
            const blobs = blobResult.blobs;

            if (blobs.length === 0) {
                OutputLogger.warn('No blobs found in container');
                return { downloadedFiles, failedFiles, totalSize };
            }

            // Apply filter if specified
            let blobsToDownload = blobs;
            if (filter) {
                OutputLogger.info(`🔍 Applying filter: "${filter}"`);
                const regexPattern = this.globToRegex(filter);
                const filterRegex = new RegExp(regexPattern!, 'i');
                blobsToDownload = blobs.filter(blob => filterRegex.test(blob.name));
                OutputLogger.info(`✅ Filtered: ${blobsToDownload.length} of ${blobs.length} files match filter`);

                // If only 1-3 files match, list them
                if (blobsToDownload.length > 0 && blobsToDownload.length <= 3) {
                    blobsToDownload.forEach(blob => {
                        OutputLogger.info(`  • ${blob.name} (${this.formatBytes(blob.size || 0)})`);
                    });
                }
            }

            // Check for incremental download opportunities
            let incrementalInfo: IncrementalInfo | null = null;
            let skippedFiles: ManifestFileInfo[] = [];

            if (incremental && !forceFullDownload) {
                OutputLogger.info('🔄 Checking for incremental download opportunities...');

                const manifestCheck = await ManifestManager.getFilesToDownload(
                    targetPath,
                    blobsToDownload.map(blob => ({
                        name: blob.name,
                        size: blob.size || 0,
                        lastModified: blob.lastModified || null,
                        source: containerUrl
                    })) as any
                );

                incrementalInfo = manifestCheck as any;
                skippedFiles = manifestCheck.skippedFiles as any;
                blobsToDownload = manifestCheck.filesToDownload.map(f => {
                    // Map back to original blob format
                    const originalBlob = blobsToDownload.find(b => b.name === f.name);
                    return originalBlob || f;
                });

                if (skippedFiles.length > 0) {
                    OutputLogger.info(`✨ Smart download: Skipping ${skippedFiles.length} unchanged files`);
                    OutputLogger.info(`   Bandwidth saved: ${ManifestManager.formatBytes(skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0))}`);
                }
            }

            // Calculate total size and show preview
            const totalBlobSize = blobsToDownload.reduce((sum, blob) => sum + (blob.size || 0), 0);
            const avgSpeedBytesPerSec = 5 * 1024 * 1024; // Assume 5MB/s average download speed
            const estimatedSeconds = totalBlobSize / avgSpeedBytesPerSec; // This is correct - uses filtered size

            OutputLogger.info('');
            OutputLogger.info('📊 **Download Preview**');
            OutputLogger.info(`   Files to download: ${blobsToDownload.length}`);
            OutputLogger.info(`   Total size: ${this.formatBytes(totalBlobSize)}`);
            OutputLogger.info(`   Estimated time: ${this.formatDuration(estimatedSeconds)}`);
            OutputLogger.info('');

            // Show sample of files to be downloaded
            if (blobsToDownload.length > 0) {
                OutputLogger.info('📁 Sample files:');
                const sampleCount = Math.min(5, blobsToDownload.length);
                for (let i = 0; i < sampleCount; i++) {
                    const blob = blobsToDownload[i];
                    OutputLogger.info(`   • ${blob.name} (${this.formatBytes(blob.size || 0)})`);
                }
                if (blobsToDownload.length > sampleCount) {
                    OutputLogger.info(`   ... and ${blobsToDownload.length - sampleCount} more files`);
                }
                OutputLogger.info('');
            }

            // Show warning for large downloads (over 1GB)
            const oneGB = 1024 * 1024 * 1024;
            if (totalBlobSize > oneGB) {
                OutputLogger.warn(`⚠️  This is a large download (${this.formatBytes(totalBlobSize)})`);
                OutputLogger.info('   Consider using filters to download specific files if needed.');
                OutputLogger.info('   Example: filter="*.jpg" to download only JPG files\n');
            }

            OutputLogger.info('⏳ Starting download...\n');

            // DXP-3: Initialize progress monitor if enabled
            progressMonitor = new ProgressMonitor({
                totalFiles: blobsToDownload.length,
                totalBytes: totalBlobSize,
                enabled: monitorProgress || true,  // Always enable for background downloads
                downloadType: 'blobs',
                updateInterval: 10000, // Update every 10 seconds
                updateThreshold: 10 // Or every 10 files (DXP-3: reduced from 50)
            });

            // DXP-3: Store ProgressMonitor in DownloadManager for live queries
            if (downloadKey) {
                downloadManager.setProgressMonitor(downloadKey, progressMonitor);
            }

            if (monitorProgress) {
                OutputLogger.info(`📊 Progress monitoring enabled - updates every 10s or 10 files`);
                if (process.env.DEBUG === 'true') {
                    console.error(`[DEBUG] ProgressMonitor initialized: enabled=${progressMonitor.enabled}, totalFiles=${progressMonitor.totalFiles}`);
                }
            }

            // Track progress
            let downloadedSize = 0;
            const startTime = Date.now();

            // Download each blob
            for (let i = 0; i < blobsToDownload.length; i++) {
                const blob = blobsToDownload[i];
                const progressNum = i + 1;
                const percentage = Math.round((progressNum / blobsToDownload.length) * 100);

                // Update download manager progress if we have a key
                if (downloadKey) {
                    downloadManager.updateProgress(downloadKey, percentage, 'downloading');
                }

                try {
                    // Show detailed progress (only if monitoring disabled - monitor handles its own display)
                    if (!monitorProgress) {
                        const elapsedMs = Date.now() - startTime;
                        const avgTimePerFile = elapsedMs / progressNum;
                        const remainingFiles = blobsToDownload.length - progressNum;
                        const etaMs = remainingFiles * avgTimePerFile;

                        OutputLogger.progress(
                            `[${progressNum}/${blobsToDownload.length}] ${percentage}% | ` +
                            `${this.formatBytes(downloadedSize)}/${this.formatBytes(totalBlobSize)} | ` +
                            `ETA: ${this.formatDuration(etaMs / 1000)} | ` +
                            `Downloading: ${blob.name}`
                        );
                    }

                    const localPath = path.join(targetPath, blob.name);
                    const blobUrl = `${containerUrl}/${blob.name}${sasToken}`;

                    // Ensure parent directory exists
                    await fsPromises.mkdir(path.dirname(localPath), { recursive: true});

                    // Download the blob
                    const size = await this.downloadBlob(blobUrl, localPath);

                    downloadedFiles.push({ name: blob.name, size });
                    totalSize += size;
                    downloadedSize += size;

                    // DXP-3: Update progress monitor if enabled
                    if (monitorProgress && progressMonitor) {
                        progressMonitor.update(progressNum, downloadedSize, blob.name);
                    }

                    // Add to manifest for future incremental downloads
                    if (incrementalInfo) {
                        ManifestManager.addFileToManifest(incrementalInfo.manifest, blob.name, {
                            size: size,
                            lastModified: blob.lastModified || new Date().toISOString(),
                            source: containerUrl
                        });
                    }

                } catch (error: any) {
                    OutputLogger.error(`Failed to download ${blob.name}: ${error.message}`);
                    failedFiles.push({ name: blob.name, error: error.message });
                }
            }

            // DXP-3: Mark download as complete in progress monitor
            if (monitorProgress && progressMonitor) {
                progressMonitor.complete();
            }

            // Only show summary if monitoring is disabled (monitor already showed completion)
            if (!monitorProgress) {
                OutputLogger.success(`✅ Downloaded ${downloadedFiles.length} files (${this.formatBytes(totalSize)})`);
            }

            if (failedFiles.length > 0) {
                OutputLogger.warn(`⚠️ Failed to download ${failedFiles.length} files`);
            }

        } catch (error: any) {
            // DXP-3: Mark download as failed in progress monitor
            if (monitorProgress && progressMonitor) {
                progressMonitor.error(error.message);
            }

            OutputLogger.error(`Container download failed: ${error.message}`);
            throw error;
        }

        return { downloadedFiles, failedFiles, totalSize };
    }

    /**
     * List all blobs in a container with pagination support
     */
    static async listBlobsInContainer(containerUrl: string, sasToken: string): Promise<BlobListResult> {
        const allBlobs: BlobInfo[] = [];
        let marker: string | null = null;
        let pageCount = 0;

        do {
            const result = await this.listBlobsPage(containerUrl, sasToken, marker);
            allBlobs.push(...result.blobs);
            marker = result.nextMarker;
            pageCount++;

            if (marker) {
                OutputLogger.info(`📄 Retrieved page ${pageCount} (${result.blobs.length} blobs), continuing...`);
            }
        } while (marker);

        if (pageCount > 1) {
            OutputLogger.info(`✅ Retrieved all ${allBlobs.length} blobs across ${pageCount} pages`);
        }

        return {
            blobs: allBlobs,
            pageCount: pageCount,
            totalBlobs: allBlobs.length
        };
    }

    /**
     * List a single page of blobs
     */
    static async listBlobsPage(containerUrl: string, sasToken: string, marker: string | null = null): Promise<BlobPageResult> {
        return new Promise((resolve, reject) => {
            let listUrl = `${containerUrl}?restype=container&comp=list${sasToken.replace('?', '&')}`;
            if (marker) {
                listUrl += `&marker=${encodeURIComponent(marker)}`;
            }

            https.get(listUrl, (response) => {
                let data = '';

                response.on('data', chunk => {
                    data += chunk;
                });

                response.on('end', () => {
                    try {
                        const result = this.parseBlobListXmlWithMarker(data);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                });

                response.on('error', reject);
            });
        });
    }

    /**
     * Parse blob list XML response with pagination marker support
     */
    static parseBlobListXmlWithMarker(xml: string): BlobPageResult {
        const blobs: BlobInfo[] = [];

        // Simple XML parsing for blob names
        const blobMatches = xml.match(/<Blob>[\s\S]*?<\/Blob>/g) || [];

        for (const blobXml of blobMatches) {
            const nameMatch = blobXml.match(/<Name>([^<]+)<\/Name>/);
            const sizeMatch = blobXml.match(/<Content-Length>(\d+)<\/Content-Length>/);
            const lastModifiedMatch = blobXml.match(/<Last-Modified>([^<]+)<\/Last-Modified>/);

            if (nameMatch) {
                blobs.push({
                    name: nameMatch[1],
                    size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                    lastModified: lastModifiedMatch ? lastModifiedMatch[1] : null
                });
            }
        }

        // Check for NextMarker for pagination
        const nextMarkerMatch = xml.match(/<NextMarker>([^<]+)<\/NextMarker>/);
        const nextMarker = nextMarkerMatch ? nextMarkerMatch[1] : null;

        return {
            blobs,
            nextMarker
        };
    }

    /**
     * Download a single blob
     */
    static async downloadBlob(blobUrl: string, localPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(localPath);
            let size = 0;

            https.get(blobUrl, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                response.on('data', chunk => {
                    size += chunk.length;
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close(() => resolve(size));
                });

                file.on('error', (error) => {
                    fs.unlinkSync(localPath);
                    reject(error);
                });
            }).on('error', reject);
        });
    }

    /**
     * Format bytes to human readable
     */
    static formatBytes(bytes: number): string {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Format duration to human readable
     */
    static formatDuration(seconds: number): string {
        if (seconds < 1) return 'less than a second';
        if (seconds < 60) return `${Math.round(seconds)} seconds`;

        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            return `${days}d ${hours % 24}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else {
            return `${minutes}m ${Math.round(seconds % 60)}s`;
        }
    }

    /**
     * Get container preview without downloading
     */
    static async getContainerPreview(
        sasUrl: string,
        filter: string | undefined,
        targetPath: string | null = null,
        checkIncremental = false
    ): Promise<PreviewResult> {
        try {
            // Parse the SAS URL
            const url = new URL(sasUrl);
            const containerUrl = `${url.protocol}//${url.host}${url.pathname}`;
            const sasToken = url.search;

            // List blobs in the container
            const blobResult = await this.listBlobsInContainer(containerUrl, sasToken);
            const blobs = blobResult.blobs;

            // Calculate original totals
            const originalTotalFiles = blobs.length;
            const originalTotalSize = blobs.reduce((sum, blob) => sum + (blob.size || 0), 0);

            // Apply filter if specified
            let filteredBlobs = blobs;
            if (filter) {
                const regexPattern = this.globToRegex(filter);
                const filterRegex = new RegExp(regexPattern!, 'i');
                filteredBlobs = blobs.filter(blob => filterRegex.test(blob.name));
            }

            // Calculate filtered statistics
            const filteredTotalSize = filteredBlobs.reduce((sum, blob) => sum + (blob.size || 0), 0);
            const fileTypes: Record<string, FileTypeInfo> = {};
            const largestFiles = [...filteredBlobs].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 10);

            // Count file types with size information
            filteredBlobs.forEach(blob => {
                const ext = path.extname(blob.name).toLowerCase() || 'no extension';
                if (!fileTypes[ext]) {
                    fileTypes[ext] = { count: 0, size: 0 };
                }
                fileTypes[ext].count++;
                fileTypes[ext].size += (blob.size || 0);
            });

            // Check for incremental opportunities if path provided
            let incrementalInfo: { skippedFiles: number; skippedSize: number; toDownload: number } | undefined = undefined;
            if (targetPath && checkIncremental) {
                try {
                    const manifestCheck = await ManifestManager.getFilesToDownload(
                        targetPath,
                        filteredBlobs.map(blob => ({
                            name: blob.name,
                            size: blob.size || 0,
                            lastModified: blob.lastModified || null
                        })) as any
                    );
                    incrementalInfo = {
                        skippedFiles: manifestCheck.skippedFiles.length,
                        skippedSize: manifestCheck.skippedFiles.reduce((sum: number, f: any) => sum + (f.size || 0), 0),
                        toDownload: manifestCheck.filesToDownload.length
                    };
                } catch (error: any) {
                    // Ignore errors in preview
                    if (process.env.DEBUG === 'true') {
                        console.error('[PREVIEW] Could not check incremental:', error.message);
                    }
                }
            }

            const result: PreviewResult = {
                totalFiles: originalTotalFiles || 0,
                totalSize: originalTotalSize || 0,
                filteredFiles: filteredBlobs.length || 0,
                filteredSize: filteredTotalSize || 0,
                pageCount: blobResult.pageCount || 1,
                fileTypes,
                largestFiles,
                blobs: filteredBlobs || []
            };

            if (incrementalInfo) {
                result.incrementalInfo = incrementalInfo;
            }

            return result;

        } catch (error: any) {
            throw new Error(`Failed to get container preview: ${error.message}`);
        }
    }

    /**
     * Format download confirmation message
     */
    static formatDownloadConfirmation(
        preview: PreviewResult,
        containerName: string,
        environment: string,
        downloadPath: string
    ): any {
        let message = `# 📥 Download Confirmation\n\n`;

        // PROMINENT DESTINATION DISPLAY
        message += `## 📁➡️💾 DOWNLOAD DESTINATION\n`;
        message += `**Files will be downloaded to:**\n`;
        message += `\`\`\`\n${downloadPath}\n\`\`\`\n\n`;

        // Show what will be downloaded
        message += `## 📦 Container Details\n`;
        message += `• **Environment**: ${environment}\n`;
        message += `• **Container**: ${containerName}\n\n`;

        // Show statistics (with defensive checks)
        message += `## 📊 Download Statistics\n`;
        const totalFiles = preview.totalFiles || 0;
        const totalSize = preview.totalSize || 0;
        const filteredFiles = preview.filteredFiles || 0;
        const filteredSize = preview.filteredSize || 0;

        // Show incremental info if available
        if (preview.incrementalInfo) {
            const inc = preview.incrementalInfo;
            message += `### ✨ Smart Incremental Download\n`;
            message += `• **Files already up-to-date**: ${inc.skippedFiles}\n`;
            message += `• **Files to download**: ${inc.toDownload}\n`;
            message += `• **Data already local**: ${this.formatBytes(inc.skippedSize)}\n`;
            message += `• **Data to download**: ${this.formatBytes(filteredSize - inc.skippedSize)}\n`;
            const savedPct = filteredSize > 0 ? Math.round((inc.skippedSize / filteredSize) * 100) : 0;
            message += `• **Bandwidth saved**: ${savedPct}%\n\n`;
        }

        // Check if we're downloading specific files
        if (filteredFiles === 1 && totalFiles > 1) {
            message += `• **Downloading Single File**: YES\n`;
            if (preview.blobs && preview.blobs[0]) {
                message += `• **File Name**: ${preview.blobs[0].name}\n`;
                message += `• **File Size**: ${this.formatBytes(preview.blobs[0].size || 0)}\n`;
            }
        } else if (filteredFiles < totalFiles) {
            message += `• **Filtered Selection**: ${filteredFiles.toLocaleString()} of ${totalFiles.toLocaleString()} files\n`;
            message += `• **Download Size**: ${this.formatBytes(filteredSize)}\n`;
        } else {
            message += `• **Total Files**: ${totalFiles.toLocaleString()}\n`;
            message += `• **Total Size**: ${this.formatBytes(totalSize)}\n`;
        }

        // Show pagination info
        if (preview.pageCount > 1) {
            message += `• **Pages Retrieved**: ${preview.pageCount} pages\n`;
        }

        if (filteredFiles < totalFiles) {
            message += `• **Filtered Files**: ${filteredFiles.toLocaleString()} (filter applied)\n`;
            message += `• **Filtered Size**: ${this.formatBytes(filteredSize)}\n`;
        }

        // Estimate download time - use filtered size if filter is applied
        const sizeForEstimate = filteredFiles < totalFiles ? filteredSize : totalSize;
        const estimatedSeconds = Math.ceil(sizeForEstimate / (5 * 1024 * 1024)); // Assume 5MB/s
        message += `• **Estimated Time**: ${this.formatDuration(estimatedSeconds)}\n\n`;

        // Show file type breakdown if available
        if (preview.fileTypes && Object.keys(preview.fileTypes).length > 0) {
            message += `## 📋 File Types (Top 10)\n`;
            const sortedTypes = Object.entries(preview.fileTypes)
                .sort((a, b) => {
                    const aCount = a[1].count || 0;
                    const bCount = b[1].count || 0;
                    return bCount - aCount;
                })
                .slice(0, 10);

            for (const [ext, info] of sortedTypes) {
                const count = info.count || 0;
                const size = info.size || 0;
                const percentage = totalFiles > 0 ? ((count / totalFiles) * 100).toFixed(1) : '0';
                message += `• **${ext}**: ${count.toLocaleString()} files (${percentage}%, ${this.formatBytes(size)})\n`;
            }

            if (Object.keys(preview.fileTypes).length > 10) {
                message += `• ... and ${Object.keys(preview.fileTypes).length - 10} more types\n`;
            }
            message += '\n';
        }

        // Show warnings for large downloads
        const oneGB = 1024 * 1024 * 1024;
        if (preview.totalSize > oneGB) {
            message += `## ⚠️ Large Download Warning\n`;
            message += `This download is **${this.formatBytes(preview.totalSize)}** and may take significant time and disk space.\n\n`;
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Format download result
     */
    static formatDownloadResult(
        result: DownloadResult,
        containerName: string,
        environment: string,
        targetPath: string
    ): any {
        const { downloadedFiles, failedFiles, totalSize } = result;

        let message = `✅ **Blob Download Complete**\n\n`;
        message += `📦➡️💾 **Downloaded From**: ${environment} / ${containerName}\n`;
        message += `💾 **Saved To**: \`${targetPath}\`\n\n`;

        message += `**Results**:\n`;
        message += `• Downloaded: ${downloadedFiles.length} files\n`;
        message += `• Total Size: ${this.formatBytes(totalSize)}\n`;

        if (failedFiles.length > 0) {
            message += `• Failed: ${failedFiles.length} files\n\n`;
            message += `**Failed Files**:\n`;
            failedFiles.slice(0, 5).forEach(f => {
                message += `  ❌ ${f.name}: ${f.error}\n`;
            });
            if (failedFiles.length > 5) {
                message += `  ... and ${failedFiles.length - 5} more\n`;
            }
        }

        message += `\n💡 **Tips**:\n`;
        message += `• Files are organized in the same structure as the container\n`;
        message += `• You can filter downloads with --filter "pattern"\n`;
        message += `• Set a custom path with --download-path /path/to/folder`;

        // DXP-66: Add structured data
        return ResponseBuilder.successWithStructuredData({
            containerName: containerName,
            environment: environment,
            downloadPath: targetPath,
            downloadedCount: downloadedFiles.length,
            failedCount: failedFiles.length,
            totalSizeBytes: totalSize,
            totalSize: this.formatBytes(totalSize),
            downloadedFiles: downloadedFiles,
            failedFiles: failedFiles
        }, message);
    }

    /**
     * Handle downloads from self-hosted Azure Storage accounts
     * This bypasses the DXP API and connects directly to customer Azure Storage
     */
    static async handleSelfHostedDownload(args: BlobDownloadArgs, targetPath: string): Promise<any> {
        try {
            OutputLogger.info('🔧 Configuring self-hosted Azure Storage connection...');

            // DXP-3: Check for previewOnly mode FIRST
            if (args.previewOnly === true) {
                const containerName = args.containerName || 'mysitemedia';
                let message = `# 📦 Blob Download Preview (Self-Hosted)\n\n`;
                message += `**Container**: ${containerName}\n`;
                message += `**Mode**: Self-hosted Azure Storage\n`;
                message += `**Download Path**: ${targetPath}\n\n`;

                if (args.filter) {
                    message += `**Filter**: ${args.filter}\n\n`;
                }

                message += `⚠️  **Preview Mode**: No download will occur.\n\n`;
                message += `**To download:**\n`;
                message += `\`\`\`\ndownload_blobs({ containerName: "${containerName}" })\n\`\`\`\n\n`;
                message += `**For background download:**\n`;
                message += `\`\`\`\ndownload_blobs({ containerName: "${containerName}", background: true })\n\`\`\``;

                return ResponseBuilder.success(message);
            }

            // Get storage configuration from args or environment
            const config = SelfHostedStorage.getStorageConfig(args);

            // Log masked config for debugging
            const maskedConfig = SelfHostedStorage.maskConfig(config);
            OutputLogger.info(`📋 Storage config: ${JSON.stringify(maskedConfig, null, 2)}`);

            // Ensure we have a container name
            const containerName = args.containerName || config.containerName;
            if (!containerName) {
                return ResponseBuilder.error(
                    'Container name is required for self-hosted downloads. ' +
                    'Provide via --containerName or AZURE_STORAGE_CONTAINER environment variable.'
                );
            }

            // Build the list URL for the container
            let sasUrl: string;
            try {
                if ((config as any).sasToken) {
                    // Use provided SAS token
                    sasUrl = SelfHostedStorage.buildListUrl({
                        ...config,
                        containerName
                    });
                } else if (config.accountKey) {
                    // Generate SAS token from account key
                    sasUrl = SelfHostedStorage.buildListUrl({
                        ...config,
                        containerName
                    });
                } else {
                    return ResponseBuilder.error(
                        'No authentication method available. ' +
                        'Provide a SAS token or connection string.'
                    );
                }
            } catch (error: any) {
                return ResponseBuilder.error(`Failed to build storage URL: ${error.message}`);
            }

            OutputLogger.info(`✅ Connected to self-hosted storage account: ${config.accountName}`);
            OutputLogger.info(`📦 Container: ${containerName}`);
            OutputLogger.info(`📂 Download path: ${targetPath}`);

            // Use existing download logic with the SAS URL
            const downloadKey = downloadManager.generateDownloadKey(
                args.project || 'self-hosted',
                containerName,
                'self-hosted',
                args.filter || 'all'
            );

            // Register the download
            downloadManager.registerDownload({
                projectName: downloadKey,
                containerName,
                environment: 'self-hosted',
                dateRange: args.filter || 'all',
                type: 'blobs',
                storageAccount: config.accountName,
                selfHosted: true
            });

            // Perform the download using existing logic
            const result = await this.downloadContainerContents(
                sasUrl,
                targetPath,
                args.filter,
                downloadKey,
                args.incremental,
                args.forceFullDownload,
                args.monitor === true  // DXP-3: Pass monitor flag
            );

            // Mark download as complete
            await downloadManager.completeDownload(downloadKey);

            // Build success message
            let message = '✅ Self-hosted blob download completed!\n\n';
            message += `📊 Download Summary:\n`;
            message += `• Storage Account: ${config.accountName}\n`;
            message += `• Container: ${containerName}\n`;
            message += `• Files Downloaded: ${result.downloadedFiles.length}\n`;
            message += `• Total Size: ${(result.totalSize / (1024 * 1024)).toFixed(2)} MB\n`;
            message += `• Location: ${targetPath}\n`;

            if (result.failedFiles.length > 0) {
                message += `\n⚠️ Failed Downloads: ${result.failedFiles.length} files\n`;
                result.failedFiles.slice(0, 5).forEach(f => {
                    message += `  • ${f.name}: ${f.error}\n`;
                });
            }

            return ResponseBuilder.success(message);

        } catch (error: any) {
            OutputLogger.error(`Self-hosted download error: ${error}`);
            return ErrorHandler.handleError(error, 'self-hosted blob download');
        }
    }

    /**
     * DXP-3: Handle background blob download - returns immediately with downloadId
     */
    static async handleBackgroundBlobDownload(args: BlobDownloadArgs, monitorProgress: boolean): Promise<any> {
        try {
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Background blob download requested');
                console.error('[DEBUG] Args:', JSON.stringify({
                    environment: args.environment,
                    containerName: args.containerName,
                    project: args.project,
                    projectName: args.projectName,
                    monitor: monitorProgress
                }));
            }

            // Get basic info for download key generation
            const environment = args.environment || 'Production';
            const containerName = args.containerName || 'blobs';
            const projectName = args.project || args.projectName || 'Unknown';

            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Project:', projectName);
                console.error('[DEBUG] Environment:', environment);
                console.error('[DEBUG] Container:', containerName);
            }

            // DXP-3: Get preview before starting download
            let preview: PreviewResult | null = null;
            try {
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Getting preview for background download...');
                }

                // Get project config
                const ConfigManager = require('../config-manager');
                const projectConfig = ConfigManager.getProject(args.project);
                if (!projectConfig) {
                    throw new Error(`Project not found: ${args.project}`);
                }

                // Generate SAS URL for the container
                const sasResponse = await StorageTools.handleGenerateStorageSasLink({
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId,
                    environment: environment,
                    containerName: containerName,
                    permissions: 'Read',
                    expiryHours: 2
                });

                const sasUrl = this.extractSasUrl(sasResponse);
                if (sasUrl) {
                    // Get container preview
                    preview = await this.getContainerPreview(sasUrl, args.filter, null, false);

                    if (process.env.DEBUG === 'true') {
                        console.error('[DEBUG] Preview obtained:', preview.filteredFiles, 'files,', preview.filteredSize, 'bytes');
                    }
                }
            } catch (previewError: any) {
                // Non-fatal: continue with download even if preview fails
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Preview failed (non-fatal):', previewError.message);
                }
                OutputLogger.warn(`⚠️  Could not get preview: ${previewError.message}`);
            }

            // Register download first to get the correct download key
            const downloadKey = downloadManager.registerDownload({
                projectName,
                containerName,
                environment,
                dateRange: 'all-time',
                type: 'blobs',
                totalFiles: preview ? preview.filteredFiles : undefined,
                totalSize: preview ? preview.filteredSize : undefined
            });

            // Check if this is a duplicate (registerDownload returns existing key if already running)
            const existingDownload = downloadManager.getDownload(downloadKey);
            if (existingDownload && existingDownload.startTime < Date.now() - 1000) {
                // Download was registered more than 1 second ago, so it's an existing download
                return ResponseBuilder.success(`📥 **Download Already Running**\n\n` +
                    `Download ID: \`${downloadKey}\`\n` +
                    `Status: ${existingDownload.status}\n` +
                    `Started: ${new Date(existingDownload.startTime).toLocaleString()}\n\n` +
                    `**Monitor progress:**\n` +
                    `\`\`\`\ndownload_status({ downloadId: "${downloadKey}", monitor: true })\n\`\`\``);
            }

            // Start download in background (don't await!)
            // Force skipConfirmation for background downloads
            const downloadArgs: BlobDownloadArgs = {
                ...args,
                background: false,  // Prevent recursion
                monitor: monitorProgress,
                previewOnly: false,  // DXP-185: Must explicitly set to false to prevent confirmation
                skipConfirmation: true,  // DXP-3: Background downloads must skip confirmation
                __backgroundDownload: true,  // Signal we're in background mode (prevent double registration)
                __downloadKey: downloadKey   // Pass existing download key
            };

            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Starting background runner for:', downloadKey);
                console.error('[DEBUG] Download args:', { skipConfirmation: true, __backgroundDownload: true });
            }

            this.runBlobDownloadInBackground(downloadKey, downloadArgs).catch(error => {
                OutputLogger.error(`Background blob download ${downloadKey} failed: ${error.message}`);
                downloadManager.failDownload(downloadKey, error.message);
            });

            // Return immediately with download info
            let message = `📥 **Background Blob Download Started**\n\n` +
                `Download ID: \`${downloadKey}\`\n` +
                `Project: ${projectName}\n` +
                `Environment: ${environment}\n` +
                `Container: ${containerName}\n`;

            // Add preview info if available
            if (preview) {
                const sizeFormatted = this.formatBytes(preview.filteredSize);
                const estimatedMinutes = Math.ceil(preview.filteredSize / (1024 * 1024 * 2)); // Assume ~2MB/min

                message += `\n📊 **Download Preview**:\n`;
                message += `• Files: ${preview.filteredFiles.toLocaleString()} files\n`;
                message += `• Total Size: ${sizeFormatted}\n`;
                message += `• Estimated Time: ~${estimatedMinutes} minute${estimatedMinutes !== 1 ? 's' : ''}\n`;
            }

            message += `\n⚠️  **Note**: Background downloads skip confirmation and start immediately.\n`;

            if (!preview) {
                message += `Could not fetch preview information (download will still proceed).\n`;
            }

            message += `\n**Monitor progress:**\n` +
                `\`\`\`\ndownload_status({ downloadId: "${downloadKey}", monitor: true })\n\`\`\`\n\n` +
                `This will poll every 10 seconds and show live progress updates until complete.\n\n` +
                `**Or check status manually:**\n` +
                `\`\`\`\ndownload_status({ downloadId: "${downloadKey}" })\n\`\`\``;

            return ResponseBuilder.success(message);

        } catch (error: any) {
            return ResponseBuilder.error(`Failed to start background blob download: ${error.message}`);
        }
    }

    /**
     * DXP-3: Run blob download in background (async, no await)
     */
    static async runBlobDownloadInBackground(downloadKey: string, args: BlobDownloadArgs): Promise<void> {
        try {
            OutputLogger.info(`📥 Starting background blob download: ${downloadKey}`);

            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Calling handleDownloadBlobs with background=false');
                console.error('[DEBUG] Args being passed:', {
                    background: args.background,
                    skipConfirmation: args.skipConfirmation,
                    __backgroundDownload: args.__backgroundDownload
                });
            }

            // Call the main download handler (with background=false to prevent recursion)
            const result = await this.handleDownloadBlobs(args);

            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] handleDownloadBlobs returned');
                console.error('[DEBUG] Result type:', typeof result);
                console.error('[DEBUG] Result structure:', result ? Object.keys(result) : 'null');
            }

            // DXP-178: Check if result is an error response (must check BEFORE marking complete)
            // Two error formats possible:
            // 1. ResponseBuilder.error(): { error: "message" }
            // 2. ErrorHandler.handleError(): { content: [...], isError: true }
            if (result && (result.error || result.isError)) {
                let errorMsg: string;

                if (result.error) {
                    // ResponseBuilder.error format
                    errorMsg = typeof result.error === 'string' ? result.error : JSON.stringify(result.error);
                } else if (result.isError && result.content) {
                    // ErrorHandler.handleError format - extract text from content array
                    errorMsg = result.content[0]?.text || 'Unknown error';
                } else {
                    errorMsg = JSON.stringify(result);
                }

                OutputLogger.error(`❌ Background download failed with error: ${errorMsg}`);
                downloadManager.failDownload(downloadKey, errorMsg);
                return;
            }

            // Check if result is a confirmation message instead of actual download
            if (result && result.result && result.result.content) {
                const content = result.result.content;
                if (Array.isArray(content) && content[0] && content[0].text) {
                    const text = content[0].text;
                    // If text contains confirmation keywords, it didn't actually download
                    if (text.includes('Download Confirmation Required') || text.includes('Please review')) {
                        const error = 'Background download returned confirmation instead of running. Check skipConfirmation setting.';
                        OutputLogger.error(`❌ ${error}`);
                        downloadManager.failDownload(downloadKey, error);
                        return;
                    }
                }
            }

            // Mark as complete in download manager (already imported at top)
            downloadManager.completeDownload(downloadKey, result);

            OutputLogger.info(`✅ Background blob download completed: ${downloadKey}`);
        } catch (error: any) {
            OutputLogger.error(`❌ Background blob download failed: ${downloadKey} - ${error}`);

            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Error stack:', error.stack);
            }

            // Extract meaningful error message
            const errorMsg = error.message || String(error);

            // Mark as failed (downloadManager already imported at top)
            downloadManager.failDownload(downloadKey, errorMsg);

            // Don't throw - background failures should not propagate
        }
    }
}

export default BlobDownloadTools;
