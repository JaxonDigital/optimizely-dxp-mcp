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
            
            // Resolve project configuration
            const resolved = ProjectTools.resolveCredentials(args);
            if (!resolved.success || !resolved.credentials) {
                return ResponseBuilder.invalidParams('Missing required project configuration (apiKey, apiSecret, or projectId)');
            }
            
            const projectConfig = resolved.credentials;
            const projectName = resolved.project ? resolved.project.name : 'Unknown';
            
            // Apply resolved config to args
            Object.assign(args, projectConfig);
            
            // Get list of available containers to check what's actually available
            const containersResult = await StorageTools.handleListStorageContainers(args);
            const containers = this.extractContainerList(containersResult);
            
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
            OutputLogger.info(`📁 Container: ${containerName}`);
            
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
            
            const downloadPath = validated.path;
            OutputLogger.info(`📂 Download path: ${downloadPath}`);
            
            // List and download logs
            OutputLogger.info('📋 Listing available log files...');
            if (process.env.DEBUG === 'true' && dateFilter) {
                console.error(`Date filter being applied:`, dateFilter);
            }
            const logs = await this.listLogs(sasUrl, dateFilter || { filter: args.dateFilter });
            
            if (logs.length === 0) {
                // Special handling for Production environment with no logs
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
                
                OutputLogger.info(confirmMessage);
                OutputLogger.info('\n⚠️  **Download Confirmation Required**');
                OutputLogger.info('Please review the above details and confirm you want to proceed.');
                OutputLogger.info('\nTo proceed with download, say:');
                OutputLogger.info('   "Yes" or "Yes, download the logs"');
                OutputLogger.info('\nAdditional options:');
                OutputLogger.info('   To use a different folder: "Download to /your/preferred/path"');
                OutputLogger.info('   To filter by date: "Download logs from 2025/08/24"');
                OutputLogger.info('   To cancel: Say "No" or ignore this message');
                
                return ResponseBuilder.success(
                    'Log download preview complete. See options above to proceed or cancel.'
                );
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
            
            OutputLogger.info(`📥 Starting download of ${logs.length} log files...`);
            
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
            const containersResult = await StorageTools.handleListStorageContainers({
                ...args,
                ...projectConfig
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
            
            // If no standard containers, check App Service Insights containers
            if (availableLogTypes.length === 0) {
                for (const [logType, containerName] of Object.entries(this.APP_SERVICE_CONTAINERS)) {
                    if (containers.includes(containerName)) {
                        availableLogTypes.push({ logType, containerName });
                    }
                }
            }
            
            if (availableLogTypes.length === 0) {
                return ResponseBuilder.success(`No log containers found in ${args.environment} environment.\n\nAvailable containers:\n${containers.map(c => `• ${c}`).join('\n')}\n\n💡 None of these appear to be standard log containers.`);
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
                OutputLogger.info(`\n📥 Downloading ${logType} logs...`);
                const result = await this.handleDownloadLogs({
                    ...args,
                    logType,
                    containerName,
                    skipConfirmation: true  // Skip individual confirmations
                });
                allResults.push({ logType, result });
            }
            
            // Summarize results
            let summary = `# 📊 All Logs Download Complete\n\n`;
            summary += `Downloaded ${availableLogTypes.length} log types from ${args.environment}:\n\n`;
            for (const { logType, result } of allResults) {
                summary += `• **${logType.charAt(0).toUpperCase() + logType.slice(1)} Logs**: `;
                if (result.content && result.content[0]) {
                    // Extract success/failure from result
                    const text = result.content[0].text;
                    const downloadMatch = text.match(/Downloaded: (\d+) files/);
                    const sizeMatch = text.match(/Total Size: ([\d\.]+ \w+)/);
                    if (downloadMatch) {
                        summary += `${downloadMatch[1]} files`;
                        if (sizeMatch) {
                            summary += ` (${sizeMatch[1]})`;
                        }
                    } else {
                        summary += `Complete`;
                    }
                } else {
                    summary += `Complete`;
                }
                summary += '\n';
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
    static formatLogDownloadConfirmation(logs, totalSize, containerName, logType, environment, downloadPath, dateFilter) {
        let message = `# 📊 Log Download Confirmation\n\n`;
        
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
        message += `• **Total Files**: ${logs.length}\n`;
        message += `• **Total Size**: ${this.formatBytes(totalSize)}\n`;
        if (dateFilter) {
            message += `• **Date Filter**: ${dateFilter}\n`;
        }
        message += `• **Retention**: Logs are kept for 90 days\n\n`;
        
        // Show destination
        message += `## 📁 Destination Folder\n`;
        message += `• **Path**: \`${downloadPath}\`\n\n`;
        
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
    static async listLogs(sasUrl, dateFilterObj) {
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
                        const logs = this.parseLogListXml(data, sasUrl, dateFilterObj);
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
    static parseLogListXml(xml, sasUrl, dateFilterObj) {
        const logs = [];
        const baseUrl = sasUrl.split('?')[0];
        const sasToken = sasUrl.split('?')[1];
        
        // Extract filter parameters
        const dateFilter = dateFilterObj?.filter;
        const startDate = dateFilterObj?.startDate;
        const endDate = dateFilterObj?.endDate;
        
        // Match all log entries
        const logMatches = xml.matchAll(/<Blob>[\s\S]*?<\/Blob>/g);
        
        for (const match of logMatches) {
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
                    
                    // Debug logging for date filtering
                    if (process.env.DEBUG === 'true') {
                        console.error(`Date filter check: ${name}`);
                        console.error(`  Log date: ${logDate.toISOString().split('T')[0]}`);
                        console.error(`  Range: ${startDateMidnight.toISOString().split('T')[0]} to ${endDateMidnight.toISOString().split('T')[0]}`);
                    }
                    
                    // Check if log date is within range (inclusive)
                    if (logDate < startDateMidnight || logDate > endDateMidnight) {
                        continue;
                    }
                } else {
                    // If we have a date filter but can't extract a date from the file path,
                    // skip this file (it's likely not a log file from the expected time period)
                    if (process.env.DEBUG === 'true') {
                        console.error(`Skipping file without date pattern: ${name}`);
                    }
                    continue;
                }
            }
            
            // Filter for actual log files (skip directories)
            if (!name.endsWith('.log') && !name.endsWith('.txt') && !name.endsWith('.json')) {
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
            const endDate = new Date();
            const startDate = new Date();
            
            // Handle special cases
            if (days === 0) {
                // daysBack: 0 means today only
                const todayStr = endDate.toISOString().split('T')[0].replace(/-/g, '/');
                return {
                    filter: null,
                    startDate: new Date(endDate.toDateString()), // Today at midnight
                    endDate: endDate, // Today at current time
                    description: `Today only (${todayStr})`
                };
            } else if (days === 1) {
                // daysBack: 1 means last 24 hours
                startDate.setDate(startDate.getDate() - 1);
                
                const startStr = startDate.toISOString().split('T')[0].replace(/-/g, '/');
                const endStr = endDate.toISOString().split('T')[0].replace(/-/g, '/');
                
                return {
                    filter: null,
                    startDate: startDate,
                    endDate: endDate,
                    description: `Last 24 hours (${startStr} to ${endStr})`
                };
            } else {
                // daysBack: N means last N days (including today)
                startDate.setDate(startDate.getDate() - days + 1);
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
            // Parse dates as user's local dates
            const startDate = new Date(args.startDate.replace(/\//g, '-') + 'T00:00:00');
            const endDate = new Date(args.endDate.replace(/\//g, '-') + 'T23:59:59');
            
            // Adjust for timezone difference if not UTC
            if (timezoneOffset !== 0) {
                // Convert user's local date to UTC
                startDate.setHours(startDate.getHours() - timezoneOffset);
                endDate.setHours(endDate.getHours() - timezoneOffset);
            }
            
            const tzNote = timezoneOffset !== 0 ? ` (adjusted from UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset})` : '';
            
            return {
                filter: null, // Will need to filter after listing
                startDate: startDate,
                endDate: endDate,
                description: `${args.startDate} to ${args.endDate}${tzNote}`
            };
        }
        
        // Handle single date filter
        if (args.dateFilter) {
            // For single date, convert to date range for the full day in user's timezone
            const dateStr = args.dateFilter.replace(/\//g, '-');
            const startDate = new Date(dateStr + 'T00:00:00');
            const endDate = new Date(dateStr + 'T23:59:59');
            
            // Adjust for timezone
            if (timezoneOffset !== 0) {
                startDate.setHours(startDate.getHours() - timezoneOffset);
                endDate.setHours(endDate.getHours() - timezoneOffset);
            }
            
            const tzNote = timezoneOffset !== 0 ? ` (UTC${timezoneOffset >= 0 ? '+' : ''}${timezoneOffset})` : '';
            
            return {
                filter: null, // Use date range instead
                startDate: startDate,
                endDate: endDate,
                description: `${args.dateFilter}${tzNote}`
            };
        }
        
        return null;
    }
}

module.exports = LogDownloadTools;