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

class BlobDownloadTools {
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
            
            // Default to Production environment
            const targetEnv = this.parseEnvironment(environment || 'production');
            
            // Determine download location
            const targetPath = await this.determineDownloadPath(
                downloadPath,
                projectConfig.name,
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
            
            console.log('DEBUG: About to call handleListStorageContainers...');
            // List available containers
            const containersResult = await StorageTools.handleListStorageContainers({
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                projectId: projectConfig.projectId,
                environment: targetEnv
            });
            
            // Parse container list
            const containers = this.parseContainerList(containersResult);
            
            OutputLogger.info(`📋 Found ${containers.length} containers: ${containers.join(', ')}`);
            
            if (!containers || containers.length === 0) {
                OutputLogger.error('Container list result type:', typeof containersResult);
                OutputLogger.error('Container list result keys:', containersResult ? Object.keys(containersResult) : 'null');
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
                if (sasResponse && sasResponse.result && sasResponse.result.content) {
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
            return {
                name: project || 'Unknown',
                projectId: args.projectId,
                apiKey: args.apiKey,
                apiSecret: args.apiSecret
            };
        }
        
        // Otherwise get from ProjectTools
        return await ProjectTools.getProjectConfig(project);
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
        if (specifiedPath) {
            // User specified a path
            return path.resolve(specifiedPath);
        }
        
        // Try to detect existing blob folders
        const currentDir = process.cwd();
        const projectNameLower = projectName.toLowerCase();
        
        // Common blob folder patterns to check
        const patterns = [
            path.join(currentDir, '..', 'blobs', projectNameLower),
            path.join(currentDir, '..', 'media', projectNameLower),
            path.join(currentDir, '..', 'assets', projectNameLower),
            path.join(currentDir, 'blobs'),
            path.join(currentDir, 'media'),
            path.join(currentDir, 'assets'),
            path.join(currentDir, 'App_Data', 'blobs'),
            path.join(currentDir, 'wwwroot', 'media')
        ];
        
        // Check if any of these exist
        for (const pattern of patterns) {
            try {
                const stats = await fs.stat(pattern);
                if (stats.isDirectory()) {
                    OutputLogger.info(`📁 Found existing blob directory: ${pattern}`);
                    return pattern;
                }
            } catch (error) {
                // Directory doesn't exist, continue checking
            }
        }
        
        // If in a project directory that matches the project name, use ../blobs/projectname
        if (currentDir.toLowerCase().includes(projectNameLower)) {
            const blobPath = path.join(currentDir, '..', 'blobs', projectNameLower);
            OutputLogger.info(`📁 Will create blob directory: ${blobPath}`);
            return blobPath;
        }
        
        // Default to configured download path + /blobs/projectname
        const configuredPath = await SettingsManager.getDownloadPath();
        const defaultPath = path.join(configuredPath, 'blobs', projectNameLower, environment.toLowerCase());
        OutputLogger.info(`📁 Using default blob path: ${defaultPath}`);
        return defaultPath;
    }
    
    /**
     * Parse container list from storage tools result
     */
    static parseContainerList(result) {
        try {
            let text = '';
            
            // Handle ResponseBuilder format
            if (typeof result === 'object' && result !== null) {
                // Check for ResponseBuilder.success format
                if (result.result && result.result.content && Array.isArray(result.result.content)) {
                    const content = result.result.content[0];
                    if (content && content.text) {
                        text = content.text;
                    }
                } else if (result.error) {
                    OutputLogger.error('Error in container list response:', result.error);
                    return [];
                } else {
                    text = JSON.stringify(result);
                }
            } else if (typeof result === 'string') {
                text = result;
            }
            
            // Extract container names from numbered list
            const containerMatches = text.match(/\d+\.\s*📦\s*([^\n]+)/g);
            
            if (containerMatches) {
                return containerMatches.map(match => {
                    const containerName = match.replace(/^\d+\.\s*📦\s*/, '').trim();
                    return containerName;
                });
            }
            
            return [];
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
        if (containers.length === 1) {
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
                if (result.result && result.result.content && Array.isArray(result.result.content)) {
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
            
            OutputLogger.info('📋 Listing blobs in container...');
            
            // List blobs in the container
            const blobs = await this.listBlobsInContainer(containerUrl, sasToken);
            
            if (blobs.length === 0) {
                OutputLogger.warning('No blobs found in container');
                return { downloadedFiles, failedFiles, totalSize };
            }
            
            OutputLogger.info(`Found ${blobs.length} blobs to download`);
            
            // Apply filter if specified
            let blobsToDownload = blobs;
            if (filter) {
                const filterRegex = new RegExp(filter, 'i');
                blobsToDownload = blobs.filter(blob => filterRegex.test(blob.name));
                OutputLogger.info(`Filtered to ${blobsToDownload.length} blobs matching: ${filter}`);
            }
            
            // Download each blob
            for (let i = 0; i < blobsToDownload.length; i++) {
                const blob = blobsToDownload[i];
                const progress = `[${i + 1}/${blobsToDownload.length}]`;
                
                try {
                    OutputLogger.progress(`${progress} Downloading: ${blob.name}`);
                    
                    const localPath = path.join(targetPath, blob.name);
                    const blobUrl = `${containerUrl}/${blob.name}${sasToken}`;
                    
                    // Ensure parent directory exists
                    await fs.mkdir(path.dirname(localPath), { recursive: true });
                    
                    // Download the blob
                    const size = await this.downloadBlob(blobUrl, localPath);
                    
                    downloadedFiles.push(blob.name);
                    totalSize += size;
                    
                } catch (error) {
                    OutputLogger.error(`Failed to download ${blob.name}: ${error.message}`);
                    failedFiles.push({ name: blob.name, error: error.message });
                }
            }
            
            OutputLogger.success(`✅ Downloaded ${downloadedFiles.length} files (${this.formatBytes(totalSize)})`);
            
            if (failedFiles.length > 0) {
                OutputLogger.warning(`⚠️ Failed to download ${failedFiles.length} files`);
            }
            
        } catch (error) {
            OutputLogger.error(`Container download failed: ${error.message}`);
            throw error;
        }
        
        return { downloadedFiles, failedFiles, totalSize };
    }
    
    /**
     * List all blobs in a container
     */
    static async listBlobsInContainer(containerUrl, sasToken) {
        return new Promise((resolve, reject) => {
            const listUrl = `${containerUrl}?restype=container&comp=list${sasToken.replace('?', '&')}`;
            
            https.get(listUrl, (response) => {
                let data = '';
                
                response.on('data', chunk => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        // Parse XML response
                        const blobs = this.parseBlobListXml(data);
                        resolve(blobs);
                    } catch (error) {
                        reject(error);
                    }
                });
                
                response.on('error', reject);
            });
        });
    }
    
    /**
     * Parse blob list XML response
     */
    static parseBlobListXml(xml) {
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
        
        return blobs;
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
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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