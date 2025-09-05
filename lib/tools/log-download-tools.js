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
const DownloadConfig = require('../download-config');
const downloadManager = require('../download-manager');
const ManifestManager = require('../manifest-manager');

class LogDownloadTools {
    // Standard log container names in Optimizely DXP
    // Note: Some environments use App Service Insights containers with different names
    static LOG_CONTAINERS = {
        'application': 'azure-application-logs',
        'web': 'azure-web-logs',
        'cloudflare': 'cloudflarelogpush'  // Beta feature, may not be available
    };
    
    // Alternative App Service Insights container names
    static APP_SERVICE_CONTAINERS = {
        'application': 'insights-logs-appserviceconsolelogs',
        'web': 'insights-logs-appservicehttplogs'
    };
    
    // Additional alternative container names (commonly found in Production)
    static ALTERNATIVE_CONTAINERS = {
        'application': [
            'azure-application-logs',
            'applicationlogs',
            'app-logs',
            'consolelogs'
        ],
        'web': [
            'azure-web-logs',
            'weblogs',
            'httplogs',
            'web-logs'
        ]
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

            // Resolve project configuration early for overlap detection
            const resolved = ProjectTools.resolveCredentials(args);
            if (!resolved.success || !resolved.credentials) {
                return ResponseBuilder.invalidParams('Missing required project configuration (apiKey, apiSecret, or projectId)');
            }
            const projectName = resolved.project ? resolved.project.name : 'Unknown';

            // Check for download overlaps (unless force is specified)
            if (!args.force) {
                const newDownload = {
                    projectName,
                    containerName: args.containerName || 'all-containers',
                    environment: args.environment,
                    dateRange: this.describeDateRange(args)
                };

                const overlaps = downloadManager.checkOverlap(newDownload);
                if (overlaps.length > 0) {
                    const warningMessage = downloadManager.formatOverlapWarning(newDownload, overlaps);
                    return ResponseBuilder.success(warningMessage);
                }
            }
            
            // If no log type specified and no container name, show available options
            if (!args.logType && !args.containerName) {
                return this.showLogTypeSelection(args);
            }
            
            // Handle "all" option - download all available log types
            if (args.logType === 'all') {
                return this.handleDownloadAllLogs(args);
            }
            
            // Get the log type
            const logType = args.logType;
            if (!logType && !args.containerName) {
                return this.showLogTypeSelection(args);
            }
            
            // Container name can be specified directly, or we'll try to find it
            let containerName = args.containerName;
            if (!containerName && logType) {
                // We'll check which container exists after we list them
                containerName = null; // Will be resolved after checking available containers
            }
            
            // Use already resolved project configuration
            const projectConfig = resolved.credentials;
            
            // Apply resolved config to args
            Object.assign(args, projectConfig);
            
            // Get list of available containers to check what's actually available
            OutputLogger.info('🔍 Listing storage containers...');
            const containersResult = await StorageTools.handleListStorageContainers(args);
            
            // Debug the raw container listing
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Raw containers result:', typeof containersResult);
                if (containersResult?.content?.[0]?.text) {
                    const text = containersResult.content[0].text;
                    const lines = text.split('\n').slice(0, 20);
                    console.error('[DEBUG] Container listing preview:', lines.join('\n'));
                }
            }
            
            // Debug logging for container result
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Container list result:', JSON.stringify(containersResult, null, 2));
            }
            
            const containers = this.extractContainerList(containersResult);
            
            if (containers.length === 0) {
                // Enhanced error handling if no containers found
                return ResponseBuilder.error('No storage containers found. This could indicate:\n• Authentication issues\n• Project configuration problems\n• Environment access restrictions\n\nRun "check_permissions" to verify your API key access.');
            }
            
            // If no container name specified, try to find the right one based on log type
            if (!containerName && logType) {
                // Check standard containers first
                const standardContainer = this.LOG_CONTAINERS[logType];
                if (containers.includes(standardContainer)) {
                    containerName = standardContainer;
                } else {
                    // Check App Service Insights containers
                    const appServiceContainer = this.APP_SERVICE_CONTAINERS[logType];
                    if (appServiceContainer && containers.includes(appServiceContainer)) {
                        containerName = appServiceContainer;
                    } else {
                        // Check alternative container names (important for Production)
                        const alternatives = this.ALTERNATIVE_CONTAINERS[logType];
                        if (alternatives) {
                            for (const alt of alternatives) {
                                if (containers.includes(alt)) {
                                    containerName = alt;
                                    OutputLogger.info(`📌 Using alternative container: ${alt}`);
                                    break;
                                }
                            }
                        }
                        
                        // If still no match, look for any container with log-related patterns
                        if (!containerName) {
                            const logPatterns = [
                                new RegExp(`${logType}`, 'i'),
                                /logs?$/i,
                                /insights/i,
                                /azure.*log/i
                            ];
                            
                            for (const pattern of logPatterns) {
                                const match = containers.find(c => pattern.test(c));
                                if (match) {
                                    containerName = match;
                                    OutputLogger.info(`🔍 Found matching container: ${match}`);
                                    break;
                                }
                            }
                        }
                        
                        // If still nothing found, show what's available
                        if (!containerName) {
                            return this.showAvailableContainers(args, containers, logType);
                        }
                    }
                }
            }
            
            // Final check if container exists
            if (!containers.includes(containerName)) {
                return this.showAvailableContainers(args, containers, logType);
            }
            
            OutputLogger.info(`📊 Downloading ${logType || 'logs'} from ${args.environment} environment...`);
            OutputLogger.info(`📦 Source: ${containerName} container (Azure Storage)`);
            
            // Generate SAS link for the log container
            OutputLogger.info('🔑 Generating SAS link for log container...');
            const sasArgs = {
                ...args,
                containerName: containerName,
                permissions: 'Read',
                expiryHours: 2  // Short-lived for security
            };
            
            const sasResponse = await StorageTools.handleGenerateStorageSasLink(sasArgs);
            
            // Debug logging for SAS response
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] SAS response:', JSON.stringify(sasResponse, null, 2));
            }
            
            const sasUrl = this.extractSasUrl(sasResponse);
            
            if (!sasUrl) {
                let errorMessage = 'Failed to generate SAS link for log container';
                
                // Provide more detailed error information
                if (sasResponse && typeof sasResponse === 'object') {
                    if (sasResponse.error) {
                        errorMessage += `\nError: ${sasResponse.error}`;
                    }
                    if (sasResponse.result && sasResponse.result.content) {
                        const content = sasResponse.result.content[0];
                        if (content && content.text) {
                            errorMessage += `\nDetails: ${content.text.substring(0, 200)}...`;
                        }
                    }
                }
                
                return ResponseBuilder.error(errorMessage + '\n\nThis could indicate:\n• Insufficient permissions for this container\n• Container access restrictions\n• Authentication issues\n\nRun "check_permissions" to verify your access levels.');
            }
            
            // Process date filters
            const dateFilter = this.processDateFilters(args);
            if (dateFilter) {
                OutputLogger.info(`📅 Date filter: ${dateFilter.description}`);
            }
            
            // Determine download path using validated config
            const validated = await DownloadConfig.getValidatedDownloadPath(
                'logs',
                projectName,
                args.downloadPath,
                args.environment
            );
            
            if (!validated.valid) {
                throw new Error(`Invalid download path: ${validated.error}`);
            }
            
            // Add container-specific subfolder for better organization
            // Structure: /logs/project/web/ or /logs/project/app/
            const containerSubfolder = this.getContainerSubfolderName(containerName);
            const downloadPath = path.join(validated.path, containerSubfolder);
            OutputLogger.info(`💾 Destination: ${downloadPath}/ (${containerSubfolder} logs)`);
            
            // List and download logs
            OutputLogger.info('📋 Listing available log files...');
            if (process.env.DEBUG === 'true' && dateFilter) {
                console.error(`Date filter being applied:`, dateFilter);
            }
            const logs = await this.listLogs(sasUrl, dateFilter || { filter: args.dateFilter }, containerName);
            
            if (logs.length === 0) {
                // Debug logging to understand why no logs were found
                if (process.env.DEBUG === 'true') {
                    console.error(`[NO LOGS DEBUG]`);
                    console.error(`  Container: ${containerName}`);
                    console.error(`  Environment: ${args.environment}`);
                    console.error(`  Date filter: ${JSON.stringify(dateFilter)}`);
                    console.error(`  SAS URL valid: ${sasUrl ? 'Yes' : 'No'}`);
                }
                
                // If this is part of a batch "all" download, return a simple result for aggregation
                if (args.isPartOfBatch) {
                    return ResponseBuilder.success(`📊 **Log Download Complete**

**Environment:** ${args.environment}
**Container:** ${containerName}
**Log Type:** ${logType || 'Unknown'}

**Results:**
• Downloaded: 0 files
• Failed: 0 files
• Total Size: 0 B

**Status:** Container empty for the last ${args.daysBack || 7} days`);
                }
                
                // Special handling for Production environment with no logs (only for individual downloads)
                if (args.environment === 'Production') {
                    let message = `## ⚠️ No Logs Found in Production\n\n`;
                    message += `**Container checked**: ${containerName}\n`;
                    message += `**Environment**: ${args.environment}\n`;
                    if (args.dateFilter || dateFilter) {
                        message += `**Date filter**: ${args.dateFilter || dateFilter.description}\n`;
                    }
                    message += `\n### 🔍 Troubleshooting Steps:\n\n`;
                    message += `1. **Run log discovery** to diagnose the issue:\n`;
                    message += `   \`\`\`\n   discover_logs\n   \`\`\`\n\n`;
                    message += `2. **Common causes for missing Production logs**:\n`;
                    message += `   • Logging not enabled (requires Optimizely Support)\n`;
                    message += `   • Wrong container name (logs may be in different container)\n`;
                    message += `   • Insufficient permissions\n`;
                    message += `   • No recent activity generating logs\n\n`;
                    message += `3. **Alternative solutions**:\n`;
                    message += `   • Check DXP Management Portal for logs\n`;
                    message += `   • Contact Optimizely Support to enable logging\n`;
                    message += `   • Try Integration environment instead\n\n`;
                    message += `📧 **Support**: support@optimizely.com\n`;
                    
                    return ResponseBuilder.success(message);
                }
                
                return ResponseBuilder.success(`No log files found in ${containerName} container${args.dateFilter ? ` for date filter: ${args.dateFilter}` : ''}`);
            }
            
            // Check for stale logs in production (warning if logs are old)
            if (args.environment === 'Production' && logs.length > 0) {
                const mostRecentLog = logs[logs.length - 1]; // Logs are usually sorted by date
                const logDateMatch = mostRecentLog.name.match(/y=(\d{4})\/m=(\d{2})\/d=(\d{2})/);
                if (logDateMatch) {
                    const logDate = new Date(`${logDateMatch[1]}-${logDateMatch[2]}-${logDateMatch[3]}`);
                    const daysSinceLastLog = Math.floor((new Date() - logDate) / (1000 * 60 * 60 * 24));
                    
                    if (daysSinceLastLog > 30) {
                        OutputLogger.info(`⚠️  ALERT: Production logs are ${daysSinceLastLog} days old! Last log from ${logDate.toISOString().split('T')[0]}`);
                        OutputLogger.info(`⚠️  This indicates production logging may have stopped. Please investigate immediately.`);
                    }
                }
            }
            
            // Calculate total size
            const totalLogSize = logs.reduce((sum, log) => sum + (log.size || 0), 0);
            
            // Enhanced debug logging for download process
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Log download details:');
                console.error(`  - Total logs found: ${logs.length}`);
                console.error(`  - Container: ${containerName}`);
                console.error(`  - Log type: ${logType}`);
                console.error(`  - Environment: ${args.environment}`);
                console.error(`  - Download path: ${downloadPath}`);
                console.error(`  - Skip confirmation: ${args.skipConfirmation}`);
                console.error(`  - Preview only: ${args.previewOnly}`);
                console.error(`  - First log: ${logs[0]?.name || 'none'}`);
                console.error(`  - Last log: ${logs[logs.length - 1]?.name || 'none'}`);
            }
            
            // Check for confirmation (unless skipConfirmation is set)
            if (!args.skipConfirmation && !args.previewOnly) {
                const confirmMessage = this.formatLogDownloadConfirmation(
                    logs,
                    totalLogSize,
                    containerName,
                    logType,
                    args.environment,
                    downloadPath,
                    args.dateFilter
                );
                
                // Return the preview with confirmation instructions directly in response
                const fullResponse = confirmMessage + 
                    '\n⚠️  **Download Confirmation Required**\n\n' +
                    'Please review the above details and confirm you want to proceed.\n\n' +
                    '**To proceed with download:**\n' +
                    '   • Use `download_logs` with `skipConfirmation: true`\n' +
                    '   • Or say "Yes, download the logs"\n\n' +
                    '**Additional options:**\n' +
                    '   • Use different folder: `downloadPath: "/your/preferred/path"`\n' +
                    '   • Filter by date: `startDate: "2025/08/24"`\n' +
                    '   • Cancel: Simply ignore this message\n';
                
                return ResponseBuilder.success(fullResponse);
            }
            
            // Preview only mode
            if (args.previewOnly) {
                return ResponseBuilder.success(this.formatLogDownloadConfirmation(
                    logs,
                    totalLogSize,
                    containerName,
                    logType,
                    args.environment,
                    downloadPath,
                    args.dateFilter
                ));
            }
            
            // Check for incremental download opportunities
            let incrementalInfo = null;
            let skippedFiles = [];
            let logsToDownload = logs;
            
            const incremental = args.incremental !== false && !args.forceFullDownload;
            if (incremental) {
                OutputLogger.info('🔄 Checking for incremental download opportunities...');
                
                const manifestCheck = await ManifestManager.getFilesToDownload(
                    downloadPath,
                    logs.map(log => ({
                        name: log.name,
                        size: log.size || 0,
                        lastModified: log.lastModified || null,
                        source: containerName
                    }))
                );
                
                incrementalInfo = manifestCheck;
                skippedFiles = manifestCheck.skippedFiles;
                logsToDownload = manifestCheck.filesToDownload.map(f => {
                    // Map back to original log format
                    const originalLog = logs.find(l => l.name === f.name);
                    return originalLog || f;
                });
                
                if (skippedFiles.length > 0) {
                    OutputLogger.info(`✨ Smart download: Skipping ${skippedFiles.length} unchanged log files`);
                    OutputLogger.info(`   Bandwidth saved: ${ManifestManager.formatBytes(skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0))}`);
                }
            }
            
            OutputLogger.info(`📥 Starting download of ${logsToDownload.length} log files...`);
            OutputLogger.info(`📦➡️💾 ${containerName} ➡️ ${downloadPath}/`);
            
            // Register download for tracking and cancellation
            const downloadKey = downloadManager.registerDownload({
                projectName,
                containerName,
                environment: args.environment,
                dateRange: this.describeDateRange(args),
                logType: args.logType || 'logs',
                totalFiles: logs.length,
                downloadPath
            });
            
            OutputLogger.info(`📋 Download registered: ${downloadKey}`);
            
            // Download logs with progress tracking
            let downloadedCount = 0;
            let failedCount = 0;
            let totalSize = 0;
            
            for (const log of logsToDownload) {
                try {
                    const localPath = path.join(downloadPath, log.name);
                    const localDir = path.dirname(localPath);
                    
                    // Create subdirectories if needed
                    await fs.mkdir(localDir, { recursive: true });
                    
                    // Download the log file
                    const size = await this.downloadLogFile(log.url, localPath, log.name);
                    downloadedCount++;
                    totalSize += size;
                    
                    // Update progress
                    const progress = Math.round((downloadedCount / logs.length) * 100);
                    downloadManager.updateProgress(downloadKey, progress);
                    
                    OutputLogger.success(`✅ Downloaded: ${log.name} (${this.formatBytes(size)})`);
                    
                    // Add to manifest for future incremental downloads
                    if (incrementalInfo) {
                        ManifestManager.addFileToManifest(incrementalInfo.manifest, log.name, {
                            size: size,
                            lastModified: log.lastModified || new Date().toISOString(),
                            source: containerName
                        });
                    }
                } catch (error) {
                    failedCount++;
                    OutputLogger.error(`❌ Failed to download: ${log.name} - ${error.message}`);
                }
            }
            
            // Save manifest for future incremental downloads
            if (incrementalInfo && downloadedCount > 0) {
                await ManifestManager.saveManifest(downloadPath, incrementalInfo.manifest);
                OutputLogger.info('📝 Manifest updated for future incremental downloads');
            }
            
            // Check for sparse logging
            const daysRequested = args.daysBack || 7;
            const isSparseLogging = downloadedCount > 0 && downloadedCount < daysRequested;
            
            // Generate summary with appropriate warning
            let response;
            if (isSparseLogging) {
                response = `⚠️ **Sparse Logging Detected**\n\n`;
                response += `Found only ${downloadedCount} log file${downloadedCount !== 1 ? 's' : ''} for the last ${daysRequested} days.\n\n`;
            } else {
                response = `📊 **Log Download Complete**\n\n`;
            }
            
            response += `**Environment:** ${args.environment}\n`;
            response += `**Log Type:** ${logType} (${containerName})\n`;
            response += `**Download Path:** ${downloadPath}\n\n`;
            response += `**Results:**\n`;
            response += `• Downloaded: ${downloadedCount} files\n`;
            if (skippedFiles.length > 0) {
                response += `• Skipped (unchanged): ${skippedFiles.length} files\n`;
            }
            response += `• Failed: ${failedCount} files\n`;
            response += `• Total Size: ${this.formatBytes(totalSize)}\n`;
            if (skippedFiles.length > 0) {
                const savedSize = skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
                response += `• Bandwidth Saved: ${ManifestManager.formatBytes(savedSize)}\n`;
            }
            response += `\n`;
            
            if (args.dateFilter) {
                response += `**Date Filter:** ${args.dateFilter}\n\n`;
            }
            
            if (isSparseLogging) {
                response += `### ⚠️ Why So Few Logs?\n`;
                response += `**Common causes:**\n`;
                response += `• Application Insights may not be fully configured\n`;
                response += `• Low application activity or traffic\n`;
                response += `• Logging level set too high (only errors logged)\n`;
                response += `• Logs may be written elsewhere (e.g., custom logging)\n\n`;
                response += `**To investigate:**\n`;
                response += `• Check Application Insights in Azure Portal\n`;
                response += `• Verify logging configuration in your application\n`;
                response += `• Try Integration environment for comparison\n`;
                response += `• Contact Optimizely Support for assistance\n\n`;
            }
            
            response += `💡 **Tips:**\n`;
            response += `• Application logs contain detailed app diagnostics\n`;
            response += `• Web logs contain IIS/server access logs\n`;
            response += `• Logs are retained for 90 days by default\n`;
            response += `• Use date filters to download specific periods (e.g., "2025/08/24")\n`;
            
            // Mark download as completed
            const result = {
                downloaded: downloadedCount,
                failed: failedCount,
                totalSize: this.formatBytes(totalSize),
                downloadPath
            };
            
            if (failedCount > 0 && downloadedCount === 0) {
                downloadManager.failDownload(downloadKey, `All downloads failed (${failedCount} failures)`);
            } else {
                downloadManager.completeDownload(downloadKey, result);
            }
            
            return ResponseBuilder.success(response);
            
        } catch (error) {
            // Mark download as failed if it was registered
            if (typeof downloadKey !== 'undefined') {
                downloadManager.failDownload(downloadKey, error.message);
            }
            return ErrorHandler.handleError(error, 'download-logs', args);
        }
    }
    
    /**
     * Handle downloading all available log types
     */
    static async handleDownloadAllLogs(args) {
        try {
            // Resolve project configuration
            const resolved = ProjectTools.resolveCredentials(args);
            if (!resolved.success || !resolved.credentials) {
                return ResponseBuilder.invalidParams('Missing required project configuration (apiKey, apiSecret, or projectId)');
            }
            
            const projectConfig = resolved.credentials;
            const projectName = resolved.project ? resolved.project.name : 'Unknown';
            
            // Get list of available containers
            // Make sure we're passing the correct credentials structure
            const containersResult = await StorageTools.handleListStorageContainers({
                ...args,
                ...projectConfig,
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                projectId: projectConfig.projectId
            });
            const containers = this.extractContainerList(containersResult);
            
            // Find which log containers are available - check both standard and App Service containers
            const availableLogTypes = [];
            
            // Check standard containers
            for (const [logType, containerName] of Object.entries(this.LOG_CONTAINERS)) {
                if (containers.includes(containerName)) {
                    availableLogTypes.push({ logType, containerName });
                }
            }
            
            // Check App Service Insights containers if no standard ones found (or in addition)
            for (const [logType, containerName] of Object.entries(this.APP_SERVICE_CONTAINERS)) {
                // Don't add duplicates if we already have this log type
                const alreadyHasType = availableLogTypes.some(lt => lt.logType === logType);
                if (!alreadyHasType && containers.includes(containerName)) {
                    availableLogTypes.push({ logType, containerName });
                }
            }
            
            if (availableLogTypes.length === 0) {
                // Enhanced message when no logs found
                let message = `## ⚠️ No Logs Found in ${args.environment}\n\n`;
                message += `**Containers checked**: ${this.LOG_CONTAINERS['application']}, ${this.LOG_CONTAINERS['web']}\n`;
                message += `**App Service containers checked**: ${this.APP_SERVICE_CONTAINERS['application']}, ${this.APP_SERVICE_CONTAINERS['web']}\n\n`;
                
                if (containers.length > 0) {
                    message += `**Available containers in this environment:**\n`;
                    message += containers.map(c => `• ${c}`).join('\n');
                    message += `\n\n💡 None of these appear to be standard log containers.\n`;
                } else {
                    message += `**No containers found** - This could indicate permission issues.\n`;
                }
                
                message += `\n**Possible Solutions:**\n`;
                message += `1. **Enable logging** - Contact Optimizely Support (support@optimizely.com) to enable Application Insights\n`;
                message += `2. **Try another environment** - Run: \`download logs from Integration\`\n`;
                message += `3. **Check permissions** - Run: \`check_permissions\` to verify your API key access\n`;
                message += `4. **Use discover_logs** - Run: \`discover_logs\` to find available log containers\n`;
                
                return ResponseBuilder.success(message);
            }
            
            // Show confirmation for all log types
            if (!args.skipConfirmation) {
                let message = `# 📊 Download All Logs Confirmation\n\n`;
                message += `## 📋 Log Types Found\n`;
                message += `Found ${availableLogTypes.length} log type${availableLogTypes.length !== 1 ? 's' : ''} in ${args.environment}:\n\n`;
                
                for (const { logType, containerName } of availableLogTypes) {
                    message += `### ${logType.charAt(0).toUpperCase() + logType.slice(1)} Logs\n`;
                    message += `• Container: ${containerName}\n`;
                    if (logType === 'application') {
                        message += `• Contains: Application errors, stack traces, custom logging\n`;
                    } else if (logType === 'web') {
                        message += `• Contains: HTTP requests, response codes, traffic data\n`;
                    } else if (logType === 'cloudflare') {
                        message += `• Contains: CDN cache stats, security events\n`;
                    }
                    message += '\n';
                }
                
                message += `## ⚠️ Download Confirmation Required\n`;
                message += `To download all ${availableLogTypes.length} log types, run:\n`;
                message += `\`\`\`\n`;
                message += `"download all logs from ${args.environment} with skipConfirmation: true"\n`;
                message += `\`\`\`\n\n`;
                
                message += `Or download specific types:\n`;
                for (const { logType } of availableLogTypes) {
                    message += `• \`"download ${logType} logs from ${args.environment}"\`\n`;
                }
                
                return ResponseBuilder.success(message);
            }
            
            // Download each log type
            let allResults = [];
            for (const { logType, containerName } of availableLogTypes) {
                // Show what's being downloaded and where
                const containerSubfolder = this.getContainerSubfolderName(containerName);
                const basePath = await SettingsManager.getDownloadPath();
                const fullPath = path.join(basePath, 'logs', projectName || 'unknown', containerSubfolder);
                
                OutputLogger.info(`\n📥 Downloading ${logType} logs...`);
                OutputLogger.info(`💾 Saving to: ${fullPath}/ (${containerSubfolder} subfolder)`);
                
                const result = await this.handleDownloadLogs({
                    ...args,
                    logType,
                    containerName,
                    downloadPath: fullPath,  // Use the path we calculated
                    skipConfirmation: true,  // Skip individual confirmations
                    isPartOfBatch: true      // Flag to indicate this is part of "all" download
                });
                allResults.push({ logType, result });
            }
            
            // Summarize results - properly handle empty log scenarios
            let actualDownloadCount = 0;
            let totalFilesDownloaded = 0;
            
            // Build detailed results for each log type
            const detailedResults = [];
            for (const { logType, result } of allResults) {
                const resultDetails = { logType, status: 'unknown', files: 0, size: '0 B' };
                
                if (result.content && result.content[0]) {
                    const text = result.content[0].text;
                    
                    // Check for different result patterns (handle both bold and plain formats)
                    const downloadMatch = text.match(/(?:\*\*)?Downloaded:(?:\*\*)? (\d+) files/);
                    const sizeMatch = text.match(/(?:\*\*)?Total Size:(?:\*\*)? ([\d\.]+ \w+)/);
                    const noLogsMatch = text.match(/No Logs Found|No log files found|empty for the last \d+ days/i);
                    
                    if (downloadMatch) {
                        resultDetails.files = parseInt(downloadMatch[1]);
                        resultDetails.size = sizeMatch ? sizeMatch[1] : 'unknown';
                        resultDetails.status = resultDetails.files > 0 ? 'success' : 'empty';
                        if (resultDetails.files > 0) {
                            actualDownloadCount++;
                            totalFilesDownloaded += resultDetails.files;
                        }
                    } else if (noLogsMatch) {
                        resultDetails.status = 'empty';
                    } else {
                        // Unknown status - log for debugging
                        if (process.env.DEBUG === 'true') {
                            console.error(`[DEBUG] Unknown result format for ${logType}: ${text.substring(0, 100)}`);
                        }
                        resultDetails.status = 'unknown';
                    }
                }
                
                detailedResults.push(resultDetails);
            }
            
            // Generate appropriate summary based on actual results
            let summary;
            if (actualDownloadCount === 0) {
                summary = `## ⚠️ No Logs Found in ${args.environment}\n\n`;
                summary += `**Container checked**: ${availableLogTypes.map(t => t.containerName).join(', ')}\n`;
                summary += `**Time range**: Last ${args.daysBack || 7} days\n\n`;
                summary += `### 📝 Possible Reasons:\n`;
                summary += `1. **Production logging not enabled** (most common)\n`;
                summary += `   • Contact Optimizely Support to enable Application Insights\n`;
                summary += `   • Email: support@optimizely.com\n\n`;
                summary += `2. **No recent activity**\n`;
                summary += `   • The environment might not have traffic generating logs\n`;
                summary += `   • Try checking Integration environment instead\n\n`;
                summary += `3. **Log retention expired**\n`;
                summary += `   • Logs older than 90 days are automatically deleted\n\n`;
                summary += `### 💡 Next Steps:\n`;
                summary += `• Check the DXP Management Portal for logs\n`;
                summary += `• Try a different environment: \`download logs from Integration\`\n`;
                summary += `• Contact Optimizely Support if logs should be present\n`;
            } else {
                // Check if logging is sparse (very few files for the time period)
                const daysRequested = args.daysBack || 7;
                const expectedMinFiles = daysRequested; // At least 1 file per day is reasonable
                const isSparseLogging = totalFilesDownloaded < expectedMinFiles && totalFilesDownloaded > 0;
                
                if (isSparseLogging) {
                    summary = `# ⚠️ Sparse Logging Detected in ${args.environment}\n\n`;
                    summary += `Found only **${totalFilesDownloaded} log file${totalFilesDownloaded !== 1 ? 's' : ''}** for the last ${daysRequested} days:\n\n`;
                } else {
                    summary = `# 📊 All Logs Download Complete\n\n`;
                    summary += `Successfully downloaded ${totalFilesDownloaded} files from ${actualDownloadCount} log type(s) in ${args.environment}:\n\n`;
                }
                
                for (const result of detailedResults) {
                    const icon = result.status === 'success' ? '✅' : result.status === 'empty' ? '⚠️' : '❓';
                    summary += `${icon} **${result.logType.charAt(0).toUpperCase() + result.logType.slice(1)} Logs**: `;
                    
                    if (result.status === 'success') {
                        summary += `${result.files} files (${result.size})`;
                    } else if (result.status === 'empty') {
                        summary += `No logs found`;
                    } else {
                        summary += `Status unknown`;
                    }
                    summary += '\n';
                }
                
                // Add warning and recommendations for sparse logging
                if (isSparseLogging) {
                    summary += `\n### ⚠️ Warning: Very Limited Logging Activity\n`;
                    summary += `This environment is generating logs very infrequently.\n\n`;
                    summary += `**Possible causes:**\n`;
                    summary += `• Low traffic or minimal application activity\n`;
                    summary += `• Logging level set too high (e.g., only ERROR level)\n`;
                    summary += `• Application Insights sampling is too aggressive\n`;
                    summary += `• Intermittent logging configuration issues\n\n`;
                    summary += `**Recommendations:**\n`;
                    summary += `• Check your application's logging configuration\n`;
                    summary += `• Verify Application Insights settings in Azure Portal\n`;
                    summary += `• Consider lowering log level to capture more events\n`;
                    summary += `• Contact Optimizely Support if this is unexpected\n`;
                }
            }
            
            return ResponseBuilder.success(summary);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'download-all-logs', args);
        }
    }
    
    /**
     * Show available containers when standard ones aren't found
     */
    static showAvailableContainers(args, containers, requestedLogType) {
        let message = `# 📊 Log Container Selection\n\n`;
        
        if (requestedLogType) {
            message += `⚠️ The standard ${requestedLogType} log container wasn't found.\n\n`;
        }
        
        message += `## 📦 Available Containers in ${args.environment}\n\n`;
        
        // Identify log containers
        const logContainers = containers.filter(c => 
            c.includes('log') || 
            c.includes('insights') || 
            c === 'azure-application-logs' ||
            c === 'azure-web-logs' ||
            c === 'cloudflarelogpush'
        );
        
        const otherContainers = containers.filter(c => !logContainers.includes(c));
        
        if (logContainers.length > 0) {
            message += `### 📋 Log Containers\n`;
            for (const container of logContainers) {
                message += `• **${container}**`;
                
                // Try to identify what type of logs these might be
                if (container.includes('console') || container.includes('application')) {
                    message += ` - Likely application/console logs`;
                } else if (container.includes('http') || container.includes('web')) {
                    message += ` - Likely web/HTTP access logs`;
                } else if (container.includes('cloudflare')) {
                    message += ` - CDN/Cloudflare logs`;
                }
                message += `\n`;
            }
            message += `\n`;
        }
        
        if (otherContainers.length > 0) {
            message += `### 📁 Other Containers\n`;
            for (const container of otherContainers) {
                message += `• ${container}\n`;
            }
            message += `\n`;
        }
        
        message += `## 🎯 How to Download\n\n`;
        
        if (logContainers.length > 0) {
            message += `To download logs from a specific container, use:\n\n`;
            message += `\`\`\`bash\n`;
            for (const container of logContainers.slice(0, 2)) {
                message += `"download logs from ${args.environment} with containerName: '${container}'"\n`;
            }
            message += `\`\`\`\n\n`;
        }
        
        message += `## 💡 Tips\n`;
        message += `• **insights-logs-appserviceconsolelogs** = Application console logs\n`;
        message += `• **insights-logs-appservicehttplogs** = HTTP/web server logs\n`;
        message += `• Add \`dateFilter: "2025/08/26"\` to get specific dates\n`;
        message += `• Add \`previewOnly: true\` to see what would be downloaded\n`;
        
        return ResponseBuilder.success(message);
    }
    
    /**
     * Show log type selection helper
     */
    static async showLogTypeSelection(args) {
        let message = `# 📊 Log Type Selection Required\n\n`;
        
        message += `⚠️ **No log type specified.** Please choose which logs you want to download:\n\n`;
        
        message += `## 📋 Available Log Types\n\n`;
        
        message += `### 1️⃣ Application Logs\n`;
        message += `**Command:** \`download application logs from ${args.environment || 'production'}\`\n`;
        message += `**Contains:**\n`;
        message += `• Application errors and exceptions\n`;
        message += `• Stack traces and debug messages\n`;
        message += `• Custom application logging\n`;
        message += `• CMS/Optimizely events\n`;
        message += `• Performance metrics\n`;
        message += `**Use for:** Debugging issues, tracking errors, performance analysis\n\n`;
        
        message += `### 2️⃣ Web Server Logs\n`;
        message += `**Command:** \`download web logs from ${args.environment || 'production'}\`\n`;
        message += `**Contains:**\n`;
        message += `• All HTTP requests (URLs, methods, status codes)\n`;
        message += `• User agents and IP addresses\n`;
        message += `• Response times and bytes transferred\n`;
        message += `• 404 errors and failed requests\n`;
        message += `**Use for:** Traffic analysis, SEO, security investigations\n\n`;
        
        message += `### 3️⃣ Cloudflare Logs (if available)\n`;
        message += `**Command:** \`download cloudflare logs from ${args.environment || 'production'}\`\n`;
        message += `**Contains:**\n`;
        message += `• CDN cache performance\n`;
        message += `• Edge server locations\n`;
        message += `• Security events (WAF, DDoS)\n`;
        message += `**Use for:** CDN optimization, security analysis\n\n`;
        
        message += `### 4️⃣ All Available Logs\n`;
        message += `**Command:** \`download all logs from ${args.environment || 'production'}\`\n`;
        message += `Downloads all log types that are available in your environment.\n\n`;
        
        message += `## 📅 Timeframe Options (90 Days Available)\n`;
        message += `• **Today only:** \`dateFilter: "${new Date().toISOString().split('T')[0].replace(/-/g, '/')}"\`\n`;
        message += `• **Last 7 days:** \`daysBack: 7\`\n`;
        message += `• **Last 30 days:** \`daysBack: 30\`\n`;
        message += `• **Specific date:** \`dateFilter: "2025/08/26"\`\n`;
        message += `• **Date range:** \`startDate: "2025/08/20", endDate: "2025/08/26"\`\n`;
        message += `• **All available (90 days):** Don't specify any date filter\n\n`;
        
        message += `## 💡 Tips\n`;
        message += `• Add \`downloadPath: "/custom/path"\` to specify where to save\n`;
        message += `• Add \`previewOnly: true\` to see what would be downloaded\n`;
        message += `• Logs are retained for 90 days in Optimizely DXP\n`;
        message += `• Recent logs (last 7 days) download much faster\n\n`;
        
        message += `## 🎯 Quick Examples\n`;
        message += `\`\`\`bash\n`;
        message += `# Debug today's production issues\n`;
        message += `"download application logs from production daysBack: 1"\n\n`;
        message += `# Last week's traffic analysis\n`;
        message += `"download web logs from production daysBack: 7"\n\n`;
        message += `# Specific incident investigation\n`;
        message += `"download all logs from production dateFilter: '2025/08/24'"\n\n`;
        message += `# Full month analysis\n`;
        message += `"download application logs from production daysBack: 30"\n`;
        message += `\`\`\`\n\n`;
        
        message += `## ⏸️ Action Required\n`;
        message += `**Please specify which log type you want to download by running one of the commands above.**`;
        
        return ResponseBuilder.success(message);
    }
    
    /**
     * Format log download confirmation message
     */
    static formatLogDownloadConfirmation(logs, totalSize, containerName, logType, environment, downloadPath, dateFilter, incrementalInfo = null) {
        let message = `# 📊 Log Download Confirmation\n\n`;
        
        // PROMINENT DESTINATION DISPLAY
        message += `## 📁➡️💾 DOWNLOAD DESTINATION\n`;
        message += `**Logs will be downloaded to:**\n`;
        message += `\`\`\`\n${downloadPath}/\n\`\`\`\n\n`;
        
        // Explain what these logs are
        message += `## 📋 What Are These Logs?\n`;
        
        if (logType === 'application') {
            message += `**Application Logs** contain:\n`;
            message += `• Application errors, warnings, and debug messages\n`;
            message += `• Stack traces and exception details\n`;
            message += `• Custom logging from your application code\n`;
            message += `• EPiServer/Optimizely CMS event logs\n`;
            message += `• Performance metrics and timing information\n`;
            message += `• Database query logs (if enabled)\n\n`;
            message += `💡 **Use these to**: Debug application issues, track errors, analyze performance\n\n`;
        } else if (logType === 'web') {
            message += `**Web Server Logs** contain:\n`;
            message += `• IIS access logs (HTTP requests/responses)\n`;
            message += `• User agent strings and IP addresses\n`;
            message += `• Response codes (200, 404, 500, etc.)\n`;
            message += `• Request timing and bandwidth usage\n`;
            message += `• Referrer information\n`;
            message += `• Failed request tracing (if enabled)\n\n`;
            message += `💡 **Use these to**: Analyze traffic, track 404s, investigate security issues\n\n`;
        } else if (logType === 'cloudflare') {
            message += `**Cloudflare Logs** contain:\n`;
            message += `• CDN cache hit/miss information\n`;
            message += `• Edge server locations\n`;
            message += `• Security events (WAF, DDoS)\n`;
            message += `• Performance metrics\n\n`;
            message += `💡 **Use these to**: Analyze CDN performance, security events\n\n`;
        }
        
        // Show details
        message += `## 📦 Log Details\n`;
        message += `• **Environment**: ${environment}\n`;
        message += `• **Container**: ${containerName}\n`;
        
        // Show incremental info if available
        if (incrementalInfo) {
            message += `\n### ✨ Smart Incremental Download\n`;
            message += `• **Files already up-to-date**: ${incrementalInfo.skippedFiles}\n`;
            message += `• **Files to download**: ${incrementalInfo.toDownload}\n`;
            message += `• **Data already local**: ${ManifestManager.formatBytes(incrementalInfo.skippedSize)}\n`;
            message += `• **Data to download**: ${this.formatBytes(totalSize - incrementalInfo.skippedSize)}\n`;
            const savedPct = totalSize > 0 ? Math.round((incrementalInfo.skippedSize / totalSize) * 100) : 0;
            message += `• **Bandwidth saved**: ${savedPct}%\n\n`;
        }
        
        message += `• **Total Files**: ${logs.length}\n`;
        message += `• **Total Size**: ${this.formatBytes(totalSize)}\n`;
        if (dateFilter) {
            message += `• **Date Filter**: ${dateFilter}\n`;
        }
        message += `• **Retention**: Logs are kept for 90 days\n\n`;
        
        // Show destination with container type explanation
        message += `## 📁 Destination Folder\n`;
        message += `• **Path**: \`${downloadPath}\`\n`;
        message += `• **Structure**: Organized by log type for better analysis\n`;
        message += `  - \`web/\` - HTTP/IIS web server logs (traffic analysis)\n`;
        message += `  - \`app/\` - Application console logs (errors/performance)\n`;
        message += `  - \`cloudflare/\` - CDN/edge logs\n\n`;
        
        // Show sample files
        message += `## 📄 Sample Log Files (first 5)\n`;
        const sampleLogs = logs.slice(0, 5);
        for (const log of sampleLogs) {
            message += `• ${log.name}`;
            if (log.size) {
                message += ` (${this.formatBytes(log.size)})`;
            }
            message += '\n';
        }
        if (logs.length > 5) {
            message += `• ... and ${logs.length - 5} more files\n`;
        }
        message += '\n';
        
        // Estimate download time
        const estimatedSeconds = Math.ceil(totalSize / (2 * 1024 * 1024)); // Assume 2MB/s for logs
        message += `## ⏱️ Estimated Time\n`;
        message += `• **Download Time**: ~${this.formatDuration(estimatedSeconds)}\n\n`;
        
        return message;
    }
    
    /**
     * Determine the download path for log files
     */
    static async determineLogDownloadPath(args, projectName, containerName) {
        // Get base path first
        let basePath;
        
        if (args.downloadPath) {
            // User specified path
            basePath = args.downloadPath;
        } else {
            // Smart path detection for logs
            const possiblePaths = [
                `/Users/bgerby/Documents/dev/logs/${projectName}`,
                `./logs/${projectName}`,
                `~/Downloads/optimizely-logs/${projectName}`,
                `./optimizely-logs/${projectName}`
            ];
            
            // Find first existing parent directory
            basePath = null;
            for (const testPath of possiblePaths) {
                const expandedPath = testPath.startsWith('~') 
                    ? path.join(os.homedir(), testPath.slice(1))
                    : path.resolve(testPath);
                
                try {
                    const parentDir = path.dirname(expandedPath);
                    await fs.access(parentDir);
                    basePath = expandedPath;
                    break;
                } catch {
                    // Directory doesn't exist, continue
                }
            }
            
            // Use default if nothing found
            if (!basePath) {
                basePath = `./optimizely-logs/${projectName}`;
            }
        }
        
        // Add container-specific subfolder for better organization
        const containerSubfolder = this.getContainerSubfolderName(containerName);
        return path.join(basePath, containerSubfolder);
    }
    
    /**
     * Get a friendly subfolder name for different container types
     * Follows best practice structure: web/, app/, cloudflare/, etc.
     */
    static getContainerSubfolderName(containerName) {
        // Map container names to clean, organized subfolder names
        if (containerName.includes('appservicehttplogs')) {
            return 'web';  // IIS/HTTP web server logs (traffic analysis)
        } else if (containerName.includes('appserviceconsolelogs')) {
            return 'app';  // Application Insights console logs (errors/performance)
        } else if (containerName.includes('cloudflare')) {
            return 'cloudflare';  // CDN/edge logs
        } else if (containerName.includes('insights-logs')) {
            return 'app';  // Application Insights general logs
        } else {
            // Use the container name directly, but clean it up
            return containerName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
        }
    }
    
    /**
     * Legacy method for backward compatibility - use determineLogDownloadPath instead
     */
    static async determineLogDownloadPathLegacy(args, projectName) {
        // Default to settings or current directory
        const settingsPath = await SettingsManager.getDownloadPath();
        return path.join(settingsPath, 'logs', projectName || 'unknown');
    }

    /**
     * Describe the date range for download overlap detection
     */
    static describeDateRange(args) {
        if (args.daysBack) {
            return `last-${args.daysBack}-days`;
        }
        if (args.startDate || args.endDate) {
            const start = args.startDate || 'beginning';
            const end = args.endDate || 'now';
            return `${start}-to-${end}`;
        }
        return 'all-time';
    }
    
    /**
     * List logs in the container with optional date filtering
     * FIXED v3.17.0: Added pagination support to get ALL blobs, not just first 5000
     * FIXED v3.17.2: Increased page limit for very large containers (some have 15+ months)
     */
    static async listLogs(sasUrl, dateFilterObj, containerName = null) {
        const allLogs = [];
        let nextMarker = null;
        let pageCount = 0;
        const maxPages = 100; // Increased from 20 to handle up to 500,000 files
        
        // For very large containers, show progress
        const showProgress = process.env.DEBUG === 'true' || process.env.LOG_PAGINATION === 'true';
        
        do {
            pageCount++;
            if (showProgress || (pageCount % 10 === 0)) {
                console.error(`[PAGINATION] Fetching page ${pageCount}... (${allLogs.length} files so far)`);
            }
            
            const pageLogs = await this.listLogsPage(sasUrl, nextMarker);
            allLogs.push(...pageLogs.logs);
            nextMarker = pageLogs.nextMarker;
            
            if (showProgress) {
                console.error(`[PAGINATION] Page ${pageCount}: Got ${pageLogs.logs.length} items, nextMarker: ${nextMarker ? 'yes' : 'no'}`);
            }
            
            // Safety check to prevent infinite loops  
            if (pageCount >= maxPages && nextMarker) {
                console.error(`[WARNING] Container has more than ${maxPages * 5000} files!`);
                console.error(`[WARNING] Stopping at ${allLogs.length} files to prevent timeout.`);
                console.error(`[TIP] Use date filters to reduce the number of files to process.`);
                break;
            }
        } while (nextMarker);
        
        // Always show summary for large containers
        if (pageCount > 5 || allLogs.length > 10000) {
            console.error(`[PAGINATION] Fetched ${pageCount} pages, ${allLogs.length} total files`);
        } else if (showProgress) {
            console.error(`[PAGINATION] Total pages fetched: ${pageCount}, total items: ${allLogs.length}`);
        }
        
        // Now parse all logs with date filtering
        return this.filterLogsByDate(allLogs, sasUrl, dateFilterObj, containerName);
    }
    
    /**
     * Fetch a single page of logs from Azure Storage
     */
    static async listLogsPage(sasUrl, marker) {
        return new Promise((resolve, reject) => {
            const parsedUrl = new URL(sasUrl);
            let listUrl = `${parsedUrl.origin}${parsedUrl.pathname}?restype=container&comp=list${parsedUrl.search.replace('?', '&')}`;
            
            // Add marker for pagination if provided
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
                        // Extract logs and NextMarker from XML
                        const logs = [];
                        const logMatches = data.matchAll(/<Blob>[\s\S]*?<\/Blob>/g);
                        
                        for (const match of logMatches) {
                            const blobXml = match[0];
                            const nameMatch = blobXml.match(/<Name>(.*?)<\/Name>/);
                            if (nameMatch) {
                                const sizeMatch = blobXml.match(/<Content-Length>(\d+)<\/Content-Length>/);
                                const modifiedMatch = blobXml.match(/<Last-Modified>(.*?)<\/Last-Modified>/);
                                
                                logs.push({
                                    name: nameMatch[1],
                                    size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                                    lastModified: modifiedMatch ? modifiedMatch[1] : null,
                                    xml: blobXml
                                });
                            }
                        }
                        
                        // Check for NextMarker (indicates more pages)
                        const nextMarkerMatch = data.match(/<NextMarker>(.*?)<\/NextMarker>/);
                        const nextMarker = nextMarkerMatch ? nextMarkerMatch[1] : null;
                        
                        resolve({ logs, nextMarker });
                    } catch (error) {
                        reject(error);
                    }
                });
                
                response.on('error', reject);
            });
        });
    }
    
    /**
     * Filter logs by date after fetching all pages
     */
    static filterLogsByDate(allLogs, sasUrl, dateFilterObj, containerName = null) {
        const baseUrl = sasUrl.split('?')[0];
        const sasToken = sasUrl.split('?')[1];
        const filteredLogs = [];
        
        // Extract filter parameters
        const dateFilter = dateFilterObj?.filter;
        const startDate = dateFilterObj?.startDate;
        const endDate = dateFilterObj?.endDate;
        
        // Tracking for debug
        let totalFilesChecked = 0;
        let filesSkippedByDate = 0;
        let filesSkippedNoDate = 0;
        let filesSkippedNotLog = 0;
        
        for (const log of allLogs) {
            totalFilesChecked++;
            const name = log.name;
            
            // Apply date filter if specified
            if (dateFilter) {
                const filterPattern = dateFilter.replace(/-/g, '/');
                if (!name.includes(filterPattern)) {
                    continue;
                }
            }
            
            // Apply date range filter if specified
            if (startDate && endDate) {
                const dateMatch = name.match(/y=(\d{4})\/m=(\d{1,2})\/d=(\d{1,2})/) || 
                                  name.match(/(\d{4})\/(\d{2})\/(\d{2})/);
                
                if (dateMatch) {
                    const logDate = new Date(Date.UTC(
                        parseInt(dateMatch[1]), 
                        parseInt(dateMatch[2]) - 1,
                        parseInt(dateMatch[3])
                    ));
                    
                    const startDateMidnight = new Date(Date.UTC(
                        startDate.getUTCFullYear(),
                        startDate.getUTCMonth(),
                        startDate.getUTCDate()
                    ));
                    const endDateMidnight = new Date(Date.UTC(
                        endDate.getUTCFullYear(),
                        endDate.getUTCMonth(),
                        endDate.getUTCDate()
                    ));
                    
                    if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true') {
                        if (name.includes('y=2025')) {  // Only log 2025 files for debugging
                            console.error(`[DATE FILTER] Checking: ${name}`);
                            console.error(`  Log date: ${logDate.toISOString().split('T')[0]}`);
                            console.error(`  Filter range: ${startDateMidnight.toISOString().split('T')[0]} to ${endDateMidnight.toISOString().split('T')[0]}`);
                        }
                    }
                    
                    if (logDate < startDateMidnight || logDate > endDateMidnight) {
                        filesSkippedByDate++;
                        continue;
                    }
                } else {
                    filesSkippedNoDate++;
                    continue;
                }
            }
            
            // Filter for actual log files
            if (!name.endsWith('.log') && !name.endsWith('.txt') && !name.endsWith('.json')) {
                filesSkippedNotLog++;
                continue;
            }
            
            filteredLogs.push({
                name: name,
                url: `${baseUrl}/${name}?${sasToken}`,
                size: log.size,
                lastModified: log.lastModified
            });
        }
        
        // Sort by name (most recent first)
        filteredLogs.sort((a, b) => b.name.localeCompare(a.name));
        
        // Log summary
        if ((startDate && endDate) || dateFilter) {
            if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true' || filteredLogs.length === 0) {
                console.error(`\n[LOG FILTER SUMMARY]`);
                console.error(`  Total files in container: ${totalFilesChecked}`);
                console.error(`  Files skipped (outside date range): ${filesSkippedByDate}`);
                console.error(`  Files with no date pattern: ${filesSkippedNoDate}`);
                console.error(`  Files skipped (definitely not logs): ${filesSkippedNotLog}`);
                console.error(`  Files included in download: ${filteredLogs.length}`);
                
                // If no files found, show sample of what was in the container
                if (filteredLogs.length === 0 && allLogs.length > 0) {
                    console.error(`\n[SAMPLE OF SKIPPED FILES]:`);
                    allLogs.slice(0, 5).forEach(log => {
                        console.error(`  - ${log.name}`);
                    });
                    if (allLogs.length > 5) {
                        console.error(`  ... and ${allLogs.length - 5} more files`);
                    }
                }
            }
        }
        
        return filteredLogs;
    }
    
    /**
     * Parse XML response from Azure Storage listing
     * DEPRECATED: Replaced by filterLogsByDate which handles pagination
     */
    static parseLogListXml_DEPRECATED(xml, sasUrl, dateFilterObj) {
        const logs = [];
        const baseUrl = sasUrl.split('?')[0];
        const sasToken = sasUrl.split('?')[1];
        
        // Extract filter parameters
        const dateFilter = dateFilterObj?.filter;
        const startDate = dateFilterObj?.startDate;
        const endDate = dateFilterObj?.endDate;
        
        // Match all log entries
        const logMatches = xml.matchAll(/<Blob>[\s\S]*?<\/Blob>/g);
        
        // Tracking for debug
        let totalFilesChecked = 0;
        let filesSkippedByDate = 0;
        let filesSkippedNoDate = 0;
        let filesSkippedNotLog = 0;
        
        for (const match of logMatches) {
            totalFilesChecked++;
            const blobXml = match[0];
            
            // Extract log name
            const nameMatch = blobXml.match(/<Name>(.*?)<\/Name>/);
            if (!nameMatch) continue;
            
            const name = nameMatch[1];
            
            // Extract size
            const sizeMatch = blobXml.match(/<Content-Length>(\d+)<\/Content-Length>/);
            const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
            
            // Apply date filter if specified
            if (dateFilter) {
                // Date filter can be: YYYY/MM/DD, YYYY-MM-DD, or partial like YYYY/MM
                const filterPattern = dateFilter.replace(/-/g, '/');
                if (!name.includes(filterPattern)) {
                    continue;
                }
            }
            
            // Apply date range filter if specified
            if (startDate && endDate) {
                // Extract date from the log file path
                // Log paths use convention: y=2025/m=08/d=30/h=03/m=00/filename.log
                // Or older format: 2025/08/30/03/filename.log
                const dateMatch = name.match(/y=(\d{4})\/m=(\d{1,2})\/d=(\d{1,2})/) || 
                                  name.match(/(\d{4})\/(\d{2})\/(\d{2})/);
                
                if (dateMatch) {
                    // Create date at midnight UTC for comparison
                    const logDate = new Date(Date.UTC(
                        parseInt(dateMatch[1]), 
                        parseInt(dateMatch[2]) - 1, // Month is 0-based
                        parseInt(dateMatch[3])
                    ));
                    
                    // Create comparison dates at midnight UTC
                    const startDateMidnight = new Date(Date.UTC(
                        startDate.getUTCFullYear(),
                        startDate.getUTCMonth(),
                        startDate.getUTCDate()
                    ));
                    const endDateMidnight = new Date(Date.UTC(
                        endDate.getUTCFullYear(),
                        endDate.getUTCMonth(),
                        endDate.getUTCDate()
                    ));
                    
                    // Debug logging for date filtering - always log to understand filtering
                    if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true') {
                        console.error(`[DATE FILTER] Checking: ${name}`);
                        console.error(`  Log date: ${logDate.toISOString().split('T')[0]}`);
                        console.error(`  Filter range: ${startDateMidnight.toISOString().split('T')[0]} to ${endDateMidnight.toISOString().split('T')[0]}`);
                        console.error(`  Start comparison: ${logDate.getTime()} < ${startDateMidnight.getTime()} = ${logDate < startDateMidnight}`);
                        console.error(`  End comparison: ${logDate.getTime()} > ${endDateMidnight.getTime()} = ${logDate > endDateMidnight}`);
                    }
                    
                    // Check if log date is within range (inclusive)
                    if (logDate < startDateMidnight || logDate > endDateMidnight) {
                        if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true') {
                            console.error(`  SKIPPED: Outside date range`);
                        }
                        filesSkippedByDate++;
                        continue;
                    } else {
                        if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true') {
                            console.error(`  INCLUDED: Within date range`);
                        }
                    }
                } else {
                    // If we have a date filter but can't extract a date from the file path,
                    // skip this file (it's likely not a log file from the expected time period)
                    if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true') {
                        console.error(`[DATE FILTER] Skipping file without date pattern: ${name}`);
                    }
                    filesSkippedNoDate++;
                    continue;
                }
            }
            
            // Filter for actual log files (skip directories)
            if (!name.endsWith('.log') && !name.endsWith('.txt') && !name.endsWith('.json')) {
                filesSkippedNotLog++;
                continue;
            }
            
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
        
        // Log filtering summary if date filter was applied
        if ((startDate && endDate) || dateFilter) {
            if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true' || logs.length === 0) {
                console.error(`\n[DATE FILTER SUMMARY]`);
                console.error(`  Total files checked: ${totalFilesChecked}`);
                console.error(`  Files skipped (outside date range): ${filesSkippedByDate}`);
                console.error(`  Files skipped (no date pattern): ${filesSkippedNoDate}`);
                console.error(`  Files skipped (not log files): ${filesSkippedNotLog}`);
                console.error(`  Files included: ${logs.length}`);
                if (startDate && endDate) {
                    console.error(`  Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
                }
            }
        }
        
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
    
    /**
     * Format duration in seconds to human-readable string
     */
    static formatDuration(seconds) {
        if (seconds < 60) return `${seconds} seconds`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes`;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }

    /**
     * Process date filters from various input formats
     * Important: Azure logs are in UTC, but users think in local time
     * This function handles timezone conversion automatically
     */
    static processDateFilters(args) {
        // Detect user's timezone offset
        const userTimezoneOffset = new Date().getTimezoneOffset(); // in minutes
        const userTimezoneHours = -userTimezoneOffset / 60; // Negative because getTimezoneOffset returns opposite sign
        
        // Allow explicit timezone specification
        let timezoneOffset = userTimezoneHours;
        if (args.timezone) {
            // Support common timezone formats: "EST", "PST", "UTC", "-5", "+8"
            const tzMap = {
                'UTC': 0, 'GMT': 0,
                'EST': -5, 'EDT': -4,
                'CST': -6, 'CDT': -5,  
                'MST': -7, 'MDT': -6,
                'PST': -8, 'PDT': -7,
                'CET': 1, 'CEST': 2
            };
            
            if (tzMap[args.timezone.toUpperCase()] !== undefined) {
                timezoneOffset = tzMap[args.timezone.toUpperCase()];
            } else if (args.timezone.match(/^[+-]?\d+$/)) {
                timezoneOffset = parseInt(args.timezone);
            }
        }
        
        // Log timezone info for debugging
        if (process.env.DEBUG) {
            OutputLogger.info(`🕐 User timezone: UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset}`);
        }
        
        // Handle daysBack parameter
        if (args.daysBack !== undefined && args.daysBack !== null) {
            const days = parseInt(args.daysBack);
            // CRITICAL FIX: Use midnight UTC for date calculations to match PowerShell behavior
            // Previous bug: Used current time instead of midnight, causing logs to be missed
            const now = new Date();
            
            // End date is end of today UTC (23:59:59.999)
            const endDate = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                23, 59, 59, 999
            ));
            
            let startDate;
            
            // Handle special cases
            if (days === 0) {
                // daysBack: 0 means today only (midnight to end of day)
                startDate = new Date(Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    0, 0, 0, 0
                ));
                const todayStr = startDate.toISOString().split('T')[0].replace(/-/g, '/');
                return {
                    filter: null,
                    startDate: startDate,
                    endDate: endDate,
                    description: `Today only (${todayStr})`
                };
            } else if (days === 1) {
                // daysBack: 1 means today's logs (midnight to end of day)
                startDate = new Date(Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    0, 0, 0, 0
                ));
                const todayStr = startDate.toISOString().split('T')[0].replace(/-/g, '/');
                
                return {
                    filter: null,
                    startDate: startDate,
                    endDate: endDate,
                    description: `Today (${todayStr})`
                };
            } else {
                // daysBack: N means last N days (including today)
                // Start at midnight UTC N-1 days ago
                startDate = new Date(Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate() - days + 1,  // Include today, so -days+1
                    0, 0, 0, 0
                ));
            }
            
            // Format dates as YYYY/MM/DD
            const startStr = startDate.toISOString().split('T')[0].replace(/-/g, '/');
            const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '/');
            
            // For multiple days, we'll need to filter by date range
            // Azure blob storage doesn't have built-in date range filtering,
            // so we return a filter that can be used in listLogs
            return {
                filter: null, // Will need to filter after listing
                startDate: startDate,
                endDate: endDate,
                description: `Last ${days} days (${startStr} to ${endStr})`
            };
        }
        
        // Handle date range
        if (args.startDate && args.endDate) {
            // Parse dates and convert to UTC midnight/end-of-day
            const [startYear, startMonth, startDay] = args.startDate.replace(/\//g, '-').split('-').map(Number);
            const [endYear, endMonth, endDay] = args.endDate.replace(/\//g, '-').split('-').map(Number);
            
            const startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0, 0));
            const endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999));
            
            // No timezone adjustment needed - we're using UTC dates directly
            
            return {
                filter: null, // Will need to filter after listing
                startDate: startDate,
                endDate: endDate,
                description: `${args.startDate} to ${args.endDate}`
            };
        }
        
        // Handle single date filter
        if (args.dateFilter) {
            // For single date, convert to UTC date range for the full day
            const [year, month, day] = args.dateFilter.replace(/\//g, '-').split('-').map(Number);
            const startDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
            const endDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
            
            return {
                filter: null, // Use date range instead
                startDate: startDate,
                endDate: endDate,
                description: `${args.dateFilter}`
            };
        }
        
        return null;
    }
}

module.exports = LogDownloadTools;