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
const DownloadConfig = require('../download-config');
const downloadManager = require('../download-manager');
const ManifestManager = require('../manifest-manager');
const ProjectResolutionFix = require('./project-resolution-fix');
const SelfHostedStorage = require('../self-hosted-storage');


class LogDownloadTools {
    // Track recent preview requests to prevent auto-confirmation
    static recentPreviews = new Map(); // key: hash of request params, value: timestamp
    static CONFIRMATION_TIMEOUT = 5000; // 5 seconds minimum between preview and download

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
     * Parse natural language container names to actual container names
     */
    static parseNaturalLanguageContainer(input) {
        if (!input || typeof input !== 'string') return input;
        
        const normalized = input.toLowerCase().trim();
        
        // Map common natural language phrases to container names
        const mappings = {
            // Possible MCP client descriptions
            'application console logs': 'insights-logs-appserviceconsolelogs',
            'http request logs': 'insights-logs-appservicehttplogs',
            // Common variations
            'http logs': 'insights-logs-appservicehttplogs',
            'http': 'insights-logs-appservicehttplogs',
            'web logs': 'insights-logs-appservicehttplogs',
            'web': 'insights-logs-appservicehttplogs',
            'console logs': 'insights-logs-appserviceconsolelogs',
            'console': 'insights-logs-appserviceconsolelogs',
            'app logs': 'insights-logs-appserviceconsolelogs',
            'application logs': 'insights-logs-appserviceconsolelogs',
            'application': 'insights-logs-appserviceconsolelogs',
            'app': 'insights-logs-appserviceconsolelogs'
        };
        
        // Check for exact matches first
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
     * Handle download logs command
     */
    static async handleDownloadLogs(args) {
        console.error('[DXP-20 TEST] handleDownloadLogs called with:', {
            startDateTime: args.startDateTime,
            endDateTime: args.endDateTime,
            hasArgs: !!args
        });
        try {
            // Parse natural language container names
            if (args.containerName) {
                args.containerName = this.parseNaturalLanguageContainer(args.containerName);
                // Don't delete logType - some code paths may check for its existence
                // We'll just ignore it when containerName is specified
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Container specified directly by user');
                    console.error('[DEBUG] Container name:', args.containerName);
                    console.error('[DEBUG] LogType from MCP client:', args.logType);
                    console.error('[DEBUG] LogType will be ignored for container resolution');
                }
            }
            
            // Debug: Log what args we received
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] handleDownloadLogs called with args:', {
                    hasConnectionString: !!args.connectionString,
                    isSelfHosted: args.isSelfHosted,
                    projectName: args.projectName,
                    containerName: args.containerName,
                    logType: args.logType,  // Should be undefined if containerName was specified
                    environment: args.environment,
                    daysBack: args.daysBack,
                    hoursBack: args.hoursBack,
                    minutesBack: args.minutesBack,
                    // DXP-20 ISO 8601 parameters
                    startDateTime: args.startDateTime,
                    endDateTime: args.endDateTime
                });
            }
            
            // Default to production environment for logs
            if (!args.environment) {
                args.environment = 'Production';
            }

            // Resolve project configuration using safe multi-project resolution
            const resolution = ProjectResolutionFix.resolveProjectSafely(args, ProjectTools);
            
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Project resolution result:', {
                    success: resolution.success,
                    source: resolution.source,
                    hasProject: !!resolution.project,
                    projectName: resolution.project?.name,
                    isSelfHosted: resolution.project?.isSelfHosted
                });
                
                // Also debug the configured projects
                const allProjects = ProjectTools.getConfiguredProjects();
                console.error('[DEBUG] All configured projects:', allProjects.map(p => ({
                    name: p.name,
                    projectId: p.projectId,
                    hasLogPath: !!p.logPath
                })));
            }
            
            if (!resolution.success) {
                // Handle multi-project scenario
                if (resolution.requiresSelection) {
                    return ProjectResolutionFix.showProjectSelection(resolution.availableProjects);
                }
                return ResponseBuilder.error(resolution.message || 'Failed to resolve project');
            }
            
            const resolved = {
                success: true,
                credentials: resolution.credentials || resolution.project,
                project: resolution.project
            };
            
            let projectName = resolution.project ? resolution.project.name : 'Unknown';
            
            // CRITICAL FIX: If project name is Unknown, try direct environment variable lookup
            if (projectName === 'Unknown' || !projectName) {
                const envProjectNames = Object.keys(process.env).filter(key => {
                    const value = process.env[key];
                    return value && typeof value === 'string' && 
                           value.includes('id=') && value.includes('key=') && value.includes('secret=');
                });
                
                if (envProjectNames.length === 1) {
                    projectName = envProjectNames[0];
                    OutputLogger.info(`🔧 Fixed project name from 'Unknown' to '${projectName}' via direct env lookup`);
                    
                    // Also fix the project object if it's missing
                    if (!resolution.project) {
                        const envValue = process.env[projectName];
                        const params = {};
                        envValue.split(';').forEach(param => {
                            const equalIndex = param.indexOf('=');
                            if (equalIndex !== -1) {
                                const key = param.substring(0, equalIndex).trim();
                                const value = param.substring(equalIndex + 1).trim();
                                if (key && value) params[key] = value;
                            }
                        });
                        
                        resolution.project = {
                            name: projectName,
                            projectId: params.id,
                            logPath: params.logPath,
                            blobPath: params.blobPath,
                            dbPath: params.dbPath
                        };
                        OutputLogger.info(`🔧 Reconstructed project object with logPath: ${params.logPath}`);
                    }
                }
            }
            
            // VISIBLE DEBUG: Show project resolution details
            OutputLogger.info(`🔍 Project resolution: name="${projectName}", source="${resolution.source || 'unknown'}"`);
            if (resolution.project?.logPath) {
                OutputLogger.info(`📁 Project logPath configured: ${resolution.project.logPath}`);
            } else {
                OutputLogger.info(`⚠️ No logPath found for project "${projectName}"`);
            }
            
            // Check if this is a self-hosted project and handle differently
            if (resolution.project?.isSelfHosted || args.connectionString) {
                OutputLogger.info('🏢 Self-hosted Azure Storage mode detected for log downloads');
                // Ensure we have a proper project object with connectionString
                const project = resolution.project || {
                    name: args.projectName || 'self-hosted',
                    connectionString: args.connectionString,
                    isSelfHosted: true
                };
                return await this.handleSelfHostedLogDownload(args, project);
            }

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
            
            // Store initial values
            let logType = args.logType;
            let containerName = args.containerName;
            
            // Use already resolved project configuration
            const projectConfig = resolved.credentials;
            
            // Apply resolved config to args
            Object.assign(args, projectConfig);
            
            // Get list of available containers to check what's actually available
            OutputLogger.info('🔍 Listing storage containers...');
            const containersResult = await StorageTools.handleListStorageContainers(args);

            // Enhanced debug logging to understand container extraction failure
            if (process.env.DEBUG === 'true' || args.debugContainers) {
                console.error('[DEBUG] Raw containers result type:', typeof containersResult);
                console.error('[DEBUG] Container result keys:', Object.keys(containersResult || {}));

                // Check different response structures
                if (containersResult?.content?.[0]?.text) {
                    const text = containersResult.content[0].text;
                    const lines = text.split('\n').slice(0, 30);
                    console.error('[DEBUG] Container listing (content[0].text):', lines.join('\n'));
                } else if (containersResult?.result?.content?.[0]?.text) {
                    const text = containersResult.result.content[0].text;
                    const lines = text.split('\n').slice(0, 30);
                    console.error('[DEBUG] Container listing (result.content[0].text):', lines.join('\n'));
                } else {
                    console.error('[DEBUG] Unexpected container result structure:', JSON.stringify(containersResult).substring(0, 500));
                }
            }

            const containers = this.extractContainerList(containersResult);

            // Always log extracted containers for debugging
            OutputLogger.info(`📦 Found ${containers.length} containers: ${containers.join(', ')}`);

            if (process.env.DEBUG === 'true' || args.debugContainers) {
                console.error('[DEBUG] Extracted containers:', containers);
            }
            
            if (containers.length === 0) {
                // Enhanced error handling if no containers found
                return ResponseBuilder.error('No storage containers found. This could indicate:\n• Authentication issues\n• Project configuration problems\n• Environment access restrictions\n\nRun "check_permissions" to verify your API key access.');
            }
            
            // Now resolve container from logType if needed (containers list is now available)
            if (!containerName && logType) {
                // For known log types, try to find ANY matching container
                // Use case-insensitive matching for better reliability
                const logTypeLower = logType.toLowerCase();

                if (logTypeLower === 'application' || logTypeLower === 'app') {
                    // Look for any container with console/application logs
                    // Try exact matches first, then fallback to partial matches
                    containerName = containers.find(c => {
                        const lowerC = c.toLowerCase();
                        return lowerC === 'insights-logs-appserviceconsolelogs' ||
                               lowerC === 'azure-application-logs';
                    }) || containers.find(c => {
                        const lowerC = c.toLowerCase();
                        return lowerC.includes('consolelog') ||
                               lowerC.includes('console') ||
                               lowerC.includes('application');
                    });
                } else if (logTypeLower === 'web' || logTypeLower === 'http') {
                    // Look for any container with http/web logs
                    // Try exact matches first, then fallback to partial matches
                    containerName = containers.find(c => {
                        const lowerC = c.toLowerCase();
                        return lowerC === 'insights-logs-appservicehttplogs' ||
                               lowerC === 'azure-web-logs';
                    }) || containers.find(c => {
                        const lowerC = c.toLowerCase();
                        return lowerC.includes('httplog') ||
                               lowerC.includes('http') ||
                               lowerC.includes('web');
                    });
                } else if (logTypeLower === 'cloudflare') {
                    // Look for any container with cloudflare logs
                    containerName = containers.find(c => {
                        const lowerC = c.toLowerCase();
                        return lowerC === 'cloudflarelogpush';
                    }) || containers.find(c => {
                        const lowerC = c.toLowerCase();
                        return lowerC.includes('cloudflare');
                    });
                }
                
                if (!containerName) {
                    // Can't find a matching container - show what's available
                    return this.showAvailableContainers(args, containers, logType);
                }
                
                OutputLogger.info(`📌 Found container for ${logType} logs: ${containerName}`);
            } else if (containerName) {
                // Container specified - derive logType for display only
                if (containerName.includes('console') || containerName.includes('appserviceconsolelogs')) {
                    logType = 'application';
                } else if (containerName.includes('http') || containerName.includes('appservicehttplogs')) {
                    logType = 'web';
                } else if (containerName.includes('cloudflare')) {
                    logType = 'cloudflare';
                }
            } else if (!containerName && !logType) {
                // Nothing specified
                return this.showLogTypeSelection(args);
            }
            
            // Final check if container exists - but trust user-specified containers
            if (!args.containerName && !containers.includes(containerName)) {
                // Only validate against list if we derived the container from logType
                return this.showAvailableContainers(args, containers, logType);
            } else if (args.containerName && !containers.includes(containerName)) {
                // User specified container directly - trust them but warn
                OutputLogger.info(`⚠️  Container "${containerName}" not in visible list - attempting anyway...`);
                OutputLogger.info(`   (Some containers may not be visible due to API permissions)`);
            }
            
            OutputLogger.info(`📊 Downloading ${logType || 'logs'} from ${args.environment} environment...`);
            OutputLogger.info(`📦 Source: ${containerName} container (Azure Storage)`);
            
            // Generate SAS link for the log container
            OutputLogger.info('🔑 Generating SAS link for log container...');
            
            // Only pass essential parameters for SAS generation
            // The credentials have already been resolved and added to args
            // CRITICAL FIX: Use prefetched SAS URL if available (from "download all" command)
            let sasUrl;
            let sasResponse; // Define at outer scope so it's available for error handling

            if (args.prefetchedSasUrl) {
                sasUrl = args.prefetchedSasUrl;
                OutputLogger.info('✨ Using prefetched SAS URL from preview');
            } else {
                const sasArgs = {
                    apiKey: args.apiKey,
                    apiSecret: args.apiSecret,
                    projectId: args.projectId,
                    environment: args.environment,
                    containerName: containerName,
                    permissions: 'Read',
                    expiryHours: 2  // Short-lived for security
                };

                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] SAS args being sent:', {
                        ...sasArgs,
                        apiKey: sasArgs.apiKey ? '[MASKED]' : undefined,
                        apiSecret: sasArgs.apiSecret ? '[MASKED]' : undefined
                    });
                }

                sasResponse = await StorageTools.handleGenerateStorageSasLink(sasArgs);

                // Debug logging for SAS response
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] SAS response structure:', {
                        hasError: !!sasResponse?.error,
                        hasResult: !!sasResponse?.result,
                        hasContent: !!sasResponse?.content,
                        responseType: typeof sasResponse
                    });

                    if (sasResponse?.error) {
                        console.error('[DEBUG] SAS generation failed:', sasResponse.error);
                    } else if (sasResponse?.result?.content?.[0]?.text) {
                        const text = sasResponse.result.content[0].text;
                        console.error('[DEBUG] Response text preview:', text.substring(0, 200));
                        if (text.includes('Permission Denied') || text.includes('does not have access')) {
                            console.error('[DEBUG] Permission error detected in SAS response');
                        } else if (text.includes('SAS URL:') || text.includes('https://')) {
                            console.error('[DEBUG] SAS URL appears to be present');
                        }
                    } else if (sasResponse?.content?.[0]?.text) {
                        // Check alternate response structure
                        const text = sasResponse.content[0].text;
                        console.error('[DEBUG] Alt response text preview:', text.substring(0, 200));
                    }
                }

                sasUrl = this.extractSasUrl(sasResponse);
            }
            
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] SAS URL extraction result:', sasUrl ? 'SUCCESS' : 'FAILED');
                if (!sasUrl && sasResponse) {
                    console.error('[DEBUG] Full response for debugging:', JSON.stringify(sasResponse).substring(0, 500));
                }
            }
            
            if (!sasUrl) {
                let errorMessage = 'Failed to generate SAS link for log container';
                
                // Check if this is a permission issue
                let isPermissionIssue = false;
                
                // Provide more detailed error information
                if (sasResponse && typeof sasResponse === 'object') {
                    if (sasResponse.error) {
                        errorMessage += `\nError: ${sasResponse.error}`;
                        if (sasResponse.error.includes('does not have access') || 
                            sasResponse.error.includes('Permission')) {
                            isPermissionIssue = true;
                        }
                    }
                    if (sasResponse.result && sasResponse.result.content) {
                        const content = sasResponse.result.content[0];
                        if (content && content.text) {
                            if (content.text.includes('does not have access') || 
                                content.text.includes('Permission Denied')) {
                                isPermissionIssue = true;
                            }
                            errorMessage += `\nDetails: ${content.text.substring(0, 200)}...`;
                        }
                    }
                }
                
                if (isPermissionIssue) {
                    return ResponseBuilder.error(
                        `## ❌ Permission Denied\n\n` +
                        `Your API key does not have access to ${args.environment} environment logs.\n\n` +
                        `**Important:** Being able to LIST containers does NOT mean you can ACCESS them.\n` +
                        `• Container listing has cross-environment visibility\n` +
                        `• But downloading requires environment-specific permissions\n\n` +
                        `**Solutions:**\n` +
                        `1. Try Integration environment instead (usually has more permissive access)\n` +
                        `2. Contact your administrator to grant ${args.environment} access to your API key\n` +
                        `3. Use a different API key with ${args.environment} permissions\n\n` +
                        `Run \`check_permissions\` to see which environments you can access.`
                    );
                }
                
                return ResponseBuilder.error(errorMessage + '\n\nThis could indicate:\n• Insufficient permissions for this container\n• Container access restrictions\n• Authentication issues\n\nRun "check_permissions" to verify your access levels.');
            }
            
            // Process date filters (or use prefetched from "download all" command)
            // DXP-20 DEBUG: Log what's happening with date filters
            if (args.prefetchedDateFilter) {
                console.error('[DXP-20] Using prefetched date filter:', {
                    description: args.prefetchedDateFilter.description,
                    startDate: args.prefetchedDateFilter.startDate,
                    endDate: args.prefetchedDateFilter.endDate
                });
            } else {
                console.error('[DXP-20] No prefetched filter, calling processDateFilters with:', {
                    minutesBack: args.minutesBack,
                    hoursBack: args.hoursBack,
                    daysBack: args.daysBack,
                    startDateTime: args.startDateTime,
                    endDateTime: args.endDateTime
                });
            }
            const dateFilter = args.prefetchedDateFilter || this.processDateFilters(args);
            if (dateFilter) {
                OutputLogger.info(`📅 Date filter: ${dateFilter.description}`);
                console.error('[DXP-20] Final date filter being used:', {
                    description: dateFilter.description,
                    startDate: dateFilter.startDate,
                    endDate: dateFilter.endDate
                });
            } else {
                console.error('[DXP-20] WARNING: No date filter! Will download ALL logs');
            }
            
            // Determine download path using validated config
            // VISIBLE DEBUG: Show what project name we're using for path calculation
            OutputLogger.info(`📍 Calculating download path for project: "${projectName}"`);
            
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Download path calculation:');
                console.error('  projectName:', projectName);
                console.error('  args.downloadPath:', args.downloadPath);
                console.error('  args.environment:', args.environment);
            }
            
            // For preview mode, don't create folders - just get the path
            let downloadPath;
            if (args.previewOnly) {
                // CRITICAL FIX DXP-14: Get path without any validation or folder creation for preview
                // Use raw path construction to ensure NO folders are created during preview
                const basePath = await DownloadConfig.getDownloadPath(
                    'logs',
                    projectName,
                    args.downloadPath,
                    args.environment
                );
                const containerSubfolder = this.getContainerSubfolderName(containerName);
                downloadPath = path.join(basePath, containerSubfolder);
                
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Preview mode - path without validation (NO folder creation):');
                    console.error('  basePath:', basePath);
                    console.error('  containerSubfolder:', containerSubfolder);
                    console.error('  downloadPath:', downloadPath);
                    console.error('  IMPORTANT: No folders will be created in preview mode');
                }
            } else {
                // Normal mode - validate and create path
                const validated = await DownloadConfig.getValidatedDownloadPath(
                    'logs',
                    projectName,
                    args.downloadPath,
                    args.environment
                );
                
                if (process.env.DEBUG === 'true') {
                    console.error('[DEBUG] Validated download path result:');
                    console.error('  valid:', validated.valid);
                    console.error('  path:', validated.path);
                    console.error('  error:', validated.error);
                }
                
                if (!validated.valid) {
                    throw new Error(`Invalid download path: ${validated.error}`);
                }
                
                // Add container-specific subfolder for better organization
                // Structure: /logs/project/[container-name]/
                const containerSubfolder = this.getContainerSubfolderName(containerName);
                downloadPath = path.join(validated.path, containerSubfolder);
            }
            
            // Make download path VERY prominent
            OutputLogger.info(`\n${'='.repeat(60)}`);
            OutputLogger.info(`📁 DOWNLOAD LOCATION:`);
            OutputLogger.info(`   ${downloadPath}/`);
            OutputLogger.info(`${'='.repeat(60)}\n`);
            
            // List and download logs
            OutputLogger.info('📋 Listing available log files...');
            
            // CRITICAL FIX: Use prefetched logs if available (from "download all" command)
            // This ensures consistency between preview and actual download
            let logs;
            if (args.prefetchedLogs && args.prefetchedLogs.length > 0) {
                logs = args.prefetchedLogs;
                OutputLogger.info(`✨ Using ${logs.length} prefetched log files from preview`);
            } else {
                // List and download logs with date filtering
                // PERFORMANCE FIX: Ensure we use optimized prefix search by passing proper dateFilter
                if (process.env.DEBUG === 'true') {
                    console.error('[DOWNLOAD PERFORMANCE] Re-scanning for logs without prefetched data');
                    console.error('  dateFilter:', JSON.stringify(dateFilter));
                    console.error('  args.dateFilter:', args.dateFilter);
                }
                logs = await this.listLogs(sasUrl, dateFilter || { filter: args.dateFilter }, containerName);
                if (process.env.DEBUG === 'true') {
                    console.error(`[DOWNLOAD PERFORMANCE] Found ${logs.length} logs for download`);
                }
            }
            
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
                
                // Enhanced message with smart suggestions
                const daysChecked = args.daysBack || 7;
                let message = `No log files found in ${containerName} container`;
                
                // Add timeframe context
                if (daysChecked <= 7) {
                    message += ` (checked last ${daysChecked} days)\n\n`;
                    
                    // If this is a known log container, suggest checking longer timeframe
                    const isKnownLogContainer = containerName && (
                        containerName.includes('log') || 
                        containerName.includes('waf') ||
                        containerName.includes('insights') ||
                        containerName.includes('cloudflare') ||
                        containerName.includes('audit')
                    );
                    
                    if (isKnownLogContainer) {
                        message += `💡 **Try checking a longer timeframe:**\n\n`;
                        message += `This container might have older logs. Try:\n`;
                        message += `\`\`\`\n`;
                        message += `download_logs containerName: "${containerName}", daysBack: 30, previewOnly: true\n`;
                        message += `\`\`\`\n\n`;
                        message += `Or check the last 90 days:\n`;
                        message += `\`\`\`\n`;
                        message += `download_logs containerName: "${containerName}", daysBack: 90, previewOnly: true\n`;
                        message += `\`\`\`\n\n`;
                        
                        // Special note for WAF/archive containers
                        if (containerName.includes('waf') || containerName.includes('security')) {
                            message += `**Note:** WAF and security logs are often archived weekly or monthly, so they might not appear in recent days.\n\n`;
                        }
                    }
                } else {
                    message += ` (checked last ${daysChecked} days)\n\n`;
                    
                    if (daysChecked < 90) {
                        message += `No logs found in the last ${daysChecked} days. You could try:\n`;
                        message += `• Checking a longer timeframe (e.g., 90 days)\n`;
                        message += `• Checking if logging is enabled for this environment\n`;
                        message += `• Contacting Optimizely Support if logs are expected\n\n`;
                    }
                }
                
                // Check if this might be a media/blob container
                if (containerName && !containerName.includes('log') && !containerName.includes('insights') && !containerName.includes('waf')) {
                    message += `💡 **This might not be a log container.**\n\n`;
                    message += `If "${containerName}" contains media files, documents, or other non-log content, try:\n`;
                    message += `\`\`\`\ndownload_blobs containerName: "${containerName}"\n\`\`\`\n\n`;
                    message += `This will download all files regardless of type to your blobs directory.\n`;
                }
                
                return ResponseBuilder.success(message);
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
            
            // Calculate total size and check for file types
            const totalLogSize = logs.reduce((sum, log) => sum + (log.size || 0), 0);
            const logFiles = logs.filter(log => log.fileType === 'log');
            const otherFiles = logs.filter(log => log.fileType === 'other');
            
            // Enhanced debug logging for download process
            if (process.env.DEBUG === 'true') {
                console.error('[DEBUG] Log download details:');
                console.error(`  - Total files found: ${logs.length}`);
                console.error(`  - Standard log files: ${logFiles.length}`);
                console.error(`  - Other files: ${otherFiles.length}`);
                console.error(`  - Container: ${containerName}`);
                console.error(`  - Log type: ${logType}`);
                console.error(`  - Environment: ${args.environment}`);
                console.error(`  - Download path: ${downloadPath}`);
                console.error(`  - Skip confirmation: ${args.skipConfirmation}`);
                console.error(`  - Preview only: ${args.previewOnly}`);
                console.error(`  - First log: ${logs[0]?.name || 'none'}`);
                console.error(`  - Last log: ${logs[logs.length - 1]?.name || 'none'}`);
            }
            
            // Check for incremental download opportunities BEFORE showing preview
            let incrementalInfo = null;
            const incremental = args.incremental !== false && !args.forceFullDownload;
            
            if (incremental) {
                const manifestCheck = await ManifestManager.getFilesToDownload(
                    downloadPath,
                    logs.map(log => ({
                        name: log.name,
                        size: log.size,
                        lastModified: log.lastModified,
                        url: log.url
                    }))
                );
                
                if (manifestCheck.skippedFiles.length > 0) {
                    incrementalInfo = {
                        skippedFiles: manifestCheck.skippedFiles.length,
                        toDownload: manifestCheck.filesToDownload.length,
                        skippedSize: manifestCheck.skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0),
                        manifest: manifestCheck.manifest
                    };
                }
            }
            
            // Show preview by default unless explicitly skipped
            // DEBUG: Log the condition values
            if (process.env.DEBUG === 'true') {
                console.error('[PREVIEW DEBUG] Preview condition check:');
                console.error('  skipConfirmation:', args.skipConfirmation);
                console.error('  force:', args.force);
                console.error('  isPartOfBatch:', args.isPartOfBatch);
                console.error('  should show preview:', (!args.skipConfirmation && !args.force && !args.isPartOfBatch));
            }
            
            // Preview only mode - check this FIRST before skipConfirmation
            if (args.previewOnly) {
                // Track this preview request
                const previewKey = JSON.stringify({
                    container: containerName,
                    env: args.environment,
                    start: args.startDateTime,
                    end: args.endDateTime
                });
                this.recentPreviews.set(previewKey, Date.now());

                // Clean up old previews
                for (const [key, timestamp] of this.recentPreviews.entries()) {
                    if (Date.now() - timestamp > 60000) { // Remove after 1 minute
                        this.recentPreviews.delete(key);
                    }
                }

                const previewMessage = this.formatLogDownloadConfirmation(
                    logs,
                    totalLogSize,
                    containerName,
                    logType,
                    args.environment,
                    downloadPath,
                    dateFilter,  // Use processed dateFilter, not args.dateFilter
                    incrementalInfo
                );
                
                // Return success indicating task is COMPLETE - AI should not proceed
                const previewComplete = `${previewMessage}\n\n` +
                    '---\n\n' +
                    '📋 **Preview Complete - Awaiting User Decision**\n\n' +
                    '⚠️ **STOP - DO NOT PROCEED WITHOUT USER CONFIRMATION** ⚠️\n\n' +
                    '**AI ASSISTANTS MUST:**\n' +
                    '1. ✅ Show this preview to the user\n' +
                    '2. ❓ ASK: "Would you like to proceed with downloading these files?"\n' +
                    '3. ⏸️ WAIT for explicit user confirmation\n' +
                    '4. ❌ NOT automatically call download with skipConfirmation: true\n\n' +
                    '**HUMAN USER:** Please confirm if you want to download these files.\n\n' +
                    '**VIOLATION WARNING:** Proceeding without user confirmation violates MCP protocol.';
                
                // Return success but with CONFIRMATION_REQUIRED marker
                return ResponseBuilder.success('⏸️ AWAITING USER CONFIRMATION\n\n' + previewComplete);
            }

            // Check if skipConfirmation is being used too quickly after a preview
            if (args.skipConfirmation && !args.isPartOfBatch) {
                const previewKey = JSON.stringify({
                    container: containerName,
                    env: args.environment,
                    start: args.startDateTime,
                    end: args.endDateTime
                });

                const previewTime = this.recentPreviews.get(previewKey);
                if (previewTime && (Date.now() - previewTime) < this.CONFIRMATION_TIMEOUT) {
                    const waitTime = Math.ceil((this.CONFIRMATION_TIMEOUT - (Date.now() - previewTime)) / 1000);
                    return ResponseBuilder.error(
                        'TOO_FAST',
                        `⚠️ Auto-confirmation detected and blocked!\n\n` +
                        `A preview was just shown ${Math.round((Date.now() - previewTime) / 1000)} seconds ago.\n` +
                        `Please wait ${waitTime} more seconds before confirming.\n\n` +
                        `This safety mechanism prevents accidental auto-confirmations.\n` +
                        `If you are a human user who wants to proceed, please wait a moment and try again.`,
                        'Confirmation attempted too quickly after preview'
                    );
                }
            }

            if (!args.skipConfirmation && !args.force && !args.isPartOfBatch) {
                const confirmMessage = this.formatLogDownloadConfirmation(
                    logs,
                    totalLogSize,
                    containerName,
                    logType,
                    args.environment,
                    downloadPath,
                    dateFilter,  // Use processed dateFilter, not args.dateFilter
                    incrementalInfo  // Pass incremental info to preview
                );
                
                // Return the preview with confirmation instructions directly in response
                const fullResponse = confirmMessage + 
                    '\n⚠️  **Download Confirmation Required**\n\n' +
                    'Please review the above details and confirm you want to proceed.\n\n' +
                    '**To confirm download:** Please explicitly confirm if you want to proceed with this download\n\n' +
                    '**Additional options available:**\n' +
                    '   • Use different folder by specifying downloadPath\n' +
                    '   • Filter by date using startDate/endDate\n' +
                    '   • Force full download with forceFullDownload: true\n' +
                    '   • Cancel: Simply ignore this message\n';
                
                // Return success indicating WAITING FOR USER - AI should not proceed
                const waitingForUser = `${fullResponse}\n\n` +
                    '---\n\n' +
                    '⏸️ **WAITING FOR USER CONFIRMATION**\n\n' +
                    '**IMPORTANT FOR AI ASSISTANTS:**\n' +
                    '• STOP HERE. Do not take any further action.\n' +
                    '• Do NOT automatically add skipConfirmation: true.\n' +
                    '• The human user must explicitly request to proceed.\n' +
                    '• Your task is to wait for human input.\n\n' +
                    '**For the human user:** If you want to proceed with this download, please explicitly confirm.';
                
                // Return success with confirmation message
                return ResponseBuilder.success(waitingForUser);
            }
            
            // Use incremental info from preview if available, otherwise check now
            let skippedFiles = [];
            let logsToDownload = logs;
            
            if (!incrementalInfo) {
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
            } else {
                // Use pre-calculated incremental info from preview
                skippedFiles = incrementalInfo.skippedFiles || [];
                if (incrementalInfo.filesToDownload) {
                    logsToDownload = incrementalInfo.filesToDownload.map(f => {
                        const originalLog = logs.find(l => l.name === f.name);
                        return originalLog || f;
                    });
                }
                
                if (incrementalInfo.skippedFiles && incrementalInfo.skippedFiles > 0) {
                    OutputLogger.info(`✨ Smart download: Skipping ${incrementalInfo.skippedFiles} unchanged log files`);
                    OutputLogger.info(`   Bandwidth saved: ${ManifestManager.formatBytes(incrementalInfo.skippedSize || 0)}`);
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
            
            const BATCH_SIZE = 5; // Download 5 files in parallel
            
            // Process logs in batches for parallel downloading
            for (let i = 0; i < logsToDownload.length; i += BATCH_SIZE) {
                const batch = logsToDownload.slice(i, Math.min(i + BATCH_SIZE, logsToDownload.length));
                
                // Download batch in parallel
                const batchPromises = batch.map(async (log) => {
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
                        
                        return { success: true, size };
                    } catch (error) {
                        failedCount++;
                        OutputLogger.error(`❌ Failed to download: ${log.name} - ${error.message}`);
                        return { success: false, error: error.message };
                    }
                });
                
                // Wait for batch to complete
                const results = await Promise.all(batchPromises);
                
                // Log batch progress
                const batchSuccess = results.filter(r => r.success).length;
                OutputLogger.info(`📦 Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${batchSuccess}/${batch.length} files completed`);
            }
            
            // Save manifest for future incremental downloads
            if (incrementalInfo && downloadedCount > 0) {
                await ManifestManager.saveManifest(downloadPath, incrementalInfo.manifest);
                OutputLogger.info('📝 Manifest updated for future incremental downloads');
            }
            
            // Check for sparse logging - use actual time range requested
            let daysRequested = args.daysBack || 7;
            let isSparseLogging = false;

            // If specific start/end times provided, calculate actual range
            if (args.startDateTime && args.endDateTime) {
                const startDate = new Date(args.startDateTime);
                const endDate = new Date(args.endDateTime);
                const rangeHours = (endDate - startDate) / (1000 * 60 * 60);
                const rangeDays = rangeHours / 24;

                // For short time ranges (< 1 day), don't trigger sparse logging warning
                if (rangeDays < 1) {
                    // For sub-day ranges, expect at least 1 file per few hours
                    const expectedFiles = Math.max(1, Math.ceil(rangeHours / 6)); // 1 file per 6 hours minimum
                    isSparseLogging = downloadedCount > 0 && downloadedCount < expectedFiles && rangeHours > 1;
                } else {
                    daysRequested = Math.ceil(rangeDays);
                    isSparseLogging = downloadedCount > 0 && downloadedCount < daysRequested;
                }
            } else {
                isSparseLogging = downloadedCount > 0 && downloadedCount < daysRequested;
            }
            
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
     * Handle log downloads for self-hosted Azure Storage projects
     */
    static async handleSelfHostedLogDownload(args, project) {
        try {
            const connectionString = project?.connectionString || args.connectionString;
            if (!connectionString) {
                return ResponseBuilder.error('Self-hosted project detected but no connection string found');
            }
            
            OutputLogger.info('📊 Self-hosted log download starting...');
            
            // List containers using self-hosted storage
            const containers = await SelfHostedStorage.listContainers(connectionString);
            
            // Filter for log containers (insights-logs-* pattern)
            const logContainers = containers.filter(c => 
                c.name.includes('insights-logs-') || 
                c.name.includes('application-logs') ||
                c.name.includes('web-logs') ||
                c.name.includes('cloudflare')
            );
            
            if (logContainers.length === 0) {
                return ResponseBuilder.success(
                    `📊 **No Log Containers Found**\n\n` +
                    `No Application Insights log containers were found in this self-hosted storage account.\n\n` +
                    `Available containers:\n` +
                    containers.map(c => `• ${c.name}`).join('\n') +
                    `\n\nLog containers typically have names like:\n` +
                    `• insights-logs-appserviceconsolelogs\n` +
                    `• insights-logs-appservicehttplogs\n` +
                    `• azure-application-logs\n` +
                    `• azure-web-logs`
                );
            }
            
            // If no specific container requested, show options
            if (!args.containerName && !args.logType) {
                return ResponseBuilder.success(
                    `📊 **Available Log Containers**\n\n` +
                    `Found ${logContainers.length} log container(s):\n\n` +
                    logContainers.map((c, i) => `${i + 1}. 📦 ${c.name}`).join('\n') +
                    `\n\n**To download logs:**\n` +
                    `• Specify a container: \`download logs containerName: "${logContainers[0].name}"\`\n` +
                    `• Download all logs: \`download logs logType: "all"\``
                );
            }
            
            // Determine which container to download from
            let targetContainer = args.containerName;
            
            if (!targetContainer && args.logType) {
                // Map log type to container
                if (args.logType === 'all') {
                    // Download from all log containers
                    return await this.downloadFromAllSelfHostedContainers(connectionString, logContainers, args, project);
                } else if (args.logType === 'application' || args.logType === 'app') {
                    targetContainer = logContainers.find(c => 
                        c.name.includes('appserviceconsolelogs') || 
                        c.name.includes('application-logs')
                    )?.name;
                } else if (args.logType === 'web') {
                    targetContainer = logContainers.find(c => 
                        c.name.includes('appservicehttplogs') || 
                        c.name.includes('web-logs')
                    )?.name;
                }
            }
            
            if (!targetContainer) {
                return ResponseBuilder.error(
                    `Could not find container for log type: ${args.logType}\n` +
                    `Available containers: ${logContainers.map(c => c.name).join(', ')}`
                );
            }
            
            // Download from the specific container
            return await this.downloadFromSelfHostedContainer(connectionString, targetContainer, args, project);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'self-hosted-log-download', args);
        }
    }
    
    /**
     * Download logs from a self-hosted container
     */
    static async downloadFromSelfHostedContainer(connectionString, containerName, args, project) {
        try {
            // Get download path
            const downloadPath = await DownloadConfig.getDownloadPath(
                'logs',
                project.name,
                args.downloadPath,
                'self-hosted'
            );
            
            // Create container-specific subfolder
            const containerSubfolder = this.getContainerSubfolderName(containerName);
            const finalPath = path.join(downloadPath, containerSubfolder);
            
            // Make download location VERY prominent (same as standard DXP)
            OutputLogger.info(`\n${'='.repeat(60)}`);
            OutputLogger.info(`📁 DOWNLOAD LOCATION:`);
            OutputLogger.info(`   ${finalPath}/`);
            OutputLogger.info(`${'='.repeat(60)}\n`);
            OutputLogger.info(`📦 Container: ${containerName}`);
            
            // Parse connection string and build SAS URL for container listing
            const parsedConnection = SelfHostedStorage.parseConnectionString(connectionString);
            
            if (process.env.DEBUG === 'true') {
                console.error(`[SELF-HOSTED] Parsed connection:`, {
                    accountName: parsedConnection.accountName,
                    hasKey: !!parsedConnection.accountKey,
                    endpointSuffix: parsedConnection.endpointSuffix
                });
            }
            
            const sasUrl = SelfHostedStorage.buildListUrl({
                ...parsedConnection,
                containerName
            });
            
            if (process.env.DEBUG === 'true') {
                // Log URL without exposing the SAS token
                const urlParts = sasUrl.split('?');
                console.error(`[SELF-HOSTED] List URL: ${urlParts[0]}?[SAS_TOKEN]`);
            }
            
            // List and filter logs (or use prefetched from "download all" command)
            const dateFilter = args.prefetchedDateFilter || this.processDateFilters(args);
            
            if (process.env.DEBUG === 'true') {
                console.error(`[SELF-HOSTED] Listing logs with date filter:`, dateFilter);
                // Also list without filter to see what's actually in the container
                const allLogsUnfiltered = await this.listLogs(sasUrl, {}, containerName);
                console.error(`[SELF-HOSTED] Total files in container (unfiltered): ${allLogsUnfiltered.length}`);
                if (allLogsUnfiltered.length > 0) {
                    console.error(`[SELF-HOSTED] Sample file names:`);
                    for (let i = 0; i < Math.min(5, allLogsUnfiltered.length); i++) {
                        console.error(`  - ${allLogsUnfiltered[i].name}`);
                    }
                }
            }
            
            // CRITICAL FIX: Use prefetched logs if available (from "download all" command)
            let logs;
            if (args.prefetchedLogs && args.prefetchedLogs.length > 0) {
                logs = args.prefetchedLogs;
                OutputLogger.info(`✨ Using ${logs.length} prefetched log files from preview`);
            } else {
                logs = await this.listLogs(sasUrl, dateFilter || {}, containerName);
            }
            
            if (process.env.DEBUG === 'true') {
                console.error(`[SELF-HOSTED] Found ${logs.length} logs in container ${containerName}`);
                if (logs.length > 0) {
                    console.error(`[SELF-HOSTED] First log: ${logs[0].name}`);
                    console.error(`[SELF-HOSTED] Last log: ${logs[logs.length - 1].name}`);
                }
            }
            
            if (logs.length === 0) {
                // Provide more helpful error message
                let message = `📊 **No Logs Found**\n\n`;
                message += `Container: ${containerName}\n`;
                if (dateFilter) {
                    message += `Date filter: ${dateFilter.description}\n\n`;
                    message += `**Troubleshooting:**\n`;
                    message += `• Logs might be outside the date range\n`;
                    message += `• Try removing daysBack parameter to see all logs\n`;
                    message += `• Check console output for file samples (if DEBUG=true)\n`;
                } else {
                    message += `No date filter applied\n\n`;
                    message += `**Possible issues:**\n`;
                    message += `• Container might be empty\n`;
                    message += `• Logs might have unexpected file extensions\n`;
                }
                message += `\n**To diagnose:** Set DEBUG=true to see what files are in the container`;
                return ResponseBuilder.success(message);
            }
            
            // Calculate total size for preview
            const totalLogSize = logs.reduce((sum, log) => sum + (log.size || 0), 0);
            
            // Check for incremental download opportunities BEFORE showing preview
            let incrementalInfo = null;
            const incremental = args.incremental !== false && !args.forceFullDownload;
            
            if (incremental) {
                const manifestCheck = await ManifestManager.getFilesToDownload(
                    finalPath,
                    logs.map(log => ({
                        name: log.name,
                        size: log.size || 0,
                        lastModified: log.lastModified || null,
                        source: containerName
                    }))
                );
                
                if (manifestCheck.skippedFiles.length > 0) {
                    incrementalInfo = {
                        skippedFiles: manifestCheck.skippedFiles.length,
                        toDownload: manifestCheck.filesToDownload.length,
                        skippedSize: manifestCheck.skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0),
                        manifest: manifestCheck.manifest,
                        filesToDownload: manifestCheck.filesToDownload,
                        skippedFilesList: manifestCheck.skippedFiles
                    };
                }
            }
            
            // Show preview by default unless explicitly skipped
            // Only skip if force=true OR explicitly skipPreview=true OR skipConfirmation=true
            
            // DEBUG: Log the condition values for self-hosted
            if (process.env.DEBUG === 'true') {
                console.error('[SELF-HOSTED PREVIEW DEBUG] Preview condition check:');
                console.error('  previewOnly:', args.previewOnly);
                console.error('  force:', args.force);
                console.error('  skipPreview:', args.skipPreview);
                console.error('  skipConfirmation:', args.skipConfirmation);
                console.error('  should show preview:', args.previewOnly || (!args.force && !args.skipPreview && !args.skipConfirmation));
            }
            
            // Preview only mode - check this FIRST before skipConfirmation
            if (args.previewOnly) {
                const preview = this.formatLogDownloadConfirmation(
                    logs,
                    totalLogSize,
                    containerName,
                    args.logType || 'logs',
                    args.environment || 'self-hosted',
                    finalPath,
                    dateFilter,
                    incrementalInfo
                );
                
                // Return success indicating task is COMPLETE - AI should not proceed
                const previewComplete = `${preview}\n\n` +
                    '---\n\n' +
                    '📋 **Preview Complete - Awaiting User Decision**\n\n' +
                    '⚠️ **STOP - DO NOT PROCEED WITHOUT USER CONFIRMATION** ⚠️\n\n' +
                    '**AI ASSISTANTS MUST:**\n' +
                    '1. ✅ Show this preview to the user\n' +
                    '2. ❓ ASK: "Would you like to proceed with downloading these files?"\n' +
                    '3. ⏸️ WAIT for explicit user confirmation\n' +
                    '4. ❌ NOT automatically call download with skipConfirmation: true\n\n' +
                    '**HUMAN USER:** Please confirm if you want to download these files.\n\n' +
                    '**VIOLATION WARNING:** Proceeding without user confirmation violates MCP protocol.';
                
                // Return success but with CONFIRMATION_REQUIRED marker
                return ResponseBuilder.success('⏸️ AWAITING USER CONFIRMATION\n\n' + previewComplete);
            }
            
            // Show preview unless explicitly skipped (same as DXP downloads)
            if (!args.skipConfirmation && !args.force && !args.isPartOfBatch) {
                const confirmMessage = this.formatLogDownloadConfirmation(
                    logs,
                    totalLogSize,
                    containerName,
                    args.logType || 'logs',
                    args.environment || 'self-hosted',
                    finalPath,
                    dateFilter,
                    incrementalInfo
                );
                
                // Return the preview with STOP signals to prevent auto-acceptance
                const fullResponse = confirmMessage + 
                    '\n⚠️  **Download Confirmation Required**\n\n' +
                    'Please review the above details and confirm you want to proceed.\n\n' +
                    '**To confirm download:** Please explicitly confirm if you want to proceed with this download\n\n' +
                    '**Additional options available:**\n' +
                    '   • Use different folder by specifying downloadPath\n' +
                    '   • Filter by date using startDate/endDate\n' +
                    '   • Force full download with forceFullDownload: true\n' +
                    '   • Cancel: Simply ignore this message\n';
                
                // Return success indicating WAITING FOR USER - AI should not proceed
                const waitingForUser = `${fullResponse}\n\n` +
                    '---\n\n' +
                    '⏸️ **WAITING FOR USER CONFIRMATION**\n\n' +
                    '**IMPORTANT FOR AI ASSISTANTS:**\n' +
                    '• STOP HERE. Do not take any further action.\n' +
                    '• Do NOT automatically add skipConfirmation: true.\n' +
                    '• The human user must explicitly request to proceed.\n' +
                    '• Your task is to wait for human input.\n\n' +
                    '**For the human user:** If you want to proceed with this download, please explicitly confirm.';
                
                // Return success with confirmation message
                return ResponseBuilder.success(waitingForUser);
            }
            
            // Determine which files to download based on incremental info
            let logsToDownload = logs;
            if (incrementalInfo && incrementalInfo.filesToDownload) {
                logsToDownload = incrementalInfo.filesToDownload.map(f => {
                    const originalLog = logs.find(l => l.name === f.name);
                    return originalLog || f;
                });
                
                if (incrementalInfo.skippedFiles > 0) {
                    OutputLogger.info(`✨ Smart download: Skipping ${incrementalInfo.skippedFiles} unchanged log files`);
                    OutputLogger.info(`   Bandwidth saved: ${ManifestManager.formatBytes(incrementalInfo.skippedSize)}`);
                }
            }
            
            // Download the logs
            OutputLogger.info(`📥 Starting download of ${logsToDownload.length} log files...`);
            
            const downloadId = downloadManager.registerDownload({
                projectName: project.name,
                containerName,
                environment: 'self-hosted',
                totalFiles: logsToDownload.length,
                dateRange: dateFilter?.description || 'all'
            });
            
            let downloadedCount = 0;
            let totalSize = 0;
            const BATCH_SIZE = 5; // Download 5 files in parallel
            
            // Process logs in batches for parallel downloading
            for (let i = 0; i < logsToDownload.length; i += BATCH_SIZE) {
                const batch = logsToDownload.slice(i, Math.min(i + BATCH_SIZE, logsToDownload.length));
                
                // Download batch in parallel
                const batchPromises = batch.map(async (log) => {
                    const localPath = path.join(finalPath, log.name);
                    await fs.mkdir(path.dirname(localPath), { recursive: true });
                    
                    // Build download URL for the blob
                    const blobUrl = SelfHostedStorage.buildBlobUrl({
                        ...parsedConnection,
                        containerName
                    }, log.name);
                    
                    try {
                        const size = await this.downloadLogFile(blobUrl, localPath, log.name);
                        downloadedCount++;
                        totalSize += size;
                        
                        // Update progress after each file
                        downloadManager.updateProgress(downloadId, {
                            filesCompleted: downloadedCount,
                            bytesDownloaded: totalSize
                        });
                        
                        OutputLogger.info(`✓ Downloaded ${log.name} (${this.formatBytes(size)})`);
                        
                        // Add to manifest for future incremental downloads
                        if (incrementalInfo && incrementalInfo.manifest) {
                            ManifestManager.addFileToManifest(incrementalInfo.manifest, log.name, {
                                size: size,
                                lastModified: log.lastModified || new Date().toISOString(),
                                source: containerName
                            });
                        }
                        
                        return { success: true, size };
                    } catch (error) {
                        OutputLogger.error(`✗ Failed to download ${log.name}: ${error.message}`);
                        return { success: false, error: error.message };
                    }
                });
                
                // Wait for batch to complete before starting next batch
                const results = await Promise.all(batchPromises);
                
                // Log batch progress
                const batchSuccess = results.filter(r => r.success).length;
                OutputLogger.info(`📦 Batch ${Math.floor(i/BATCH_SIZE) + 1}: ${batchSuccess}/${batch.length} files downloaded`);
            }
            
            downloadManager.completeDownload(downloadId);
            
            return ResponseBuilder.success(
                `✅ **Log Download Complete**\n\n` +
                `**Container:** ${containerName}\n` +
                `**Files Downloaded:** ${downloadedCount}\n` +
                `**Total Size:** ${(totalSize / (1024 * 1024)).toFixed(2)} MB\n` +
                `**Location:** ${finalPath}/\n\n` +
                `Logs are organized by date and ready for analysis.`
            );
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'self-hosted-container-download', args);
        }
    }
    
    /**
     * Download from all self-hosted log containers
     */
    static async downloadFromAllSelfHostedContainers(connectionString, containers, args, project) {
        // Show preview if not explicitly skipped
        if (!args.skipConfirmation && !args.force) {
            // Get base download path
            const basePath = await DownloadConfig.getDownloadPath(
                'logs',
                project.name,
                args.downloadPath,
                'self-hosted'
            );
            
            let preview = `⛔ **STOP - USER CONFIRMATION REQUIRED** ⛔\n\n`;
            preview += `# 📊 Download All Logs Preview\n\n`;
            preview += `**Project:** ${project.name} (self-hosted)\n`;
            preview += `**Containers to process:** ${containers.length}\n\n`;
            
            preview += `## 📁 Download Locations:\n`;
            for (const container of containers) {
                const subfolder = this.getContainerSubfolderName(container.name);
                const fullPath = path.join(basePath, subfolder);
                preview += `• **${container.friendlyName || container.name}**\n`;
                preview += `  → ${fullPath}/\n\n`;
            }
            
            preview += `## ⚠️ Download Confirmation Required\n\n`;
            preview += `Please review the above details and confirm you want to proceed.\n\n`;
            preview += `**To confirm download:** Please explicitly confirm if you want to proceed with this download\n\n`;
            preview += `**Additional options available:**\n`;
            preview += `   • Use different folder by specifying downloadPath\n`;
            preview += `   • Filter by date using startDate/endDate\n`;
            preview += `   • Force full download with forceFullDownload: true\n`;
            preview += `   • Cancel: Simply ignore this message\n\n`;
            preview += `---\n\n`;
            preview += `⏸️ **WAITING FOR USER CONFIRMATION**\n\n`;
            preview += `**IMPORTANT FOR AI ASSISTANTS:**\n`;
            preview += `• STOP HERE. Do not take any further action.\n`;
            preview += `• Do NOT automatically add skipConfirmation: true.\n`;
            preview += `• The human user must explicitly request to proceed.\n`;
            preview += `• Your task is to wait for human input.\n\n`;
            preview += `**For the human user:** If you want to proceed with this download, please explicitly confirm.`;

            // Return success with confirmation requirement
            return ResponseBuilder.success(preview);
        }
        
        const results = [];
        let totalFilesDownloaded = 0;
        let totalSizeDownloaded = 0;
        const containersWithLogs = [];
        const emptyContainers = [];
        
        for (const container of containers) {
            OutputLogger.info(`\n📦 Processing container: ${container.name}`);
            const result = await this.downloadFromSelfHostedContainer(
                connectionString, 
                container.name, 
                { ...args, skipPreview: true }, // Skip individual previews when downloading all
                project
            );
            
            // Extract stats from the result text
            if (result && result.result && result.result.content && result.result.content[0]) {
                const text = result.result.content[0].text;
                const filesMatch = text.match(/Files Downloaded:\*\*?\s*(\d+)/);
                const sizeMatch = text.match(/Total Size:\*\*?\s*([\d.]+)\s*MB/);
                
                const filesDownloaded = filesMatch ? parseInt(filesMatch[1]) : 0;
                const sizeDownloaded = sizeMatch ? parseFloat(sizeMatch[1]) : 0;
                
                if (filesDownloaded > 0) {
                    containersWithLogs.push({
                        name: container.name,
                        files: filesDownloaded,
                        sizeMB: sizeDownloaded
                    });
                    totalFilesDownloaded += filesDownloaded;
                    totalSizeDownloaded += sizeDownloaded;
                } else {
                    emptyContainers.push(container.name);
                }
            }
            
            results.push(result);
        }
        
        // Build detailed summary with download paths
        const basePath = await DownloadConfig.getDownloadPath(
            'logs',
            project.name,
            args.downloadPath,
            'self-hosted'
        );
        
        let summary = `✅ **All Logs Download Complete**\n\n`;
        summary += `**Project:** ${project.name} (self-hosted)\n`;
        summary += `**Containers Processed:** ${containers.length}\n\n`;
        
        if (totalFilesDownloaded > 0) {
            summary += `**Downloaded:**\n`;
            for (const container of containersWithLogs) {
                const subfolder = this.getContainerSubfolderName(container.name);
                const fullPath = path.join(basePath, subfolder);
                summary += `• ${container.name}: ${container.files} files (${container.sizeMB.toFixed(2)} MB)\n`;
                summary += `  📁 Location: ${fullPath}/\n`;
            }
            summary += `\n**Total:** ${totalFilesDownloaded} files (${totalSizeDownloaded.toFixed(2)} MB)\n`;
        }
        
        if (emptyContainers.length > 0) {
            summary += `\n**Empty Containers:**\n`;
            for (const container of emptyContainers) {
                summary += `• ${container}\n`;
            }
        }
        
        if (totalFilesDownloaded === 0) {
            summary += `\n⚠️ **No logs found in any container for the specified time range.**\n`;
            summary += `Try extending the time range with \`daysBack: 7\` or check a different environment.`;
        }
        
        return ResponseBuilder.success(summary);
    }
    
    /**
     * Cache for storing preview data to ensure consistency between preview and download
     * Key is hash of project+environment+timerange, value is containersWithLogs data
     * Entries expire after 5 minutes
     */
    static previewCache = new Map();

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

            // DXP-26 FIX: Create a cache key for this request to ensure consistency
            const cacheKey = JSON.stringify({
                projectId: projectConfig.projectId,
                environment: args.environment,
                hoursBack: args.hoursBack,
                minutesBack: args.minutesBack,
                daysBack: args.daysBack,
                startDateTime: args.startDateTime,
                endDateTime: args.endDateTime
            });

            // Clean up old cache entries (older than 5 minutes)
            const now = Date.now();
            for (const [key, value] of this.previewCache.entries()) {
                if (now - value.timestamp > 5 * 60 * 1000) {
                    this.previewCache.delete(key);
                }
            }
            
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
            
            // Find which log containers are available - look for any container with log-related names
            const availableLogTypes = [];
            
            if (process.env.DEBUG === 'true') {
                console.error(`[DEBUG] All containers found: ${containers.join(', ')}`);
            }
            
            // Find containers that look like log containers
            if (process.env.DEBUG === 'true') {
                console.error(`[DEBUG] Total containers found: ${containers.length}`);
                console.error(`[DEBUG] Container names:`, containers);
            }
            
            for (const container of containers) {
                let logType = null;
                
                // Determine log type from container name
                if (container.includes('console') || container.includes('application') || 
                    container === 'azure-application-logs' || container === 'insights-logs-appserviceconsolelogs') {
                    logType = 'application';
                } else if (container.includes('http') || container.includes('web') || 
                           container === 'azure-web-logs' || container === 'insights-logs-appservicehttplogs') {
                    logType = 'web';
                } else if (container.includes('cloudflare')) {
                    logType = 'cloudflare';
                } else if (container.includes('log')) {
                    // Generic log container
                    logType = 'logs';
                }
                
                if (logType && !availableLogTypes.some(lt => lt.containerName === container)) {
                    availableLogTypes.push({ logType, containerName: container });
                }
            }
            
            if (availableLogTypes.length === 0) {
                // Enhanced message when no logs found
                let message = `## ⚠️ No Logs Found in ${args.environment}\n\n`;
                message += `**Looking for containers with**: log, console, application, http, web, cloudflare\n\n`;
                
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
            
            // DXP-26 FIX: Check cache first if we're in download mode (skipConfirmation=true)
            // This ensures we use the exact same data from the preview
            let containersWithLogs;
            let fromCache = false;

            if (args.skipConfirmation && this.previewCache.has(cacheKey)) {
                const cached = this.previewCache.get(cacheKey);
                containersWithLogs = cached.data;
                fromCache = true;
                OutputLogger.info('✨ Using cached preview data for consistency');
                OutputLogger.info(`📊 Found ${containersWithLogs.length} container(s) with logs from preview`);
            } else {
                // CRITICAL FIX: Check containers ONCE before any preview/download logic
                // This ensures consistency between preview and actual download
                OutputLogger.info('🔍 Checking which containers have logs...');

            // OPTIMIZATION: Check all containers in PARALLEL for faster preview
            const containerCheckPromises = availableLogTypes.map(async ({ logType, containerName }) => {
                try {
                    if (process.env.DEBUG === 'true') {
                        console.error(`[PARALLEL] Starting check for ${containerName}`);
                    }

                    // Generate SAS link to check if container has logs
                    const sasResponse = await StorageTools.handleGenerateStorageSasLink({
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret,
                        projectId: projectConfig.projectId,
                        environment: args.environment,
                        containerName: containerName,
                        permissions: 'Read',
                        expiryHours: 1
                    });
                    
                    const sasUrl = this.extractSasUrl(sasResponse);
                    if (sasUrl) {
                        // Get actual logs with date filtering for accurate counts and sizes
                        // DXP-20: Pass all supported time parameters
                        console.error('[DXP-20 ALL LOGS] About to call processDateFilters with:', {
                            startDateTime: args.startDateTime,
                            endDateTime: args.endDateTime,
                            minutesBack: args.minutesBack,
                            hoursBack: args.hoursBack,
                            daysBack: args.daysBack
                        });
                        const dateFilter = this.processDateFilters({
                            daysBack: args.daysBack,
                            hoursBack: args.hoursBack,
                            minutesBack: args.minutesBack,
                            startDate: args.startDate,
                            endDate: args.endDate,
                            dateFilter: args.dateFilter,
                            // DXP-20: ISO 8601 datetime fields
                            startDateTime: args.startDateTime,
                            endDateTime: args.endDateTime
                        });
                        console.error('[DXP-20 ALL LOGS] dateFilter result:', dateFilter);

                        // OPTIMIZATION: For preview mode, use smart limits based on time range
                        // For actual download, we need ALL files to ensure complete download
                        const isPreviewMode = args.previewOnly === true;
                        const isShowingPreview = !args.skipConfirmation && !args.force;
                        let quickCheckLimit = null;

                        // Apply limit for preview OR when we're going to show a preview (not direct download)
                        if ((isPreviewMode || isShowingPreview) && dateFilter && dateFilter.startDate && dateFilter.endDate) {
                            // Calculate time range in hours
                            const rangeMs = dateFilter.endDate.getTime() - dateFilter.startDate.getTime();
                            const rangeHours = rangeMs / (1000 * 60 * 60);

                            // For narrow time ranges, we don't need to check thousands of files
                            // Assume max 100 logs per hour (generous for most apps)
                            if (rangeHours <= 1) {
                                quickCheckLimit = 500;  // 30 min - 1 hour: check first 500
                            } else if (rangeHours <= 24) {
                                quickCheckLimit = 2500; // 1-24 hours: check first 2500
                            } else {
                                quickCheckLimit = 5000; // >24 hours: check first page
                            }

                            if (process.env.DEBUG === 'true') {
                                console.error(`[PREVIEW OPTIMIZATION] Time range: ${rangeHours.toFixed(1)} hours, checking first ${quickCheckLimit} files in ${containerName}`);
                            }
                        }

                        const logs = await this.listLogs(sasUrl, dateFilter, containerName, quickCheckLimit);
                        if (logs && logs.length > 0) {
                            // Calculate total size for this container
                            const totalSize = logs.reduce((sum, log) => sum + (log.size || 0), 0);

                            // CRITICAL FIX: For download phase, we need ALL logs, not just the preview subset
                            // Store both limited logs for preview AND fetch full logs for download
                            let allLogsForDownload = logs;
                            if (quickCheckLimit && logs.length >= quickCheckLimit) {
                                // We hit the limit, so there are likely more files
                                // For download, we need to fetch ALL logs without the limit
                                if (process.env.DEBUG === 'true') {
                                    console.error(`[DOWNLOAD FIX] Preview found ${logs.length} files (limit: ${quickCheckLimit}), fetching ALL files for download...`);
                                }
                                allLogsForDownload = await this.listLogs(sasUrl, dateFilter, containerName, null);
                                if (process.env.DEBUG === 'true') {
                                    console.error(`[DOWNLOAD FIX] Full scan found ${allLogsForDownload.length} files (was ${logs.length} in preview)`);
                                }
                            }

                            const result = {
                                logType,
                                containerName,
                                logCount: logs.length,
                                totalSize: totalSize,
                                logs: allLogsForDownload,  // Store ALL logs for download
                                sasUrl: sasUrl,  // Store SAS URL to avoid regenerating
                                dateFilter: dateFilter  // Store date filter for consistency
                            };

                            if (process.env.DEBUG === 'true') {
                                console.error(`[PARALLEL] ✅ ${containerName}: ${logs.length} files found`);
                            }
                            return result;
                        } else {
                            if (process.env.DEBUG === 'true') {
                                console.error(`[PARALLEL] ⚠️ ${containerName}: No logs found`);
                            }
                            return null;
                        }
                    } else {
                        if (process.env.DEBUG === 'true') {
                            console.error(`[PARALLEL] ❌ ${containerName}: Failed to get SAS link`);
                        }
                        return null;
                    }
                } catch (error) {
                    if (process.env.DEBUG === 'true') {
                        console.error(`[PARALLEL] ❌ ${containerName}: Error - ${error.message}`);
                    }
                    return null;
                }
            });

                // Wait for all container checks to complete in parallel
                const startTime = Date.now();
                const containerResults = await Promise.all(containerCheckPromises);
                const checkDuration = ((Date.now() - startTime) / 1000).toFixed(1);

                // Filter out null results and collect containers with logs
                containersWithLogs = containerResults.filter(result => result !== null);

                OutputLogger.info(`✅ Container check completed in ${checkDuration}s`);
                for (const container of containersWithLogs) {
                    OutputLogger.info(`  📦 ${container.containerName}: ${container.logCount} files (${this.formatBytes(container.totalSize)})`);
                }

                // DXP-26 FIX: Cache the results for consistency between preview and download
                // This ensures the actual download uses the exact same data shown in the preview
                this.previewCache.set(cacheKey, {
                    data: containersWithLogs,
                    timestamp: Date.now()
                });
            }
            
            // Check if any containers have logs
            if (containersWithLogs.length === 0) {
                // Determine what time range was actually checked
                let timeRangeStr = '';
                // DXP-20: Include datetime parameters in the time range display
                if (args.startDateTime && args.endDateTime) {
                    timeRangeStr = `${args.startDateTime} to ${args.endDateTime}`;
                } else if (args.minutesBack) {
                    timeRangeStr = `${args.minutesBack} minute${args.minutesBack !== 1 ? 's' : ''}`;
                } else if (args.hoursBack) {
                    timeRangeStr = `${args.hoursBack} hour${args.hoursBack !== 1 ? 's' : ''}`;
                } else if (args.daysBack) {
                    timeRangeStr = `${args.daysBack} day${args.daysBack !== 1 ? 's' : ''}`;
                } else {
                    timeRangeStr = '7 days';
                }

                let message = `## ⚠️ No Logs Found\n\n`;
                message += `Checked ${availableLogTypes.length} container(s) but none contain logs for ${timeRangeStr}.\n\n`;
                message += `**Containers checked:**\n`;
                for (const { containerName } of availableLogTypes) {
                    message += `• ${containerName} - Empty\n`;
                }
                message += `\n**Try:**\n`;
                message += `• Different time range: \`download all logs with daysBack: 30\`\n`;
                message += `• Different environment: \`download all logs from Integration\`\n`;
                return ResponseBuilder.success(message);
            }
            
            // DEBUG: Log the condition values for download all
            if (process.env.DEBUG === 'true') {
                console.error('[DOWNLOAD ALL] Container check results:');
                console.error('  Containers with logs:', containersWithLogs.length);
                console.error('  previewOnly:', args.previewOnly);
                console.error('  skipConfirmation:', args.skipConfirmation);
                console.error('  force:', args.force);
            }
            
            // Now decide whether to show preview or proceed with download
            if (args.previewOnly || (!args.skipConfirmation && !args.force)) {
                // Show preview
                let message = `# 📊 Download All Logs Preview\n\n`;
                
                message += `## 📋 Containers with Logs\n`;
                message += `Found logs in ${containersWithLogs.length} container${containersWithLogs.length !== 1 ? 's' : ''}:\n\n`;
                
                // Calculate overall totals
                const overallTotalFiles = containersWithLogs.reduce((sum, c) => sum + c.logCount, 0);
                const overallTotalSize = containersWithLogs.reduce((sum, c) => sum + c.totalSize, 0);
                
                message += `**📊 Overall Summary:**\n`;
                message += `• **Total Files**: ${overallTotalFiles}\n`;
                message += `• **Total Size**: ${this.formatBytes(overallTotalSize)}\n`;
                
                // Determine time range display
                let timeRangeStr = '';
                // DXP-20: Check for datetime parameters first
                console.error('[DXP-20 TIME DISPLAY] Checking parameters for time range display:', {
                    startDateTime: args.startDateTime,
                    endDateTime: args.endDateTime,
                    hoursBack: args.hoursBack,
                    minutesBack: args.minutesBack,
                    daysBack: args.daysBack
                });
                if (args.startDateTime && args.endDateTime) {
                    timeRangeStr = `${args.startDateTime} to ${args.endDateTime}`;
                } else if (args.hoursBack) {
                    timeRangeStr = `Last ${args.hoursBack} hour${args.hoursBack !== 1 ? 's' : ''}`;
                } else if (args.minutesBack) {
                    timeRangeStr = `Last ${args.minutesBack} minute${args.minutesBack !== 1 ? 's' : ''}`;
                } else if (args.daysBack) {
                    timeRangeStr = `Last ${args.daysBack} day${args.daysBack !== 1 ? 's' : ''} (${args.daysBack * 24} hours)`;
                } else {
                    timeRangeStr = `Last 7 days (168 hours)`;  // Default
                }
                message += `• **Time Range**: ${timeRangeStr}\n\n`;
                
                // Check for incremental download opportunities for ALL containers
                let totalSkippedFiles = 0;
                let totalFilesToDownload = 0;
                let totalSkippedSize = 0;
                const incremental = args.incremental !== false && !args.forceFullDownload;
                
                // Show where each will be downloaded
                for (const container of containersWithLogs) {
                    const { logType, containerName, logCount, totalSize } = container;
                    const containerSubfolder = this.getContainerSubfolderName(containerName);
                    const basePath = await DownloadConfig.getDownloadPath('logs', projectName, args.downloadPath, args.environment);
                    const fullPath = path.join(basePath, containerSubfolder);
                    
                    message += `### ${logType.charAt(0).toUpperCase() + logType.slice(1)} Logs\n`;
                    message += `• Container: ${containerName}\n`;
                    message += `• Files: ${logCount}\n`;
                    message += `• Size: ${this.formatBytes(totalSize)}\n`;
                    message += `• Download to: ${fullPath}/\n`;
                    
                    // Check incremental for this container
                    if (incremental && container.logs) {
                        try {
                            // Use the logs we already fetched
                            const logs = container.logs;
                            
                            const manifestCheck = await ManifestManager.getFilesToDownload(
                                fullPath,
                                logs.map(log => ({
                                    name: log.name,
                                    size: log.size || 0,
                                    lastModified: log.lastModified || null,
                                    source: containerName
                                }))
                            );
                            
                            if (manifestCheck.skippedFiles.length > 0) {
                                const skippedSize = manifestCheck.skippedFiles.reduce((sum, f) => sum + (f.size || 0), 0);
                                message += `• ✨ **Smart Download**: ${manifestCheck.skippedFiles.length} files already up-to-date (${this.formatBytes(skippedSize)} saved)\n`;
                                totalSkippedFiles += manifestCheck.skippedFiles.length;
                                totalFilesToDownload += manifestCheck.filesToDownload.length;
                                totalSkippedSize += skippedSize;
                            } else {
                                totalFilesToDownload += logs.length;
                            }
                        } catch (error) {
                            // If incremental check fails, count all files as needing download
                            totalFilesToDownload += logCount;
                        }
                    } else if (!incremental) {
                        totalFilesToDownload += logCount;
                    }
                    
                    if (logType === 'application') {
                        message += `• Contains: Application errors, stack traces, custom logging\n`;
                    } else if (logType === 'web') {
                        message += `• Contains: HTTP requests, response codes, traffic data\n`;
                    } else if (logType === 'cloudflare') {
                        message += `• Contains: CDN cache stats, security events\n`;
                    }
                    message += '\n';
                }
                
                // Show overall incremental summary if applicable
                if (incremental && totalSkippedFiles > 0) {
                    message += `## ✨ Smart Incremental Download Summary\n`;
                    message += `• **Files already up-to-date**: ${totalSkippedFiles}\n`;
                    message += `• **Files to download**: ${totalFilesToDownload}\n`;
                    message += `• **Bandwidth saved**: ${this.formatBytes(totalSkippedSize)}\n\n`;
                }
                
                message += `## ⚠️ Download Confirmation Required\n\n`;
                message += `Please review the above details and confirm you want to proceed.\n\n`;
                message += `**To confirm download:** Please explicitly confirm if you want to proceed with this download\n\n`;
                message += `**Additional options available:**\n`;
                message += `   • Use different folder by specifying downloadPath\n`;
                message += `   • Filter by date using startDate/endDate\n`;
                message += `   • Force full download with forceFullDownload: true\n`;
                message += `   • Cancel: Simply ignore this message\n\n`;
                
                message += `Or download specific types:\n`;
                for (const { logType } of containersWithLogs) {
                    message += `• \`"download ${logType} logs from ${args.environment}"\`\n`;
                }
                
                // If previewOnly mode, return success indicating task is COMPLETE
                if (args.previewOnly) {
                    const previewComplete = `${message}\n\n` +
                        '---\n\n' +
                        '📋 **Preview Complete - Awaiting User Decision**\n\n' +
                        '⚠️ **STOP - DO NOT PROCEED WITHOUT USER CONFIRMATION** ⚠️\n\n' +
                        '**AI ASSISTANTS MUST:**\n' +
                        '1. ✅ Show this preview to the user\n' +
                        '2. ❓ ASK: "Would you like to proceed with downloading these files?"\n' +
                        '3. ⏸️ WAIT for explicit user confirmation\n' +
                        '4. ❌ NOT automatically call download with skipConfirmation: true\n\n' +
                        '**HUMAN USER:** Please confirm if you want to download these files.\n\n' +
                        '**VIOLATION WARNING:** Proceeding without user confirmation violates MCP protocol.';
                    
                    // Return success but with CONFIRMATION_REQUIRED marker
                return ResponseBuilder.success('⏸️ AWAITING USER CONFIRMATION\n\n' + previewComplete);
                }
                
                // Otherwise, require confirmation - return success indicating WAITING FOR USER
                const waitingForUser = `${message}\n\n` +
                    '---\n\n' +
                    '⏸️ **WAITING FOR USER CONFIRMATION**\n\n' +
                    '**IMPORTANT FOR AI ASSISTANTS:**\n' +
                    '• STOP HERE. Do not take any further action.\n' +
                    '• Do NOT automatically add skipConfirmation: true.\n' +
                    '• The human user must explicitly request to proceed.\n' +
                    '• Your task is to wait for human input.\n\n' +
                    '**For the human user:** If you want to proceed with this download, please explicitly confirm.';
                
                // Return success with confirmation message
                return ResponseBuilder.success(waitingForUser);
            }
            
            // CRITICAL FIX: Use the containers we already checked above
            // No need to check again - we already have the data in containersWithLogs
            
            // Download each log type that has logs
            let allResults = [];
            OutputLogger.info(`🚀 Starting download of ${containersWithLogs.length} log container(s)...`);
            
            // Use containersWithLogs which already has all the data we need
            for (const container of containersWithLogs) {
                const { logType, containerName, logs, sasUrl, dateFilter } = container;
                // Show what's being downloaded and where
                const containerSubfolder = this.getContainerSubfolderName(containerName);
                // Use DownloadConfig to respect project logPath settings
                const basePath = await DownloadConfig.getDownloadPath('logs', projectName, args.downloadPath, args.environment);
                const fullPath = path.join(basePath, containerSubfolder);
                
                OutputLogger.info(`\n📥 Downloading ${logType} logs...`);
                OutputLogger.info(`💾 Saving to: ${fullPath}/ (${containerSubfolder} subfolder)`);
                OutputLogger.info(`🕐 Time range: ${args.hoursBack ? `${args.hoursBack} hour(s)` : 'default'}`);
                
                const startTime = Date.now();
                OutputLogger.info(`⏱️  Started at: ${new Date().toLocaleTimeString()}`);
                
                try {
                    // Add timeout to prevent hanging
                    const downloadPromise = this.handleDownloadLogs({
                        ...args,
                        // Don't pass logType when we have containerName to avoid conflicts
                        containerName,
                        downloadPath: fullPath,  // Use the path we calculated
                        skipConfirmation: true,  // Skip individual confirmations
                        isPartOfBatch: true,     // Flag to indicate this is part of "all" download
                        // CRITICAL: Pass the logs we already fetched to avoid re-fetching
                        prefetchedLogs: logs,
                        prefetchedSasUrl: sasUrl,
                        prefetchedDateFilter: dateFilter
                    });
                    
                    // 5-minute timeout for each container
                    const timeoutPromise = new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Download timeout for ${logType} logs`)), 5 * 60 * 1000)
                    );
                    
                    const result = await Promise.race([downloadPromise, timeoutPromise]);
                    
                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    OutputLogger.info(`✅ Completed ${logType} logs in ${duration}s`);
                    
                    allResults.push({ logType, result });
                } catch (error) {
                    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
                    OutputLogger.error(`❌ Failed ${logType} logs after ${duration}s: ${error.message}`);
                    allResults.push({ 
                        logType, 
                        result: ResponseBuilder.error(`Failed to download ${logType} logs: ${error.message}`) 
                    });
                }
            }
            
            // Summarize results - properly handle empty log scenarios
            let actualDownloadCount = 0;
            let totalFilesDownloaded = 0;
            
            // Build detailed results for each log type
            const detailedResults = [];
            let totalSkippedFiles = 0;
            let totalSkippedSize = 0;
            
            for (const { logType, result } of allResults) {
                const resultDetails = { logType, status: 'unknown', files: 0, skipped: 0, size: '0 B' };
                
                if (result.content && result.content[0]) {
                    const text = result.content[0].text;
                    
                    // Check for different result patterns (handle both bold and plain formats)
                    const downloadMatch = text.match(/(?:\*\*)?Downloaded:(?:\*\*)? (\d+) files/);
                    const skippedMatch = text.match(/(?:\*\*)?Skipped \(unchanged\):(?:\*\*)? (\d+) files/);
                    const sizeMatch = text.match(/(?:\*\*)?Total Size:(?:\*\*)? ([\d\.]+ \w+)/);
                    const noLogsMatch = text.match(/No Logs Found|No log files found|empty for the last \d+ days/i);
                    const errorMatch = text.match(/Permission Denied|Access denied|403|Forbidden|Failed to generate SAS link/i);
                    
                    if (errorMatch) {
                        // This is an error, not "no logs"
                        resultDetails.status = 'error';
                        resultDetails.error = errorMatch[0];
                        if (process.env.DEBUG === 'true') {
                            console.error(`[DEBUG] Error downloading ${logType}: ${errorMatch[0]}`);
                        }
                    } else if (downloadMatch) {
                        resultDetails.files = parseInt(downloadMatch[1]);
                        resultDetails.size = sizeMatch ? sizeMatch[1] : 'unknown';
                        resultDetails.status = resultDetails.files > 0 ? 'success' : 'empty';
                        if (resultDetails.files > 0) {
                            actualDownloadCount++;
                            totalFilesDownloaded += resultDetails.files;
                        }
                        
                        // Also capture skipped files if present
                        if (skippedMatch) {
                            resultDetails.skipped = parseInt(skippedMatch[1]);
                            totalSkippedFiles += resultDetails.skipped;
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
            
            // Check if there were errors
            const errorResults = detailedResults.filter(r => r.status === 'error');
            const hasErrors = errorResults.length > 0;
            
            // Generate appropriate summary based on actual results
            let summary;
            if (hasErrors) {
                // There were permission/access errors
                summary = `## ❌ Download Failed - Permission/Access Error\n\n`;
                summary += `**Containers attempted**: ${availableLogTypes.map(t => t.containerName).join(', ')}\n`;
                summary += `**Errors encountered**:\n`;
                for (const error of errorResults) {
                    summary += `• ${error.logType}: ${error.error || 'Unknown error'}\n`;
                }
                summary += `\n### 🔧 Troubleshooting:\n`;
                summary += `1. **Check API permissions** - Run \`test_connection\` to verify access\n`;
                summary += `2. **Verify environment access** - Your API key may not have ${args.environment} access\n`;
                summary += `3. **Try Integration environment** - \`download logs from Integration\`\n`;
                summary += `4. **Check project configuration** - Ensure correct project is selected\n\n`;
                summary += `If you believe you should have access, contact your administrator.\n`;
            } else if (actualDownloadCount === 0) {
                summary = `## ⚠️ No Logs Found in ${args.environment}\n\n`;
                summary += `**Containers checked**: ${availableLogTypes.map(t => t.containerName).join(', ')}\n`;
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
                let daysRequested = args.daysBack || 7;
                let expectedMinFiles = daysRequested; // At least 1 file per day is reasonable
                let isSparseLogging = false;

                // If specific start/end times provided, calculate actual range
                if (args.startDateTime && args.endDateTime) {
                    const startDate = new Date(args.startDateTime);
                    const endDate = new Date(args.endDateTime);
                    const rangeHours = (endDate - startDate) / (1000 * 60 * 60);
                    const rangeDays = rangeHours / 24;

                    // For short time ranges (< 1 day), don't trigger sparse logging warning
                    if (rangeDays < 1) {
                        // For sub-day ranges, be more lenient - just check if we got any files at all
                        isSparseLogging = false; // Don't warn about sparse logging for short ranges
                    } else {
                        daysRequested = Math.ceil(rangeDays);
                        expectedMinFiles = daysRequested;
                        isSparseLogging = totalFilesDownloaded < expectedMinFiles && totalFilesDownloaded > 0;
                    }
                } else {
                    isSparseLogging = totalFilesDownloaded < expectedMinFiles && totalFilesDownloaded > 0;
                }
                
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
                        if (result.skipped > 0) {
                            summary += ` | ✨ ${result.skipped} files skipped (already up-to-date)`;
                        }
                    } else if (result.status === 'empty') {
                        summary += `No logs found`;
                    } else {
                        summary += `Status unknown`;
                    }
                    summary += '\n';
                }
                
                // Add incremental summary if applicable
                if (totalSkippedFiles > 0) {
                    summary += `\n## ✨ Smart Incremental Download\n`;
                    summary += `• **Files skipped (already up-to-date)**: ${totalSkippedFiles}\n`;
                    summary += `• **Files downloaded**: ${totalFilesDownloaded}\n`;
                    summary += `• **Efficiency**: ${Math.round((totalSkippedFiles / (totalSkippedFiles + totalFilesDownloaded)) * 100)}% bandwidth saved\n`;
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
                    message += ` - Likely HTTP/IIS access logs`;
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
        
        // DEBUG: Add parameter info to the preview itself
        message += `## 🔍 DEBUG: Received Parameters\n`;
        message += `\`\`\`json\n${JSON.stringify({
            dateFilter: dateFilter || 'none',
            logsCount: logs.length,
            containerName,
            logType,
            environment,
            downloadPath
        }, null, 2)}\n\`\`\`\n\n`;
        
        // Check for different file types
        const logFiles = logs.filter(log => log.fileType === 'log');
        const otherFiles = logs.filter(log => log.fileType === 'other');
        
        // Add note if non-log files are found
        if (otherFiles.length > 0) {
            message += `## 📦 Container Contents\n`;
            message += `• **Log Files**: ${logFiles.length} standard log file(s)\n`;
            message += `• **Other Files**: ${otherFiles.length} file(s) - may include archives, exports, or diagnostic data\n`;
            message += `\n**Note:** This container includes additional files that may have been provided by Optimizely Support.\n`;
            message += `Archive files (ZIP/GZ) will need to be extracted after download.\n\n`;
        }
        
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
        if (dateFilter && dateFilter.description) {
            message += `• **Date Filter**: ${dateFilter.description}\n`;
        }
        message += `• **Retention**: Logs are kept for 90 days\n\n`;
        
        // Show destination with container type explanation
        message += `## 📁 Destination Folder\n`;
        message += `• **Path**: \`${downloadPath}\`\n`;
        message += `• **Structure**: Organized by log type for better analysis\n`;
        message += `  - Container names now used as subfolder names for clarity\n`;
        message += `  - Example: \`azure-web-logs/\`, \`azure-application-logs/\`, \`cloudflare-logs/\`\n`;
        message += `  - Self-hosted: \`insights-logs-appservicehttplogs/\`, \`insights-logs-appserviceconsolelogs/\`\n\n`;
        
        // Check for date mismatch
        if (dateFilter && dateFilter.startDate && dateFilter.endDate && logs.length > 0) {
            // Extract date from first log file
            const firstLogMatch = logs[0].name.match(/y=(\d{4})\/m=(\d{2})\/d=(\d{2})/);
            if (firstLogMatch) {
                const firstLogDate = new Date(Date.UTC(
                    parseInt(firstLogMatch[1]),
                    parseInt(firstLogMatch[2]) - 1,
                    parseInt(firstLogMatch[3])
                ));
                
                // Check if first log is outside requested range
                if (firstLogDate < dateFilter.startDate || firstLogDate > dateFilter.endDate) {
                    message += `## ⚠️ DATE MISMATCH WARNING\n`;
                    message += `• **Requested**: ${dateFilter.startDate.toISOString().split('T')[0]} to ${dateFilter.endDate.toISOString().split('T')[0]}\n`;
                    message += `• **Actual files from**: ${firstLogDate.toISOString().split('T')[0]}\n`;
                    message += `• **This indicates a filtering issue** - please report this\n\n`;
                }
            }
        }
        
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
     * Now uses actual container names for both self-hosted and standard DXP clients
     * This provides better clarity about which specific container logs came from
     */
    static getContainerSubfolderName(containerName) {
        // Always use the actual container name for clarity
        // This applies to both self-hosted and standard DXP clients
        // Clean up the container name to be filesystem-friendly
        return containerName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    }
    
    /**
     * Legacy method for backward compatibility - use determineLogDownloadPath instead
     */
    static async determineLogDownloadPathLegacy(args, projectName) {
        // Default to current directory (settings removed)
        return path.join('./backups', 'logs', projectName || 'unknown');
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
     * List logs with a specific prefix (much faster than full scan)
     */
    static async listLogsWithPrefix(sasUrl, prefix) {
        const url = new URL(sasUrl);
        const baseUrl = `${url.origin}${url.pathname}`;
        const sasToken = url.search;

        // Add prefix parameter to the query
        // Note: sasToken starts with ? so we need to convert it to & when appending
        const listUrl = `${baseUrl}?restype=container&comp=list&prefix=${encodeURIComponent(prefix)}&${sasToken.substring(1)}`;

        if (process.env.DEBUG === 'true') {
            console.error(`[SMART FILTER] DEBUG: Making Azure API call`);
            console.error(`[SMART FILTER] DEBUG: Prefix being searched: "${prefix}"`);
            console.error(`[SMART FILTER] DEBUG: Encoded prefix: "${encodeURIComponent(prefix)}"`);
            console.error(`[SMART FILTER] DEBUG: Full URL: ${listUrl.substring(0, 200)}...`);
        }

        try {
            const response = await new Promise((resolve, reject) => {
                https.get(listUrl, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve({ statusCode: res.statusCode, data }));
                }).on('error', reject);
            });

            if (process.env.DEBUG === 'true') {
                console.error(`[SMART FILTER] DEBUG: Azure response status: ${response.statusCode}`);
                console.error(`[SMART FILTER] DEBUG: Response length: ${response.data.length} chars`);
            }

            if (response.statusCode !== 200) {
                console.error(`[SMART FILTER] Failed to list prefix ${prefix}: HTTP ${response.statusCode}`);
                if (process.env.DEBUG === 'true') {
                    console.error(`[SMART FILTER] Response body:`, response.data.substring(0, 500));
                }
                return [];
            }

            if (process.env.DEBUG === 'true') {
                console.error(`[SMART FILTER] Got response for prefix ${prefix}, parsing XML...`);
            }

            // Parse the XML response
            const logs = [];
            const blobMatches = response.data.matchAll(/<Blob>[\s\S]*?<\/Blob>/g);

            for (const match of blobMatches) {
                const blobXml = match[0];
                const nameMatch = blobXml.match(/<Name>(.*?)<\/Name>/);
                const sizeMatch = blobXml.match(/<Content-Length>(.*?)<\/Content-Length>/);
                const lastModifiedMatch = blobXml.match(/<Last-Modified>(.*?)<\/Last-Modified>/);

                if (nameMatch) {
                    logs.push({
                        name: nameMatch[1],
                        size: sizeMatch ? parseInt(sizeMatch[1]) : 0,
                        lastModified: lastModifiedMatch ? lastModifiedMatch[1] : null
                    });
                }
            }

            if (process.env.DEBUG === 'true') {
                console.error(`[SMART FILTER] Found ${logs.length} files for prefix ${prefix}`);
            }

            return logs;
        } catch (error) {
            console.error(`[SMART FILTER] Error listing prefix ${prefix}:`, error.message);
            return [];
        }
    }

    /**
     * Generate specific path prefixes for a date range to avoid scanning all files
     * For narrow time ranges, we can target specific folders
     */
    static generateDatePrefixes(startDate, endDate) {
        const prefixes = [];


        // If the range is more than 7 days, don't use prefixes (too many)
        const rangeMs = endDate.getTime() - startDate.getTime();
        const rangeDays = rangeMs / (1000 * 60 * 60 * 24);

        if (rangeDays > 7) {
            return null; // Fall back to full scan for large ranges
        }

        // Generate prefixes for each hour in the range
        const current = new Date(startDate);
        while (current <= endDate) {
            const year = current.getUTCFullYear();
            const month = String(current.getUTCMonth() + 1).padStart(2, '0'); // ALWAYS pad month (m=09 not m=9)
            const day = String(current.getUTCDate()).padStart(2, '0'); // ALWAYS pad day (d=13 not d=13)
            const hour = String(current.getUTCHours()).padStart(2, '0'); // ALWAYS pad hour (h=09 not h=9)

            // CORRECTED Azure format based on actual file paths:
            // Production slot: resourceId=/SUBSCRIPTIONS/.../y=2025/m=09/d=15/h=06/m=00/PT1H.json
            // vs Offline slot: resourceId=/SUBSCRIPTIONS/.../SLOTS/OFFLINE/y=2024/...
            // Target Production slot (no /SLOTS/) with the specific date
            const prefix = `resourceId=/SUBSCRIPTIONS/C04A9DFA-6140-46E8-B4FD-9FB31D7FFA61/RESOURCEGROUPS/CDSC01MSTR2R3LR2PROD/PROVIDERS/MICROSOFT.WEB/SITES/CDSC01MSTR2R3LR2PROD/y=${year}/m=${month}/d=${day}/h=${hour}/m=00/`;
            prefixes.push(prefix);

            // Move to next hour
            current.setUTCHours(current.getUTCHours() + 1);
        }

        return prefixes;
    }

    /**
     * List logs in the container with optional date filtering
     * FIXED v3.17.0: Added pagination support to get ALL blobs, not just first 5000
     * FIXED v3.17.2: Increased page limit for very large containers (some have 15+ months)
     * OPTIMIZED: Use path prefixes for narrow date ranges to avoid full scans
     */
    static async listLogs(sasUrl, dateFilterObj, containerName = null, quickCheckLimit = null) {
        const allLogs = [];

        // OPTIMIZATION: For narrow date ranges, use specific path prefixes
        let prefixes = null;
        if (dateFilterObj && dateFilterObj.startDate && dateFilterObj.endDate) {
            prefixes = this.generateDatePrefixes(dateFilterObj.startDate, dateFilterObj.endDate);
            if (prefixes && process.env.DEBUG === 'true') {
                console.error(`[SMART FILTER] Using ${prefixes.length} specific path prefixes instead of full scan`);
                console.error(`[SMART FILTER] Prefixes:`, prefixes.slice(0, 5), prefixes.length > 5 ? '...' : '');
            }
        }

        // If we have prefixes, query each prefix specifically (MUCH faster for narrow ranges)
        if (prefixes && prefixes.length > 0) {
            for (const prefix of prefixes) {
                if (process.env.DEBUG === 'true') {
                    console.error(`[SMART FILTER] Checking prefix: ${prefix}`);
                }

                // Query this specific prefix
                const prefixLogs = await this.listLogsWithPrefix(sasUrl, prefix);
                allLogs.push(...prefixLogs);

                // Early exit if we have enough for quick check
                if (quickCheckLimit && allLogs.length >= quickCheckLimit) {
                    if (process.env.DEBUG === 'true') {
                        console.error(`[SMART FILTER] Quick check limit reached with ${allLogs.length} files`);
                    }
                    break;
                }
            }

            if (process.env.DEBUG === 'true') {
                console.error(`[SMART FILTER] Found ${allLogs.length} files using prefix search`);
            }

            // Skip the full pagination - we already have what we need!
            return this.filterLogsByDate(allLogs, sasUrl, dateFilterObj, containerName);
        }

        // Fall back to full scan for large date ranges or no date filter
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
            
            // If this is a quick check and we have enough logs, stop early
            if (quickCheckLimit && allLogs.length >= quickCheckLimit) {
                if (showProgress) {
                    console.error(`[QUICK CHECK] Found ${allLogs.length} logs, stopping early`);
                }
                break;
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
            // Ensure the SAS URL has the proper container listing parameters
            let listUrl = sasUrl;
            
            // Check if the URL already has restype=container&comp=list
            if (!listUrl.includes('restype=container') || !listUrl.includes('comp=list')) {
                // Add the required parameters for container listing
                const separator = listUrl.includes('?') ? '&' : '?';
                listUrl += `${separator}restype=container&comp=list`;
            }
            
            // Add marker for pagination if provided
            if (marker) {
                listUrl += `&marker=${encodeURIComponent(marker)}`;
            }
            
            if (process.env.DEBUG === 'true') {
                const urlWithoutSas = listUrl.split('&sig=')[0];
                console.error(`[LIST LOGS PAGE] Requesting: ${urlWithoutSas}&sig=[REDACTED]`);
            }
            
            https.get(listUrl, (response) => {
                let data = '';
                
                // Check HTTP status and reject immediately for auth errors
                if (response.statusCode === 401) {
                    console.error(`[LIST LOGS] HTTP 401 Unauthorized - Authentication failed`);
                    reject(new Error('Authentication failed - HTTP 401 Unauthorized. Please check your Azure Storage credentials.'));
                    return;
                } else if (response.statusCode === 403) {
                    console.error(`[LIST LOGS] HTTP 403 Forbidden - Access denied`);
                    reject(new Error('Access denied - HTTP 403 Forbidden. Please check your permissions for this container.'));
                    return;
                } else if (response.statusCode === 404) {
                    console.error(`[LIST LOGS] HTTP 404 Not Found - Container does not exist`);
                    reject(new Error('Container not found - HTTP 404. Please verify the container name.'));
                    return;
                } else if (response.statusCode !== 200) {
                    console.error(`[LIST LOGS] HTTP ${response.statusCode} when listing container`);
                }
                
                response.on('data', chunk => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        // Debug: log response if no blobs found or error
                        if (process.env.DEBUG === 'true' || response.statusCode !== 200) {
                            if (data.includes('Error') || data.includes('error') || !data.includes('<Blob>')) {
                                console.error('[LIST LOGS] Response:', data.substring(0, 500));
                            }
                        }
                        
                        // Handle non-200 status codes that weren't caught above
                        if (response.statusCode !== 200) {
                            const errorMessage = data.substring(0, 500);
                            reject(new Error(`HTTP ${response.statusCode}: ${errorMessage}`));
                            return;
                        }
                        
                        // Check for Azure Storage error
                        if (data.includes('<Error>')) {
                            const errorMatch = data.match(/<Message>(.*?)<\/Message>/);
                            const errorCode = data.match(/<Code>(.*?)<\/Code>/);
                            
                            if (process.env.DEBUG === 'true') {
                                console.error('[AZURE ERROR] Code:', errorCode ? errorCode[1] : 'Unknown');
                                console.error('[AZURE ERROR] Message:', errorMatch ? errorMatch[1] : 'No message');
                                console.error('[AZURE ERROR] Full response:', data.substring(0, 1000));
                            }
                            
                            const error = new Error(
                                `Azure Storage Error: ${errorCode ? errorCode[1] : 'Unknown'} - ` +
                                `${errorMatch ? errorMatch[1] : 'Failed to list container'}`
                            );
                            reject(error);
                            return;
                        }
                        
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
                        
                        // Debug output
                        if (process.env.DEBUG === 'true' && logs.length === 0) {
                            console.error('[LIST LOGS] No blobs found in response');
                            console.error('[LIST LOGS] Response contained <Blob> tags:', data.includes('<Blob>'));
                        }
                        
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
        
        // Debug: Log what date filter we're using
        if (startDate || endDate || dateFilter) {
            console.error(`[DATE FILTER ACTIVE]`);
            console.error(`  startDate: ${startDate ? startDate.toISOString() : 'none'}`);
            console.error(`  endDate: ${endDate ? endDate.toISOString() : 'none'}`);
            console.error(`  dateFilter: ${dateFilter || 'none'}`);
            console.error(`  Total files to check: ${allLogs.length}`);
        }
        
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
                // DXP-20 FIX: Parse datetime with hours/minutes from filename
                // Pattern 1: y=2025/m=09/d=15/h=01/m=30 (Azure App Insights format with hour/minute)
                // Pattern 2: y=2025/m=09/d=15 (Azure App Insights format day only)
                // Pattern 3: 2025-09-15-01 or 2025-09-15-01-30 (web logs with hour)
                // Pattern 4: 2025-09-15 (simple date format)

                // Try to extract full datetime including hours/minutes
                let logDateTime = null;

                // Azure App Insights format with hours/minutes
                const appInsightsMatch = name.match(/y=(\d{4})\/m=(\d{1,2})\/d=(\d{1,2})(?:\/h=(\d{1,2}))?(?:\/m=(\d{1,2}))?/);
                if (appInsightsMatch) {
                    const year = parseInt(appInsightsMatch[1]);
                    const month = parseInt(appInsightsMatch[2]) - 1;
                    const day = parseInt(appInsightsMatch[3]);
                    const hour = appInsightsMatch[4] ? parseInt(appInsightsMatch[4]) : 0;
                    const minute = appInsightsMatch[5] ? parseInt(appInsightsMatch[5]) : 0;

                    logDateTime = new Date(Date.UTC(year, month, day, hour, minute));
                } else {
                    // Try other formats with time components
                    const timeMatch = name.match(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(?:-(\d{2}))?/) || // 2025-09-15-01 or 2025-09-15-01-30
                                     name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/); // 20250915_0130

                    if (timeMatch) {
                        const year = parseInt(timeMatch[1]);
                        const month = parseInt(timeMatch[2]) - 1;
                        const day = parseInt(timeMatch[3]);
                        const hour = parseInt(timeMatch[4]);
                        const minute = timeMatch[5] ? parseInt(timeMatch[5]) : 0;

                        logDateTime = new Date(Date.UTC(year, month, day, hour, minute));
                    } else {
                        // Fall back to date-only matching (will compare at day level)
                        const dateMatch = name.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
                        if (dateMatch) {
                            const year = parseInt(dateMatch[1]);
                            const month = parseInt(dateMatch[2]) - 1;
                            const day = parseInt(dateMatch[3]);

                            // For date-only files, we'll include them if they're within the date range
                            // but we can't filter by specific hours
                            logDateTime = new Date(Date.UTC(year, month, day, 12, 0)); // Use noon as default
                        }
                    }
                }

                if (logDateTime) {
                    // DXP-20: Compare using actual start/end times, not midnight boundaries
                    if (process.env.DEBUG === 'true' || process.env.LOG_DATE_FILTER === 'true') {
                        if (name.includes('2025')) {
                            console.error(`[DXP-20 DATE FILTER] Checking: ${name}`);
                            console.error(`  Log datetime: ${logDateTime.toISOString()}`);
                            console.error(`  Filter range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
                            console.error(`  In range: ${logDateTime >= startDate && logDateTime <= endDate}`);
                        }
                    }

                    // Use the actual datetime range, not day boundaries
                    if (logDateTime < startDate || logDateTime > endDate) {
                        filesSkippedByDate++;
                        if (process.env.DEBUG === 'true' || filesSkippedByDate <= 5) {
                            console.error(`[DXP-20 SKIP] Skipping ${name} (datetime: ${logDateTime.toISOString()})`);
                        }
                        continue;
                    }
                } else {
                    // For files without date in the name, check lastModified if available
                    if (log.lastModified) {
                        const modifiedDate = new Date(log.lastModified);

                        // DXP-20: Use actual datetime range, not day boundaries
                        if (modifiedDate < startDate || modifiedDate > endDate) {
                            filesSkippedByDate++;
                            if (process.env.DEBUG === 'true') {
                                console.error(`[DXP-20 SKIP by lastModified] ${name} (modified: ${modifiedDate.toISOString()})`);
                            }
                            continue;
                        }
                    } else {
                        // If no date in filename and no lastModified, we can't filter by date
                        // Include the file to avoid missing logs with non-standard naming
                        filesSkippedNoDate++;
                        // Don't skip - include files when we can't determine their date
                        // This ensures we don't miss logs that don't follow date naming conventions
                        if (process.env.DEBUG === 'true') {
                            console.error(`[DATE FILTER] Including file with no date info: ${name}`);
                        }
                    }
                }
            }
            
            // Filter for actual log files - be more permissive for known log containers
            // For Application Insights containers, include ALL files since they're all logs
            const isInsightsContainer = containerName && (
                containerName.includes('insights-logs') ||
                containerName.includes('insights-metrics')
            );
            const isWafContainer = containerName && (containerName.includes('waf') || containerName.includes('WAF'));
            const isCloudflareContainer = containerName && containerName.includes('cloudflare');
            const isCustomLogContainer = containerName && (
                containerName.includes('log') || 
                containerName.includes('Log') ||
                containerName.includes('LOG') ||
                containerName === '$logs' // Azure system logs
            );
            
            // Categorize file types
            const standardLogExtensions = ['.log', '.txt', '.json', '.csv'];
            const archiveExtensions = ['.zip', '.gz', '.tar', '.tar.gz', '.7z', '.rar'];
            
            // Check file extension
            const hasStandardLogExtension = standardLogExtensions.some(ext => name.endsWith(ext));
            const hasArchiveExtension = archiveExtensions.some(ext => name.endsWith(ext));
            const hasAppInsightsPattern = name.includes('PT1H.json') || name.includes('PT1M.json');
            
            // Smart container detection for log-related content
            const isExplicitContainerRequest = containerName && !containerName.includes('*');
            const isKnownLogContainer = isInsightsContainer || isWafContainer || isCloudflareContainer || isCustomLogContainer;
            
            // Additional smart detection for containers that might contain logs
            const hasLogKeywords = containerName && (
                containerName.includes('diagnostic') ||
                containerName.includes('export') ||
                containerName.includes('audit') ||
                containerName.includes('trace') ||
                containerName.includes('event') ||
                containerName.includes('security')
            );
            
            let isLogFile = false;
            
            if (isExplicitContainerRequest && (isKnownLogContainer || hasLogKeywords)) {
                // User explicitly requested a log-related container - include ALL files
                // This handles WAF logs (.zip), diagnostic exports, security logs, etc.
                isLogFile = true;
            } else if (isKnownLogContainer) {
                // Known log containers in bulk operations - include everything
                isLogFile = true;
            } else if (isExplicitContainerRequest) {
                // Explicit request for unknown container - be permissive but warn user
                isLogFile = hasStandardLogExtension || hasArchiveExtension || hasAppInsightsPattern;
            } else {
                // Bulk operations on non-log containers - strict filtering
                isLogFile = hasStandardLogExtension || hasAppInsightsPattern;
            }
            
            // Track archive files for potential warning
            const isArchiveFile = hasArchiveExtension && !hasStandardLogExtension;
            
            if (!isLogFile) {
                filesSkippedNotLog++;
                if (process.env.DEBUG === 'true') {
                    console.error(`[LOG FILTER] Skipping non-log file: ${name}`);
                }
                continue;
            }
            
            // Categorize file type for user information
            // Simple categorization: known log files vs everything else
            let fileType = 'other';
            if (hasStandardLogExtension || hasAppInsightsPattern) {
                fileType = 'log';
            }
            
            filteredLogs.push({
                name: name,
                url: `${baseUrl}/${name}?${sasToken}`,
                size: log.size,
                lastModified: log.lastModified,
                fileType: fileType // Track file type for user information
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
                    console.error(`\n[SAMPLE OF FILES IN CONTAINER]:`);
                    console.error(`  Showing first 10 files to help diagnose the issue:`);
                    allLogs.slice(0, 10).forEach(log => {
                        const dateInfo = log.lastModified ? ` (modified: ${new Date(log.lastModified).toISOString().split('T')[0]})` : '';
                        console.error(`  - ${log.name}${dateInfo}`);
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
            // Look for container names in numbered list format only
            // Format: "1. 📦 container-name"
            const match = line.match(/^\d+\.\s*(?:📦\s*)?(.+)$/);

            if (match) {
                let containerName = match[1].trim();

                // If the line includes a description after a dash, extract just the container name
                // e.g., "insights-logs-appserviceconsolelogs - Console logs" -> "insights-logs-appserviceconsolelogs"
                if (containerName.includes(' - ')) {
                    containerName = containerName.split(' - ')[0].trim();
                }

                // Filter out obvious non-container lines
                if (containerName &&
                    !containerName.startsWith('Use ') &&
                    !containerName.includes('**') &&
                    !containerName.startsWith('Tips') &&
                    !containerName.startsWith('Available') &&
                    !containerName.startsWith('No storage') &&
                    !containerName.startsWith('Built by') &&
                    containerName.length < 100) {
                    containers.push(containerName);
                }
            }
        }
        
        // If no containers found, look for insights-logs patterns in the text
        if (containers.length === 0 && text.includes('insights-logs')) {
            const insightsMatches = text.match(/insights-logs-[a-z]+/g);
            if (insightsMatches) {
                containers.push(...new Set(insightsMatches));
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
                        
                        // Check for permission errors in the text
                        if (textToSearch.includes('Permission Denied') || 
                            textToSearch.includes('does not have access') ||
                            textToSearch.includes('Your API key does not have access')) {
                            if (process.env.DEBUG === 'true') {
                                console.error('[extractSasUrl] Permission error detected in response text');
                            }
                            return null;
                        }
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
     * Parse a flexible date string into a Date object
     * Supports various formats including month names and abbreviations
     */
    static parseFlexibleDate(dateStr) {
        if (!dateStr) return null;
        
        // Clean up the input
        dateStr = dateStr.trim();
        
        // Month name mappings
        const monthNames = {
            'january': 1, 'jan': 1,
            'february': 2, 'feb': 2,
            'march': 3, 'mar': 3,
            'april': 4, 'apr': 4,
            'may': 5,
            'june': 6, 'jun': 6,
            'july': 7, 'jul': 7,
            'august': 8, 'aug': 8,
            'september': 9, 'sep': 9, 'sept': 9,
            'october': 10, 'oct': 10,
            'november': 11, 'nov': 11,
            'december': 12, 'dec': 12
        };
        
        // Try ISO format first (2025-09-10T17:00)
        if (dateStr.includes('T')) {
            const parsed = new Date(dateStr);
            if (!isNaN(parsed)) return parsed;
        }
        
        // Skip standard Date.parse for now to avoid incorrect parsing
        
        // Try YYYY/MM/DD or YYYY-MM-DD
        const ymdMatch = dateStr.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
        if (ymdMatch) {
            return new Date(Date.UTC(
                parseInt(ymdMatch[1]),
                parseInt(ymdMatch[2]) - 1,
                parseInt(ymdMatch[3]),
                0, 0, 0, 0
            ));
        }
        
        // Try MM/DD/YYYY or MM-DD-YYYY or DD/MM/YYYY (ambiguous formats)
        const numericDateMatch = dateStr.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (numericDateMatch) {
            const first = parseInt(numericDateMatch[1]);
            const second = parseInt(numericDateMatch[2]);
            const year = parseInt(numericDateMatch[3]);
            
            // If first number > 12, it must be day (European format DD/MM/YYYY)
            if (first > 12) {
                return new Date(Date.UTC(year, second - 1, first, 0, 0, 0, 0));
            }
            // If second number > 12, it must be day (US format MM/DD/YYYY)
            else if (second > 12) {
                return new Date(Date.UTC(year, first - 1, second, 0, 0, 0, 0));
            }
            // Both <= 12, ambiguous - default to US format MM/DD/YYYY
            else {
                return new Date(Date.UTC(year, first - 1, second, 0, 0, 0, 0));
            }
        }
        
        // Try formats with month names (e.g., "Sep 9, 2025", "September 1", "1 Sep 2025")
        const lowerStr = dateStr.toLowerCase();
        
        // Pattern: Month DD, YYYY or Month DD YYYY
        const monthDayYearMatch = lowerStr.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
        if (monthDayYearMatch) {
            const monthNum = monthNames[monthDayYearMatch[1]];
            if (monthNum) {
                return new Date(Date.UTC(
                    parseInt(monthDayYearMatch[3]),
                    monthNum - 1,
                    parseInt(monthDayYearMatch[2]),
                    0, 0, 0, 0
                ));
            }
        }
        
        // Pattern: DD Month YYYY
        const dayMonthYearMatch = lowerStr.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
        if (dayMonthYearMatch) {
            const monthNum = monthNames[dayMonthYearMatch[2]];
            if (monthNum) {
                return new Date(Date.UTC(
                    parseInt(dayMonthYearMatch[3]),
                    monthNum - 1,
                    parseInt(dayMonthYearMatch[1]),
                    0, 0, 0, 0
                ));
            }
        }
        
        // Pattern: Month-DD-YYYY (e.g., "Sep-9-2025")
        const monthDashDayYearMatch = lowerStr.match(/^([a-z]+)-(\d{1,2})-(\d{4})$/);
        if (monthDashDayYearMatch) {
            const monthNum = monthNames[monthDashDayYearMatch[1]];
            if (monthNum) {
                return new Date(Date.UTC(
                    parseInt(monthDashDayYearMatch[3]),
                    monthNum - 1,
                    parseInt(monthDashDayYearMatch[2]),
                    0, 0, 0, 0
                ));
            }
        }
        
        // Pattern: Month DD (assume current year)
        const monthDayMatch = lowerStr.match(/^([a-z]+)\s+(\d{1,2})$/);
        if (monthDayMatch) {
            const monthNum = monthNames[monthDayMatch[1]];
            if (monthNum) {
                const currentYear = new Date().getUTCFullYear();
                return new Date(Date.UTC(
                    currentYear,
                    monthNum - 1,
                    parseInt(monthDayMatch[2]),
                    0, 0, 0, 0
                ));
            }
        }
        
        // Pattern: DD Month (assume current year)
        const dayMonthMatch = lowerStr.match(/^(\d{1,2})\s+([a-z]+)$/);
        if (dayMonthMatch) {
            const monthNum = monthNames[dayMonthMatch[2]];
            if (monthNum) {
                const currentYear = new Date().getUTCFullYear();
                return new Date(Date.UTC(
                    currentYear,
                    monthNum - 1,
                    parseInt(dayMonthMatch[1]),
                    0, 0, 0, 0
                ));
            }
        }
        
        // Last resort: try JavaScript's native Date parsing
        // But be careful - it may produce unexpected results
        const lastResort = new Date(dateStr);
        if (!isNaN(lastResort)) {
            // Check if the year seems reasonable (not in the past unless explicitly specified)
            const year = lastResort.getUTCFullYear();
            const currentYear = new Date().getUTCFullYear();
            
            // If the parsed year is way in the past and no year was in the input, use current year
            if (year < currentYear - 10 && !dateStr.match(/\d{4}/)) {
                // Likely parsed wrong - try to fix by using current year
                return new Date(Date.UTC(
                    currentYear,
                    lastResort.getUTCMonth(),
                    lastResort.getUTCDate(),
                    0, 0, 0, 0
                ));
            }
            
            // Convert to UTC midnight
            return new Date(Date.UTC(
                lastResort.getUTCFullYear(),
                lastResort.getUTCMonth(),
                lastResort.getUTCDate(),
                0, 0, 0, 0
            ));
        }
        
        return null;
    }
    
    /**
     * Parse time string like "2:15am", "14:30", "5:00pm" into hours and minutes
     * @param {string} timeStr - Time string to parse
     * @returns {Object|null} Object with hours (0-23) and minutes (0-59)
     */
    static parseTimeString(timeStr) {
        if (!timeStr) return null;
        
        // Remove spaces and convert to lowercase
        const cleanTime = timeStr.trim().toLowerCase();
        
        // Match patterns like "2:15am", "2:15pm", "14:30", "2am", "2pm"
        const match = cleanTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
        if (!match) return null;
        
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2] || '0');
        const meridiem = match[3];
        
        // Handle 12-hour format
        if (meridiem) {
            if (meridiem === 'pm' && hours !== 12) {
                hours += 12;
            } else if (meridiem === 'am' && hours === 12) {
                hours = 0;
            }
        }
        
        // Validate ranges
        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
            return null;
        }
        
        return { hours, minutes };
    }
    
    /**
     * Convert timezone-specific time to UTC
     * @param {Date} baseDate - Base date for the time
     * @param {number} hours - Hours (0-23)
     * @param {number} minutes - Minutes (0-59)
     * @param {number} timezoneOffset - Timezone offset in hours from UTC
     * @returns {Date} UTC date/time
     */
    static convertToUTC(baseDate, hours, minutes, timezoneOffset) {
        // Create date in the specified timezone
        const year = baseDate.getFullYear();
        const month = baseDate.getMonth();
        const day = baseDate.getDate();
        
        // Create UTC date by subtracting timezone offset
        const utcDate = new Date(Date.UTC(year, month, day, hours - timezoneOffset, minutes, 0, 0));
        return utcDate;
    }
    
    /**
     * Process date filters from various input formats
     * Important: Azure logs are in UTC, but users think in local time
     * This function handles timezone conversion automatically
     * 
     * NEW: Support for specific time ranges like "2:15am to 2:30am EST"
     */
    static processDateFilters(args) {
        // DXP-20 DEBUG: Log ALL arguments to understand what's being passed
        console.error('[DXP-20 processDateFilters] Full args received:', JSON.stringify({
            minutesBack: args.minutesBack,
            hoursBack: args.hoursBack,
            daysBack: args.daysBack,
            weeksBack: args.weeksBack,
            monthsBack: args.monthsBack,
            yearsBack: args.yearsBack,
            startDate: args.startDate,
            endDate: args.endDate,
            dateFilter: args.dateFilter,
            startDateTime: args.startDateTime,
            endDateTime: args.endDateTime
        }, null, 2));
        
        
        // DXP-20: Handle combined datetime parameters using ISO 8601 format
        // Supported formats:
        // - "2025-09-15T01:00:00" (local time)
        // - "2025-09-15T01:00:00-05:00" (with timezone offset)
        // - "2025-09-15T06:00:00Z" (UTC)
        if (args.startDateTime && args.endDateTime) {
            console.error('[DXP-20] Processing startDateTime and endDateTime parameters');

            // Parse using JavaScript's native Date constructor which handles ISO 8601
            const startDate = new Date(args.startDateTime);
            const endDate = new Date(args.endDateTime);

            // Check if dates are valid
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
                console.error('[DXP-20] Successfully parsed datetime range:', {
                    startDate: startDate.toISOString(),
                    endDate: endDate.toISOString()
                });

                return {
                    filter: null,
                    startDate: startDate,
                    endDate: endDate,
                    description: `${args.startDateTime} to ${args.endDateTime}`
                };
            } else {
                console.error('[DXP-20] Failed to parse datetime parameters:', {
                    startDateTime: args.startDateTime,
                    endDateTime: args.endDateTime,
                    error: 'Invalid ISO 8601 format. Use format like: 2025-09-15T01:00:00-05:00'
                });
            }
        }
        
        // Handle all time-based parameters (priority order: most specific to least specific)
        // Check for any time unit parameters and convert to milliseconds for consistent processing
        let timeBackMs = 0;
        let timeUnit = '';
        let timeValue = 0;

        // DXP-20 DEBUG: Log the exact values and types being checked
        console.error('[DXP-20] Checking time parameters:');
        console.error(`  minutesBack: value="${args.minutesBack}", type="${typeof args.minutesBack}", undefined check=${args.minutesBack === undefined}, null check=${args.minutesBack === null}`);
        console.error(`  hoursBack: value="${args.hoursBack}", type="${typeof args.hoursBack}", undefined check=${args.hoursBack === undefined}, null check=${args.hoursBack === null}`);
        console.error(`  daysBack: value="${args.daysBack}", type="${typeof args.daysBack}", undefined check=${args.daysBack === undefined}, null check=${args.daysBack === null}`);

        if (args.secondsBack !== undefined && args.secondsBack !== null) {
            timeValue = parseFloat(args.secondsBack);
            timeBackMs = timeValue * 1000;
            timeUnit = timeValue === 1 ? 'second' : 'seconds';
        } else if (args.minutesBack !== undefined && args.minutesBack !== null) {
            console.error('[DXP-20] minutesBack condition matched!');
            timeValue = parseFloat(args.minutesBack);
            timeBackMs = timeValue * 60 * 1000;
            timeUnit = timeValue === 1 ? 'minute' : 'minutes';
            console.error(`[DXP-20] Parsed minutesBack: timeValue=${timeValue}, timeBackMs=${timeBackMs}`);
        } else if (args.hoursBack !== undefined && args.hoursBack !== null) {
            timeValue = parseFloat(args.hoursBack);
            timeBackMs = timeValue * 60 * 60 * 1000;
            timeUnit = timeValue === 1 ? 'hour' : 'hours';
        } else if (args.daysBack !== undefined && args.daysBack !== null) {
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
                // CRITICAL FIX DXP-15: daysBack: 1 means last 24 hours from now
                // Use consistent end time (now) instead of mixing UTC end-of-day
                startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
                const actualEndDate = new Date(now.getTime()); // Use current time as end
                
                return {
                    filter: null,
                    startDate: startDate,
                    endDate: actualEndDate,
                    description: `Last 24 hours`
                };
            } else {
                // CRITICAL FIX DXP-15: daysBack: N means last N*24 hours from now
                // Use consistent end time (now) for all time-based calculations
                startDate = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
                const actualEndDate = new Date(now.getTime()); // Use current time as end
                
                // Format dates including time for better accuracy
                const startStr = startDate.toISOString().replace('T', ' ').substring(0, 19);
                const endStr = actualEndDate.toISOString().replace('T', ' ').substring(0, 19);
                
                // For multiple days, we'll need to filter by date range
                // Azure blob storage doesn't have built-in date range filtering,
                // so we return a filter that can be used in listLogs
                return {
                    filter: null, // Will need to filter after listing
                    startDate: startDate,
                    endDate: actualEndDate,
                    description: `Last ${days} day${days !== 1 ? 's' : ''} (${days * 24} hours)`
                };
            }
        } else if (args.weeksBack !== undefined && args.weeksBack !== null) {
            timeValue = parseFloat(args.weeksBack);
            timeBackMs = timeValue * 7 * 24 * 60 * 60 * 1000;
            timeUnit = timeValue === 1 ? 'week' : 'weeks';
        } else if (args.monthsBack !== undefined && args.monthsBack !== null) {
            timeValue = parseFloat(args.monthsBack);
            // Approximate: 30.44 days per month (365.25/12)
            timeBackMs = timeValue * 30.44 * 24 * 60 * 60 * 1000;
            timeUnit = timeValue === 1 ? 'month' : 'months';
        } else if (args.yearsBack !== undefined && args.yearsBack !== null) {
            timeValue = parseFloat(args.yearsBack);
            // 365.25 days per year (accounting for leap years)
            timeBackMs = timeValue * 365.25 * 24 * 60 * 60 * 1000;
            timeUnit = timeValue === 1 ? 'year' : 'years';
        }
        
        // Handle time units that need precise calculation (seconds, minutes, hours, weeks, months, years)
        if (timeBackMs > 0) {
            console.error(`[DXP-20] timeBackMs > 0 condition matched: ${timeBackMs}ms`);
            const now = new Date();
            const endDate = new Date(now.getTime()); // Current time
            const startDate = new Date(now.getTime() - timeBackMs);

            // Create user-friendly description with proper pluralization
            const displayValue = timeValue % 1 === 0 ? timeValue.toString() : timeValue.toString();
            const description = `Last ${displayValue} ${timeUnit}`;

            const result = {
                filter: null, // Will need to filter after listing
                startDate: startDate,
                endDate: endDate,
                description: description
            };

            console.error('[DXP-20] Returning date filter:', JSON.stringify({
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                description: description
            }));

            return result;
        }
        
        // Handle date range
        if (args.startDate && args.endDate) {
            // Use our flexible date parser
            let startDate = this.parseFlexibleDate(args.startDate);
            let endDate = this.parseFlexibleDate(args.endDate);
            
            if (!startDate || !endDate) {
                // If parsing failed, try the old method as fallback
                if (args.startDate.includes('T')) {
                    // ISO datetime format - parse directly
                    startDate = new Date(args.startDate);
                    endDate = new Date(args.endDate);
                } else {
                    // Date-only format - parse and convert to UTC midnight/end-of-day
                    const [startYear, startMonth, startDay] = args.startDate.replace(/\//g, '-').split('-').map(Number);
                    const [endYear, endMonth, endDay] = args.endDate.replace(/\//g, '-').split('-').map(Number);
                    
                    startDate = new Date(Date.UTC(startYear, startMonth - 1, startDay, 0, 0, 0, 0));
                    endDate = new Date(Date.UTC(endYear, endMonth - 1, endDay, 23, 59, 59, 999));
                }
            } else {
                // Ensure end date is at end of day
                endDate = new Date(Date.UTC(
                    endDate.getUTCFullYear(),
                    endDate.getUTCMonth(),
                    endDate.getUTCDate(),
                    23, 59, 59, 999
                ));
            }
            
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
            // Use our flexible date parser
            const parsedDate = this.parseFlexibleDate(args.dateFilter);
            
            if (parsedDate) {
                // Create date range for the full day
                const startDate = parsedDate;
                const endDate = new Date(Date.UTC(
                    parsedDate.getUTCFullYear(),
                    parsedDate.getUTCMonth(),
                    parsedDate.getUTCDate(),
                    23, 59, 59, 999
                ));
                
                return {
                    filter: null, // Use date range instead
                    startDate: startDate,
                    endDate: endDate,
                    description: `${args.dateFilter}`
                };
            } else {
                // Fallback to old method
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
        }

        // DEFAULT: If no time parameters provided, default to last 7 days
        // DXP-20 FIX: Add proper default instead of returning null which causes ALL logs to be downloaded
        // BUT ONLY if truly no time parameters were provided
        const hasAnyTimeParam = args.minutesBack !== undefined || args.hoursBack !== undefined ||
                                args.daysBack !== undefined || args.weeksBack !== undefined ||
                                args.monthsBack !== undefined || args.yearsBack !== undefined ||
                                args.startDate !== undefined || args.endDate !== undefined ||
                                args.dateFilter !== undefined ||
                                args.startDateTime !== undefined || args.endDateTime !== undefined;

        console.error('[DXP-20] hasAnyTimeParam check:', {
            hasAnyTimeParam,
            minutesBack: args.minutesBack !== undefined,
            hoursBack: args.hoursBack !== undefined,
            daysBack: args.daysBack !== undefined,
            startDateTime: args.startDateTime !== undefined,
            endDateTime: args.endDateTime !== undefined,
            actualValues: {
                startDateTime: args.startDateTime,
                endDateTime: args.endDateTime
            }
        });

        if (!hasAnyTimeParam) {
            console.error('[DXP-20] No time parameters provided at all, applying default 7-day filter');
            const now = new Date();
            const endDate = new Date(now.getTime()); // Current time
            const startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000)); // 7 days ago

            return {
                filter: null,
                startDate: startDate,
                endDate: endDate,
                description: 'Last 7 days (default)'
            };
        }

        // If we get here, parameters were provided but didn't match any condition
        console.error('[DXP-20 WARNING] Time parameters were provided but no condition matched!');
        console.error('[DXP-20 WARNING] This should not happen. Returning null (will download all logs)');
        return null;
    }
}

module.exports = LogDownloadTools;