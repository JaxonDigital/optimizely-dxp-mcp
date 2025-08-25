/**
 * Log Download Tools Module
 * Handles downloading Application Insights logs from Azure Storage
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const https = require('https');
const url = require('url');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');
const StorageTools = require('./storage-tools');
const ProjectTools = require('./project-tools');
const SettingsManager = require('../settings-manager');

class LogDownloadTools {
    // Standard log container names in Optimizely DXP
    static LOG_CONTAINERS = {
        'application': 'azure-application-logs',
        'web': 'azure-web-logs',
        'cloudflare': 'cloudflarelogpush'  // Beta feature, may not be available
    };
    
    /**
     * Handle download logs command
     */
    static async handleDownloadLogs(args) {
        try {
            // Default to production environment for logs
            if (!args.environment) {
                args.environment = 'Production';
            }
            
            // Default to application logs
            const logType = args.logType || 'application';
            const containerName = args.containerName || this.LOG_CONTAINERS[logType];
            
            if (!containerName) {
                return ResponseBuilder.error(`Unknown log type: ${logType}. Use 'application', 'web', or specify containerName directly.`);
            }
            
            // Resolve project configuration
            const projectConfig = await ProjectTools.resolveProject(args);
            if (!projectConfig.apiKey || !projectConfig.apiSecret || !projectConfig.projectId) {
                return ResponseBuilder.invalidParams('Missing required project configuration (apiKey, apiSecret, or projectId)');
            }
            
            // Apply resolved config to args
            Object.assign(args, projectConfig);
            
            OutputLogger.info(`📊 Downloading ${logType} logs from ${args.environment} environment...`);
            OutputLogger.info(`📁 Container: ${containerName}`);
            
            // Check if container exists
            const containersResult = await StorageTools.handleListStorageContainers(args);
            const containers = this.extractContainerList(containersResult);
            
            if (!containers.includes(containerName)) {
                return ResponseBuilder.error(`Log container '${containerName}' not found in ${args.environment} environment.\n\nAvailable containers:\n${containers.map(c => `• ${c}`).join('\n')}`);
            }
            
            // Generate SAS link for the log container
            OutputLogger.info('🔑 Generating SAS link for log container...');
            const sasArgs = {
                ...args,
                containerName: containerName,
                permissions: 'Read',
                expiryHours: 2  // Short-lived for security
            };
            
            const sasResponse = await StorageTools.handleGenerateStorageSasLink(sasArgs);
            const sasUrl = this.extractSasUrl(sasResponse);
            
            if (!sasUrl) {
                return ResponseBuilder.error('Failed to generate SAS link for log container');
            }
            
            // Determine download path
            const downloadPath = await this.determineLogDownloadPath(args, projectConfig.projectName);
            OutputLogger.info(`📂 Download path: ${downloadPath}`);
            
            // Create download directory
            await fs.mkdir(downloadPath, { recursive: true });
            
            // List and download logs
            OutputLogger.info('📋 Listing available log files...');
            const logs = await this.listLogs(sasUrl, args.dateFilter);
            
            if (logs.length === 0) {
                return ResponseBuilder.success(`No log files found in ${containerName} container${args.dateFilter ? ` for date filter: ${args.dateFilter}` : ''}`);
            }
            
            OutputLogger.info(`📥 Found ${logs.length} log files to download`);
            
            // Download logs with progress tracking
            let downloadedCount = 0;
            let failedCount = 0;
            let totalSize = 0;
            
            for (const log of logs) {
                try {
                    const localPath = path.join(downloadPath, log.name);
                    const localDir = path.dirname(localPath);
                    
                    // Create subdirectories if needed
                    await fs.mkdir(localDir, { recursive: true });
                    
                    // Download the log file
                    const size = await this.downloadLogFile(log.url, localPath, log.name);
                    downloadedCount++;
                    totalSize += size;
                    
                    OutputLogger.success(`✅ Downloaded: ${log.name} (${this.formatBytes(size)})`);
                } catch (error) {
                    failedCount++;
                    OutputLogger.error(`❌ Failed to download: ${log.name} - ${error.message}`);
                }
            }
            
            // Generate summary
            let response = `📊 **Log Download Complete**\n\n`;
            response += `**Environment:** ${args.environment}\n`;
            response += `**Log Type:** ${logType} (${containerName})\n`;
            response += `**Download Path:** ${downloadPath}\n\n`;
            response += `**Results:**\n`;
            response += `• Downloaded: ${downloadedCount} files\n`;
            response += `• Failed: ${failedCount} files\n`;
            response += `• Total Size: ${this.formatBytes(totalSize)}\n\n`;
            
            if (args.dateFilter) {
                response += `**Date Filter:** ${args.dateFilter}\n\n`;
            }
            
            response += `💡 **Tips:**\n`;
            response += `• Application logs contain detailed app diagnostics\n`;
            response += `• Web logs contain IIS/server access logs\n`;
            response += `• Logs are retained for 90 days by default\n`;
            response += `• Use date filters to download specific periods (e.g., "2025/08/24")\n`;
            
            return ResponseBuilder.success(response);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'download-logs', args);
        }
    }
    
    /**
     * Determine the download path for log files
     */
    static async determineLogDownloadPath(args, projectName) {
        if (args.downloadPath) {
            // User specified path
            return args.downloadPath;
        }
        
        // Smart path detection for logs
        const possiblePaths = [
            `/Users/bgerby/Documents/dev/logs/${projectName}`,
            `./logs/${projectName}`,
            `~/Downloads/optimizely-logs/${projectName}`,
            `./optimizely-logs/${projectName}`
        ];
        
        // Check if any of these exist
        for (const testPath of possiblePaths) {
            const expandedPath = testPath.startsWith('~') 
                ? path.join(os.homedir(), testPath.slice(1))
                : path.resolve(testPath);
            
            try {
                const parentDir = path.dirname(expandedPath);
                await fs.access(parentDir);
                return expandedPath;
            } catch {
                // Directory doesn't exist, continue
            }
        }
        
        // Default to settings or current directory
        const settingsPath = await SettingsManager.getDownloadPath();
        return path.join(settingsPath, 'logs', projectName || 'unknown');
    }
    
    /**
     * List logs in the container with optional date filtering
     */
    static async listLogs(sasUrl, dateFilter) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(sasUrl);
            const listUrl = `${parsedUrl.origin}${parsedUrl.pathname}?restype=container&comp=list${parsedUrl.search.replace('?', '&')}`;
            
            https.get(listUrl, (response) => {
                let data = '';
                
                response.on('data', chunk => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        const logs = this.parseLogListXml(data, sasUrl, dateFilter);
                        resolve(logs);
                    } catch (error) {
                        reject(error);
                    }
                });
                
                response.on('error', reject);
            });
        });
    }
    
    /**
     * Parse XML response from Azure Storage listing
     */
    static parseLogListXml(xml, sasUrl, dateFilter) {
        const logs = [];
        const baseUrl = sasUrl.split('?')[0];
        const sasToken = sasUrl.split('?')[1];
        
        // Match all log entries
        const logMatches = xml.matchAll(/<Blob>[\s\S]*?<\/Blob>/g);
        
        for (const match of logMatches) {
            const blobXml = match[0];
            
            // Extract log name
            const nameMatch = blobXml.match(/<Name>(.*?)<\/Name>/);
            if (!nameMatch) continue;
            
            const name = nameMatch[1];
            
            // Apply date filter if specified
            if (dateFilter) {
                // Date filter can be: YYYY/MM/DD, YYYY-MM-DD, or partial like YYYY/MM
                const filterPattern = dateFilter.replace(/-/g, '/');
                if (!name.includes(filterPattern)) {
                    continue;
                }
            }
            
            // Filter for actual log files (skip directories)
            if (!name.endsWith('.log') && !name.endsWith('.txt') && !name.endsWith('.json')) {
                continue;
            }
            
            // Extract size
            const sizeMatch = blobXml.match(/<Content-Length>(.*?)<\/Content-Length>/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
            
            // Extract last modified
            const modifiedMatch = blobXml.match(/<Last-Modified>(.*?)<\/Last-Modified>/);
            const lastModified = modifiedMatch ? modifiedMatch[1] : null;
            
            logs.push({
                name: name,
                url: `${baseUrl}/${name}?${sasToken}`,
                size: size,
                lastModified: lastModified
            });
        }
        
        // Sort by name (which includes date/time in the path)
        logs.sort((a, b) => b.name.localeCompare(a.name));
        
        return logs;
    }
    
    /**
     * Download a single log file
     */
    static async downloadLogFile(fileUrl, localPath, displayName) {
        return new Promise((resolve, reject) => {
            https.get(fileUrl, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }
                
                const fileStream = require('fs').createWriteStream(localPath);
                let downloadedSize = 0;
                
                response.on('data', chunk => {
                    downloadedSize += chunk.length;
                });
                
                response.pipe(fileStream);
                
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve(downloadedSize);
                });
                
                fileStream.on('error', (error) => {
                    fs.unlink(localPath).catch(() => {});
                    reject(error);
                });
            }).on('error', reject);
        });
    }
    
    /**
     * Extract container list from storage tools response
     */
    static extractContainerList(result) {
        let text = '';
        
        // Handle ResponseBuilder format
        if (typeof result === 'object' && result !== null) {
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
        
        if (!text) {
            return [];
        }
        
        const containers = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            // Look for container names in the format: "1. 📦 container-name"
            const match = line.match(/^\d+\.\s*📦\s*(.+)$/);
            if (match) {
                containers.push(match[1].trim());
            }
        }
        
        return containers;
    }
    
    /**
     * Extract SAS URL from storage tools response
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
     * Format bytes to human readable
     */
    static formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

module.exports = LogDownloadTools;