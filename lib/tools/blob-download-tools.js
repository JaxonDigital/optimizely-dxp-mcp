/**
 * Blob Download Tools - Download media/assets from Azure Storage
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { URL } = require('url');
const ProjectTools = require('./project-tools');
const StorageTools = require('./storage-tools');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');
const SettingsManager = require('../settings-manager');
const DownloadConfig = require('../download-config');
const PermissionChecker = require('./permission-checker');

class BlobDownloadTools {
    /**
     * Convert glob pattern to regex pattern
     * Handles common patterns like *.pdf, *.jpg, etc.
     */
    static globToRegex(glob) {
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
     * Main entry point for downloading blobs/media/assets
     */
    static async handleDownloadBlobs(args) {
        try {
            OutputLogger.info('🚀 Starting blob download process...');
            
            const { 
                environment, 
                project,
                containerName,
                downloadPath,
                filter,
                dryRun,
                previewOnly,
                // Legacy parameters for compatibility
                projectName,
                projectId,
                apiKey,
                apiSecret
            } = args;
            
            OutputLogger.info(`📋 Args: env=${environment}, project=${project || projectName}, container=${containerName}`);
            
            // Get project configuration
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
            
            // Check environment permissions if not explicitly specified
            let targetEnv;
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
                downloadPath,
                targetEnv
            );
            
            // Dry run preview
            if (dryRun) {
                return this.generateDryRunPreview(
                    projectConfig,
                    targetEnv,
                    containerName,
                    targetPath,
                    filter
                );
            }
            
            OutputLogger.info(`🔍 Discovering storage containers for ${projectConfig.name} in ${targetEnv}...`);
            
            // List available containers
            let containersResult;
            try {
                containersResult = await StorageTools.handleListStorageContainers({
                    apiKey: projectConfig.apiKey,
                    apiSecret: projectConfig.apiSecret,
                    projectId: projectConfig.projectId,
                    environment: targetEnv
                });
            } catch (error) {
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
                    OutputLogger.error('Container list result type:', typeof containersResult);
                    OutputLogger.error('Container list result keys:', containersResult ? Object.keys(containersResult) : 'null');
                    if (containersResult && typeof containersResult === 'object') {
                        OutputLogger.error('Container list raw content:', JSON.stringify(containersResult, null, 2));
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
                targetContainer = this.detectMediaContainer(containers);
                
                if (!targetContainer) {
                    // If multiple containers, ask user to specify
                    return this.formatContainerChoice(containers, targetEnv);
                }
                
                OutputLogger.info(`📦 Auto-selected container: ${targetContainer}`);
            }
            
            // Verify container exists
            if (!containers.includes(targetContainer)) {
                return ResponseBuilder.error(
                    `Container '${targetContainer}' not found. Available: ${containers.join(', ')}`
                );
            }
            
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
                OutputLogger.error('SAS Response type:', typeof sasResponse);
                OutputLogger.error('SAS Response keys:', sasResponse ? Object.keys(sasResponse) : 'null');
                
                // Check if it's an error response
                if (sasResponse && sasResponse.error) {
                    return ResponseBuilder.error(`Storage API Error: ${sasResponse.error.message || 'Unknown error'}`);
                }
                
                // Log the actual response for debugging
                if (sasResponse && sasResponse.result && sasResponse.result.content && sasResponse.result.content[0]) {
                    const content = sasResponse.result.content[0];
                    if (content && content.text) {
                        OutputLogger.error('Response text (first 500 chars):', content.text.substring(0, 500));
                        
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
            const skipConfirmation = args.skipConfirmation === true;
            
            // Debug log to see what's being passed
            if (process.env.DEBUG) {
                OutputLogger.info(`🔍 DEBUG: skipConfirmation=${args.skipConfirmation}, type=${typeof args.skipConfirmation}`);
                OutputLogger.info(`🔍 DEBUG: previewOnly=${args.previewOnly}, type=${typeof args.previewOnly}`);
            }
            
            if (!skipConfirmation) {
                OutputLogger.info(`👍 OK, let me generate a preview for you...`);
                OutputLogger.info(`📊 Analyzing container contents...`);
                const previewResult = await this.getContainerPreview(sasUrl, filter);
                
                // Show download confirmation with all details
                const confirmationMessage = this.formatDownloadConfirmation(
                    previewResult, 
                    targetContainer, 
                    targetEnv, 
                    targetPath
                );
                
                // If preview only mode, return the preview
                if (previewOnly) {
                    return confirmationMessage;
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
                            OutputLogger.error('DEBUG: Unexpected confirmationMessage structure:', JSON.stringify(confirmationMessage).substring(0, 200));
                        }
                    }
                } catch (error) {
                    if (process.env.DEBUG) {
                        OutputLogger.error('DEBUG: Error extracting text:', error.message);
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
                
                return ResponseBuilder.success(fullMessage);
            }
            
            OutputLogger.info(`📥 Starting download from ${targetContainer} to ${targetPath}...`);
            
            // Start the download process
            const downloadResult = await this.downloadContainerContents(
                sasUrl,
                targetPath,
                filter
            );
            
            // Format success response
            return this.formatDownloadResult(
                downloadResult,
                targetContainer,
                targetEnv,
                targetPath
            );
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'download-blobs', args);
        }
    }
    
    /**
     * Get project configuration
     */
    static async getProjectConfig(project, args) {
        // If we have inline credentials, use them
        if (args.projectId && args.apiKey && args.apiSecret) {
            // Try to get the project name from ProjectTools if not provided
            let projectName = project;
            if (!projectName) {
                try {
                    // Try to find the project by ID
                    const projects = ProjectTools.getConfiguredProjects();
                    const matchingProject = projects.find(p => p.projectId === args.projectId);
                    if (matchingProject) {
                        projectName = matchingProject.name;
                    } else if (projects && projects.length > 0 && projects[0]) {
                        // Use first project as fallback
                        projectName = projects[0].name;
                    }
                } catch (e) {
                    // If all else fails, use a generic name
                    projectName = 'optimizely-blobs';
                }
            }
            
            return {
                name: projectName || 'optimizely-blobs',
                projectId: args.projectId,
                apiKey: args.apiKey,
                apiSecret: args.apiSecret
            };
        }
        
        // Otherwise get from ProjectTools
        const projectConfig = await ProjectTools.getProjectConfig(project);
        return projectConfig;
    }
    
    /**
     * Parse environment aliases
     */
    static parseEnvironment(env) {
        const envLower = env.toLowerCase();
        const aliases = {
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
     * Determine the best download path for blobs
     */
    static async determineDownloadPath(specifiedPath, projectName, environment) {
        // Use the new DownloadConfig validation method
        const DownloadConfig = require('../download-config');
        const validated = await DownloadConfig.getValidatedDownloadPath('blobs', projectName, specifiedPath, environment);
        
        if (!validated.valid) {
            throw new Error(`Invalid download path: ${validated.error}`);
        }
        
        if (validated.created) {
            OutputLogger.info(`📁 Created download directory: ${validated.path}`);
        }
        
    }
    
    /**
     * Parse container list from storage tools result
     */
    static parseContainerList(result) {
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
                    OutputLogger.error('Error in container list response:', result.error);
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
            
            // Extract container names - try multiple patterns
            const containers = [];
            
            // Pattern 1: "1. 📦 containername" or "• **containername**"
            let matches = text.match(/(?:\d+\.\s*📦\s*|•\s*\*\*?)([^\n\r*]+)(?:\*\*?)?/g);
            
            if (matches && matches.length > 0) {
                for (const match of matches) {
                    let containerName = match
                        .replace(/^\d+\.\s*📦\s*/, '')  // Remove "1. 📦 "
                        .replace(/^•\s*\*\*?/, '')      // Remove "• **"
                        .replace(/\*\*?$/, '')          // Remove trailing "**"
                        .trim();
                    
                    // Skip invalid entries
                    if (containerName && 
                        containerName.length > 2 && 
                        !containerName.includes('Available Containers') &&
                        !containerName.includes('Built by Jaxon') &&
                        !containerName.includes('Tips:')) {
                        containers.push(containerName);
                    }
                }
            }
            
            // Pattern 2: Fallback - just look for container-like names in lines
            if (containers.length === 0) {
                const lines = text.split(/[\n\r]+/);
                for (const line of lines) {
                    const trimmed = line.trim();
                    // Look for lines that look like container names
                    if (trimmed && 
                        trimmed.length > 3 && 
                        !trimmed.includes('*') && 
                        !trimmed.includes('Available') && 
                        !trimmed.includes('Tips') &&
                        !trimmed.includes('Built by') &&
                        !trimmed.match(/^#/) &&  // Skip headers
                        trimmed.match(/^[a-zA-Z0-9-_]+$/)) {  // Only alphanumeric container names
                        containers.push(trimmed);
                    }
                }
            }
            
            return containers;
        } catch (error) {
            OutputLogger.error('Failed to parse container list:', error.message);
            return [];
        }
    }
    
    /**
     * Auto-detect the media/assets container
     */
    static detectMediaContainer(containers) {
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
    static formatContainerChoice(containers, environment) {
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
    static extractSasUrl(result) {
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
        } catch (error) {
            OutputLogger.error('Failed to extract SAS URL:', error.message);
            return null;
        }
    }
    
    /**
     * Download all contents from a container using SAS URL
     */
    static async downloadContainerContents(sasUrl, targetPath, filter) {
        const downloadedFiles = [];
        const failedFiles = [];
        let totalSize = 0;
        
        try {
            // Ensure target directory exists
            await fs.mkdir(targetPath, { recursive: true });
            
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
                const regexPattern = this.globToRegex(filter);
                const filterRegex = new RegExp(regexPattern, 'i');
                blobsToDownload = blobs.filter(blob => filterRegex.test(blob.name));
                OutputLogger.info(`Filtered to ${blobsToDownload.length} blobs matching: ${filter}`);
            }
            
            // Calculate total size and show preview
            const totalBlobSize = blobsToDownload.reduce((sum, blob) => sum + (blob.size || 0), 0);
            const avgSpeedBytesPerSec = 5 * 1024 * 1024; // Assume 5MB/s average download speed
            const estimatedSeconds = totalBlobSize / avgSpeedBytesPerSec;
            
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
            
            // Track progress
            let downloadedSize = 0;
            const startTime = Date.now();
            
            // Download each blob
            for (let i = 0; i < blobsToDownload.length; i++) {
                const blob = blobsToDownload[i];
                const progressNum = i + 1;
                const percentage = Math.round((progressNum / blobsToDownload.length) * 100);
                
                try {
                    // Calculate ETA
                    const elapsedMs = Date.now() - startTime;
                    const avgTimePerFile = elapsedMs / progressNum;
                    const remainingFiles = blobsToDownload.length - progressNum;
                    const etaMs = remainingFiles * avgTimePerFile;
                    
                    // Show detailed progress
                    OutputLogger.progress(
                        `[${progressNum}/${blobsToDownload.length}] ${percentage}% | ` +
                        `${this.formatBytes(downloadedSize)}/${this.formatBytes(totalBlobSize)} | ` +
                        `ETA: ${this.formatDuration(etaMs / 1000)} | ` +
                        `Downloading: ${blob.name}`
                    );
                    
                    const localPath = path.join(targetPath, blob.name);
                    const blobUrl = `${containerUrl}/${blob.name}${sasToken}`;
                    
                    // Ensure parent directory exists
                    await fs.mkdir(path.dirname(localPath), { recursive: true });
                    
                    // Download the blob
                    const size = await this.downloadBlob(blobUrl, localPath);
                    
                    downloadedFiles.push(blob.name);
                    totalSize += size;
                    downloadedSize += size;
                    
                } catch (error) {
                    OutputLogger.error(`Failed to download ${blob.name}: ${error.message}`);
                    failedFiles.push({ name: blob.name, error: error.message });
                }
            }
            
            OutputLogger.success(`✅ Downloaded ${downloadedFiles.length} files (${this.formatBytes(totalSize)})`);
            
            if (failedFiles.length > 0) {
                OutputLogger.warn(`⚠️ Failed to download ${failedFiles.length} files`);
            }
            
        } catch (error) {
            OutputLogger.error(`Container download failed: ${error.message}`);
            throw error;
        }
        
        return { downloadedFiles, failedFiles, totalSize };
    }
    
    /**
     * List all blobs in a container with pagination support
     */
    static async listBlobsInContainer(containerUrl, sasToken) {
        const allBlobs = [];
        let marker = null;
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
    static async listBlobsPage(containerUrl, sasToken, marker = null) {
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
    static parseBlobListXmlWithMarker(xml) {
        const blobs = [];
        
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
     * Parse blob list XML response (legacy method for compatibility)
     */
    static parseBlobListXml(xml) {
        const result = this.parseBlobListXmlWithMarker(xml);
        return result.blobs;
    }
    
    /**
     * Download a single blob
     */
    static async downloadBlob(blobUrl, localPath) {
        return new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(localPath);
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
                    require('fs').unlinkSync(localPath);
                    reject(error);
                });
            }).on('error', reject);
        });
    }
    
    /**
     * Format bytes to human readable
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * Format duration to human readable
     */
    static formatDuration(seconds) {
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
    static async getContainerPreview(sasUrl, filter) {
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
                const filterRegex = new RegExp(regexPattern, 'i');
                filteredBlobs = blobs.filter(blob => filterRegex.test(blob.name));
            }
            
            // Calculate filtered statistics
            const filteredTotalSize = filteredBlobs.reduce((sum, blob) => sum + (blob.size || 0), 0);
            const fileTypes = {};
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
            
            return {
                totalFiles: originalTotalFiles || 0,
                totalSize: originalTotalSize || 0,
                filteredFiles: filteredBlobs.length || 0,
                filteredSize: filteredTotalSize || 0,
                pageCount: blobResult.pageCount || 1,
                fileTypes,
                largestFiles,
                blobs: filteredBlobs || []
            };
            
        } catch (error) {
            throw new Error(`Failed to get container preview: ${error.message}`);
        }
    }
    
    /**
     * Format download confirmation message
     */
    static formatDownloadConfirmation(preview, containerName, environment, downloadPath) {
        let message = `# 📥 Download Confirmation\n\n`;
        
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
        
        message += `• **Total Files**: ${totalFiles.toLocaleString()}\n`;
        message += `• **Total Size**: ${this.formatBytes(totalSize)}\n`;
        
        // Show pagination info
        if (preview.pageCount > 1) {
            message += `• **Pages Retrieved**: ${preview.pageCount} pages\n`;
        }
        
        if (filteredFiles < totalFiles) {
            message += `• **Filtered Files**: ${filteredFiles.toLocaleString()} (filter applied)\n`;
            message += `• **Filtered Size**: ${this.formatBytes(filteredSize)}\n`;
        }
        
        // Estimate download time
        const estimatedSeconds = Math.ceil(totalSize / (5 * 1024 * 1024)); // Assume 5MB/s
        message += `• **Estimated Time**: ${this.formatDuration(estimatedSeconds)}\n\n`;
        
        // Show destination
        message += `## 📁 Destination Folder\n`;
        message += `• **Path**: \`${downloadPath}\`\n\n`;
        
        // Show file type breakdown if available
        if (preview.fileTypes && Object.keys(preview.fileTypes).length > 0) {
            message += `## 📋 File Types (Top 10)\n`;
            const sortedTypes = Object.entries(preview.fileTypes)
                .sort((a, b) => {
                    // Handle both old format (number) and new format (object)
                    const aCount = typeof a[1] === 'number' ? a[1] : (a[1].count || 0);
                    const bCount = typeof b[1] === 'number' ? b[1] : (b[1].count || 0);
                    return bCount - aCount;
                })
                .slice(0, 10);
            
            for (const [ext, info] of sortedTypes) {
                // Handle both old format (number) and new format (object)
                const count = typeof info === 'number' ? info : (info.count || 0);
                const size = typeof info === 'object' ? (info.size || 0) : 0;
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
     * Format preview result for display
     */
    static formatPreviewResult(preview, containerName, environment, targetPath) {
        const avgSpeedBytesPerSec = 5 * 1024 * 1024; // Assume 5MB/s
        const estimatedSeconds = preview.totalSize / avgSpeedBytesPerSec;
        
        let message = `📊 **Blob Container Preview**\n\n`;
        message += `**Container**: ${containerName}\n`;
        message += `**Environment**: ${environment}\n`;
        message += `**Target Path**: ${targetPath}\n\n`;
        
        message += `📈 **Statistics**\n`;
        const totalFiles = preview.totalFiles || 0;
        const totalSize = preview.totalSize || 0;
        message += `• Total files: ${totalFiles.toLocaleString()}\n`;
        message += `• Total size: ${this.formatBytes(totalSize)}\n`;
        message += `• Estimated download time: ${this.formatDuration(estimatedSeconds)}\n\n`;
        
        // File type breakdown
        if (Object.keys(preview.fileTypes).length > 0) {
            message += `📁 **File Types**\n`;
            const sortedTypes = Object.entries(preview.fileTypes)
                .sort((a, b) => {
                    // Handle both old format (number) and new format (object)
                    const aCount = typeof a[1] === 'number' ? a[1] : (a[1].count || 0);
                    const bCount = typeof b[1] === 'number' ? b[1] : (b[1].count || 0);
                    return bCount - aCount;
                })
                .slice(0, 10);
            
            sortedTypes.forEach(([ext, info]) => {
                // Handle both old format (number) and new format (object)
                const count = typeof info === 'number' ? info : (info.count || 0);
                message += `• ${ext}: ${count.toLocaleString()} files\n`;
            });
            
            if (Object.keys(preview.fileTypes).length > 10) {
                message += `• ... and ${Object.keys(preview.fileTypes).length - 10} more types\n`;
            }
            message += '\n';
        }
        
        // Largest files
        if (preview.largestFiles.length > 0) {
            message += `📦 **Largest Files**\n`;
            preview.largestFiles.forEach(file => {
                message += `• ${file.name} (${this.formatBytes(file.size || 0)})\n`;
            });
            message += '\n';
        }
        
        // Add recommendation for large downloads
        const oneGB = 1024 * 1024 * 1024;
        if (preview.totalSize > oneGB) {
            message += `⚠️  **Large Download Warning**\n`;
            message += `This download is ${this.formatBytes(preview.totalSize)}. Consider:\n`;
            message += `• Using filters to download specific file types\n`;
            message += `• Running the download during off-peak hours\n`;
            message += `• Ensuring you have sufficient disk space\n\n`;
        }
        
        message += `💡 **Next Steps**\n`;
        message += `• Run without \`previewOnly: true\` to start the download\n`;
        message += `• Add \`filter: "*.ext"\` to download specific file types\n`;
        message += `• Use \`downloadPath: "/custom/path"\` to specify download location`;
        
        return ResponseBuilder.success(message);
    }
    
    /**
     * Generate dry run preview
     */
    static generateDryRunPreview(projectConfig, environment, containerName, targetPath, filter) {
        let preview = `🧪 **Blob Download Preview**\n\n`;
        preview += `**Project**: ${projectConfig.name}\n`;
        preview += `**Environment**: ${environment}\n`;
        
        if (containerName) {
            preview += `**Container**: ${containerName}\n`;
        } else {
            preview += `**Container**: Will auto-detect media container\n`;
        }
        
        preview += `**Download Path**: ${targetPath}\n`;
        
        if (filter) {
            preview += `**Filter**: ${filter}\n`;
        }
        
        preview += `\n**What will happen**:\n`;
        preview += `1. List storage containers in ${environment}\n`;
        preview += `2. Generate SAS link for container access\n`;
        preview += `3. Download all blobs to local directory\n`;
        preview += `4. Preserve folder structure from container\n`;
        
        preview += `\n**To execute**: Run the same command without --dry-run`;
        
        return ResponseBuilder.success(preview);
    }
    
    /**
     * Format download result
     */
    static formatDownloadResult(result, containerName, environment, targetPath) {
        const { downloadedFiles, failedFiles, totalSize } = result;
        
        let message = `✅ **Blob Download Complete**\n\n`;
        message += `**Container**: ${containerName}\n`;
        message += `**Environment**: ${environment}\n`;
        message += `**Location**: ${targetPath}\n\n`;
        
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
        
        return ResponseBuilder.success(message);
    }
}

module.exports = BlobDownloadTools;