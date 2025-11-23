/**
 * Log Analysis Tools Module
 * Handles streaming log analysis from Azure Storage
 * Part of Jaxon Digital Optimizely DXP MCP Server (DXP-110)
 */

import ResponseBuilder from '../response-builder';
// import ErrorHandler - unused
import OutputLogger from '../output-logger';
import StorageTools from './storage-tools';
import ProjectTools from './project-tools';
import ProjectResolutionFix from './project-resolution-fix';
import AzureBlobStreamer from '../azure-blob-streamer';

// DXP-179: Access default export explicitly for CommonJS/ESM interop
const logParser = require('../log-analysis/log-parser');
const { parseLogEntry } = logParser.default || logParser;
// DXP-173: Access default export explicitly for CommonJS/ESM interop
const analyzers = require('../log-analysis/analyzers');
const {
    analyzeErrors,
    analyzePerformance,
    detectAIAgents,
    calculateHealthScore,
    generateRecommendations
} = analyzers.default || analyzers;
const { compareLogs } = require('../log-analysis/log-comparator');

/**
 * Analyze logs streaming arguments
 */
interface AnalyzeLogsArgs {
    environment?: string;
    logType?: 'web' | 'application' | 'all';
    minutesBack?: number;
    daysBack?: number;  // DXP-179: Support daysBack parameter (converted to minutesBack)
    startDateTime?: string;
    endDateTime?: string;
    structuredContent?: boolean;
    projectName?: string;
    slot?: boolean;  // DXP-116: Filter main/slot storage
    debug?: boolean;  // DXP-118: Debug mode
    timeoutSeconds?: number;  // DXP-188: Configurable timeout
}

/**
 * Time filter structure
 */
interface TimeFilter {
    minutesBack?: number;
    startDateTime?: string;
    endDateTime?: string;
}

/**
 * Project credentials
 */
interface Credentials {
    apiKey: string;
    apiSecret: string;
    projectId: string;
    name?: string;
}

/**
 * Single log type analysis parameters
 */
interface SingleLogTypeParams {
    logType: string;
    environment: string;
    credentials: Credentials;
    timeFilter: TimeFilter;
    slot?: boolean;
    debug?: boolean;
    timeoutSeconds?: number;  // DXP-188: Configurable timeout
}

/**
 * Parsed log entry
 */
interface ParsedLog {
    timestamp: Date;
    level?: string;
    message?: string;
    statusCode?: number;
    responseTime?: number;
    path?: string;
    userAgent?: string;
    [key: string]: any;
}

/**
 * Error analysis result
 */
interface ErrorAnalysis {
    total: number;
    byStatusCode: Record<string, number>;
    topErrors: Array<{ message: string; count: number }>;
}

/**
 * Performance analysis result
 */
interface PerformanceAnalysis {
    avgResponseTime: number | null;
    p95ResponseTime: number | null;
    p99ResponseTime: number | null;
    slowestPaths: Array<{ path: string; avgTime: number }>;
}

/**
 * AI agent analysis result
 */
interface AIAnalysis {
    detected: string[];
    byAgent: Record<string, { requests: number; successRate: number }>;
}

/**
 * Health status
 */
interface HealthStatus {
    score: number;
    healthy: boolean;
}

/**
 * Debug info structure (DXP-118)
 */
interface DebugInfo {
    containerName: string | null;
    availableContainers: any;
    sasUrlHost: string | null;
    sasUrlPath: string | null;
    firstBlobDates: string[];
    lastBlobDates: string[];
    totalBlobsBeforeFilter: number;
    totalBlobsAfterFilter: number;
}

/**
 * Single log type analysis result
 */
interface LogAnalysisResult {
    parsedLogs: ParsedLog[];
    errorAnalysis: ErrorAnalysis;
    perfAnalysis: PerformanceAnalysis;
    aiAnalysis: AIAnalysis;
    healthStatus: HealthStatus;
    recommendations: string[];
    debugInfo?: DebugInfo | null;
}

/**
 * Time range
 */
interface TimeRange {
    start: string | null;
    end: string | null;
    startFormatted: string | null;
    endFormatted: string | null;
}

/**
 * Compare logs arguments
 */
interface CompareLogsArgs {
    baseline: any;
    slot: any;
    thresholds?: {
        maxErrorIncrease?: number;
        maxScoreDecrease?: number;
        maxLatencyIncrease?: number;
    };
}

class LogAnalysisTools {
    /**
     * Handle analyze_logs_streaming command
     */
    static async handleAnalyzeLogsStreaming(args: AnalyzeLogsArgs): Promise<any> {
        try {
            OutputLogger.info(`⚡ handleAnalyzeLogsStreaming called with args: ${JSON.stringify(args, null, 2)}`);

            // Default environment to Production
            if (!args.environment) {
                args.environment = 'Production';
            }

            // Default logType to web (HTTP logs)
            if (!args.logType) {
                args.logType = 'web';
            }

            // DXP-179: Convert daysBack to minutesBack if provided
            if (args.daysBack && !args.minutesBack) {
                args.minutesBack = args.daysBack * 24 * 60;  // Convert days to minutes
                OutputLogger.info(`📅 Converted daysBack=${args.daysBack} to minutesBack=${args.minutesBack}`);
            }

            // Default minutesBack to 60
            if (!args.minutesBack && !args.startDateTime && !args.endDateTime) {
                args.minutesBack = 60;
            }

            OutputLogger.info(`📋 Defaults applied - environment: ${args.environment}, logType: ${args.logType}, minutesBack: ${args.minutesBack}`);

            // Default structuredContent to true
            const structuredContent = args.structuredContent !== false;

            // DXP-114: Handle logType: 'all' for dual log type analysis
            if (args.logType === 'all') {
                return this.handleDualLogTypeAnalysis(args, structuredContent);
            }

            OutputLogger.info(`🔍 Analyzing ${args.logType} logs from ${args.environment} (last ${args.minutesBack || 'custom'} minutes)`);

            // Resolve project configuration
            OutputLogger.info(`🔑 Resolving project configuration for project: ${args.projectName || 'default'}...`);
            const resolution = ProjectResolutionFix.resolveProjectSafely(args, ProjectTools as any);
            OutputLogger.info(`✅ Project resolution complete: success=${resolution.success}`);

            if (!resolution.success) {
                if (resolution.requiresSelection) {
                    return ProjectResolutionFix.showProjectSelection(resolution.availableProjects as any);
                }
                return ResponseBuilder.error(resolution.message || 'Failed to resolve project');
            }

            const projectName = resolution.project ? resolution.project.name : 'Unknown';
            const credentials = resolution.credentials || resolution.project;

            // Analyze single log type
            const result = await this.analyzeSingleLogType({
                logType: args.logType,
                environment: args.environment,
                credentials: credentials as any,
                timeFilter: {
                    minutesBack: args.minutesBack,
                    startDateTime: args.startDateTime,
                    endDateTime: args.endDateTime
                },
                slot: args.slot,  // DXP-116: Pass slot parameter to filter main/slot storage
                debug: args.debug,  // DXP-118: Pass debug parameter
                timeoutSeconds: args.timeoutSeconds  // DXP-188: Pass timeout parameter
            });

            if (result.parsedLogs.length === 0) {
                // DXP-179: Pass debugInfo so users can troubleshoot why 0 logs returned
                return this.buildEmptyResponse(args.logType!, structuredContent, result.debugInfo);
            }

            // Build response
            return this.buildResponse({
                parsedLogs: result.parsedLogs,
                errorAnalysis: result.errorAnalysis,
                perfAnalysis: result.perfAnalysis,
                aiAnalysis: result.aiAnalysis,
                healthStatus: result.healthStatus,
                recommendations: result.recommendations,
                logType: args.logType!,
                environment: args.environment,
                projectName,
                structuredContent,
                debugInfo: result.debugInfo  // DXP-118: Pass debug info
            });

        } catch (error: any) {
            OutputLogger.error(`Log analysis error: ${error}`);
            return ResponseBuilder.internalError('Failed to analyze logs', error.message);
        }
    }

    /**
     * Handle dual log type analysis (application + web)
     * DXP-114: Analyze both log types in a single call
     */
    static async handleDualLogTypeAnalysis(args: AnalyzeLogsArgs, structuredContent: boolean): Promise<any> {
        OutputLogger.info(`🔍 Analyzing ALL logs (application + web) from ${args.environment} (last ${args.minutesBack || 'custom'} minutes)`);

        // Resolve project configuration
        const resolution = ProjectResolutionFix.resolveProjectSafely(args, ProjectTools as any);

        if (!resolution.success) {
            if (resolution.requiresSelection) {
                return ProjectResolutionFix.showProjectSelection(resolution.availableProjects as any);
            }
            return ResponseBuilder.error(resolution.message || 'Failed to resolve project');
        }

        const projectName = resolution.project ? resolution.project.name : 'Unknown';
        const credentials = resolution.credentials || resolution.project;

        const timeFilter: TimeFilter = {
            minutesBack: args.minutesBack,
            startDateTime: args.startDateTime,
            endDateTime: args.endDateTime
        };

        // Analyze application logs
        OutputLogger.info('📱 Analyzing application (console) logs...');
        const appResult = await this.analyzeSingleLogType({
            logType: 'application',
            environment: args.environment!,
            credentials: credentials as any,
            timeFilter,
            slot: args.slot,  // DXP-116: Pass slot parameter
            debug: args.debug,  // DXP-118: Pass debug parameter
            timeoutSeconds: args.timeoutSeconds  // DXP-188: Pass timeout parameter
        });

        // Analyze web logs
        OutputLogger.info('🌐 Analyzing web (HTTP) logs...');
        const webResult = await this.analyzeSingleLogType({
            logType: 'web',
            environment: args.environment!,
            credentials: credentials as any,
            timeFilter,
            slot: args.slot,  // DXP-116: Pass slot parameter
            debug: args.debug,  // DXP-118: Pass debug parameter
            timeoutSeconds: args.timeoutSeconds  // DXP-188: Pass timeout parameter
        });

        // Combine results
        const combinedLogs = [...appResult.parsedLogs, ...webResult.parsedLogs];
        const combinedErrors = {
            total: appResult.errorAnalysis.total + webResult.errorAnalysis.total,
            console: appResult.errorAnalysis,
            http: webResult.errorAnalysis
        };

        // Calculate combined health score
        const totalErrors = combinedErrors.total;
        const totalLogs = combinedLogs.length;
        const combinedHealthScore = calculateHealthScore({ total: totalErrors }, totalLogs);

        // Generate combined recommendations
        const combinedRecommendations = [
            ...generateRecommendations(appResult.errorAnalysis, appResult.perfAnalysis, appResult.aiAnalysis),
            ...generateRecommendations(webResult.errorAnalysis, webResult.perfAnalysis, webResult.aiAnalysis)
        ];

        // Build dual response
        return this.buildDualResponse({
            appResult,
            webResult,
            combinedLogs,
            combinedErrors,
            combinedHealthScore,
            combinedRecommendations,
            environment: args.environment!,
            projectName,
            structuredContent
        });
    }

    /**
     * Analyze a single log type (application or web)
     * DXP-114: Extracted for reuse in dual analysis
     * DXP-116: Added slot parameter to filter main/slot storage
     * DXP-118: Added optional debug parameter for troubleshooting
     */
    static async analyzeSingleLogType(params: SingleLogTypeParams): Promise<LogAnalysisResult> {
        const { logType, environment, credentials, timeFilter, slot, debug = false, timeoutSeconds } = params;
        OutputLogger.info(`🚀 Starting log analysis: ${logType} logs from ${environment}`);

        // DXP-188: Smart timeout based on time range
        // Default: 10 minutes for large ranges (>3 days), 5 minutes for smaller ranges
        let defaultTimeoutSeconds = 5 * 60; // 5 minutes default
        if (timeFilter.minutesBack && timeFilter.minutesBack > (3 * 24 * 60)) {
            defaultTimeoutSeconds = 10 * 60; // 10 minutes for > 3 days
        }

        const TIMEOUT_MS = (timeoutSeconds || defaultTimeoutSeconds) * 1000;
        OutputLogger.info(`⏱️  Timeout set to ${TIMEOUT_MS / 1000} seconds`);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(
                `Log analysis timed out after ${TIMEOUT_MS / 1000} seconds. Try reducing the time range or increase timeoutSeconds parameter.`
            )), TIMEOUT_MS);
        });

        return Promise.race([
            this._analyzeSingleLogTypeImpl({ logType, environment, credentials, timeFilter, slot, debug }),
            timeoutPromise
        ]);
    }

    /**
     * Implementation of analyzeSingleLogType (wrapped with timeout)
     * @private
     */
    static async _analyzeSingleLogTypeImpl(params: SingleLogTypeParams): Promise<LogAnalysisResult> {
        const { logType, environment, credentials, timeFilter, slot, debug = false } = params;

        // DXP-118: Collect debug info only if requested
        let debugInfo: DebugInfo | null = null;
        if (debug) {
            debugInfo = {
                containerName: null,
                availableContainers: null,
                sasUrlHost: null,
                sasUrlPath: null,
                firstBlobDates: [],
                lastBlobDates: [],
                totalBlobsBeforeFilter: 0,
                totalBlobsAfterFilter: 0
            };
        }

        // DXP-179: Dynamically discover container (match download_logs behavior)
        OutputLogger.info(`🔍 Discovering storage containers for ${environment}...`);

        // List all available containers
        const containersResult = await StorageTools.handleListStorageContainers({
            apiKey: credentials.apiKey,
            apiSecret: credentials.apiSecret,
            projectId: credentials.projectId,
            environment
        });

        // Extract container names
        const containers = this.extractContainerList(containersResult);
        OutputLogger.info(`📦 Found ${containers.length} available containers`);

        if (containers.length === 0) {
            throw new Error('No storage containers found for this environment');
        }

        // Match container by logType (same logic as download_logs)
        let containerName: string | undefined;
        const logTypeLower = logType.toLowerCase();

        if (logTypeLower === 'application') {
            // Try exact matches first
            containerName = containers.find(c => {
                const lowerC = c.toLowerCase();
                return lowerC === 'insights-logs-appserviceconsolelogs' ||
                       lowerC === 'azure-application-logs';
            }) || containers.find(c => {
                // Fallback to partial matches
                const lowerC = c.toLowerCase();
                return lowerC.includes('consolelog') ||
                       lowerC.includes('console') ||
                       lowerC.includes('application');
            });
        } else { // web/http
            // Try exact matches first
            containerName = containers.find(c => {
                const lowerC = c.toLowerCase();
                return lowerC === 'insights-logs-appservicehttplogs' ||
                       lowerC === 'azure-web-logs';
            }) || containers.find(c => {
                // Fallback to partial matches
                const lowerC = c.toLowerCase();
                return lowerC.includes('httplog') ||
                       lowerC.includes('http') ||
                       lowerC.includes('web');
            });
        }

        if (!containerName) {
            throw new Error(
                `No container found for logType="${logType}".\n` +
                `Available containers: ${containers.join(', ')}\n` +
                `Try specifying a different logType or check your environment configuration.`
            );
        }

        if (debugInfo) debugInfo.containerName = containerName;
        OutputLogger.info(`✅ Matched container: ${containerName} (for logType: ${logType})`);

        // DXP-179 ENHANCED DEBUG: Log container discovery details
        OutputLogger.info(`🔍 [DXP-179] Container discovery:`);
        OutputLogger.info(`   - Requested logType: ${logType}`);
        OutputLogger.info(`   - Matched container: ${containerName}`);
        OutputLogger.info(`   - Total available containers: ${containers.length}`);
        OutputLogger.info(`   - Available: ${containers.join(', ')}`)

        // DXP-116: Log slot filter status
        if (slot === true) {
            OutputLogger.info(`🎯 Requesting SLOT storage (deployment slot logs)`);
        } else if (slot === false) {
            OutputLogger.info(`📍 Requesting MAIN storage (production logs, excluding slots)`);
        }

        // DXP-118: DEBUG - List ALL available containers first (only if debug=true)
        if (debug) {
            try {
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Listing ALL storage containers for ${environment}...`);
                const allContainers = await StorageTools.handleListStorageContainers({
                    apiKey: credentials.apiKey,
                    apiSecret: credentials.apiSecret,
                    projectId: credentials.projectId,
                    environment
                });
                debugInfo!.availableContainers = allContainers;
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Available containers: ${JSON.stringify(allContainers, null, 2)}`);
            } catch (debugError: any) {
                debugInfo!.availableContainers = `Error: ${debugError.message}`;
                OutputLogger.warn(`⚠️ [DXP-118 DEBUG] Failed to list containers: ${debugError.message}`);
            }
        }

        // Generate SAS URL for container
        OutputLogger.info(`🔐 Generating SAS URL for container...`);
        const sasArgs = {
            apiKey: credentials.apiKey,
            apiSecret: credentials.apiSecret,
            projectId: credentials.projectId,
            environment,
            containerName,
            permissions: 'Read',
            expiryHours: 1,
            slot: slot  // DXP-116: Pass slot parameter to storage tools
        };

        const sasResult = await StorageTools.generateStorageSasLink(sasArgs) as any;
        OutputLogger.info(`✅ SAS URL generated successfully`);
        if (!sasResult || !sasResult.data || !sasResult.data.sasUrl) {
            throw new Error('Failed to generate SAS URL for log container');
        }

        const containerSasUrl = sasResult.data.sasUrl;

        // DXP-118: DEBUG - Decode SAS URL details (only if debug=true)
        if (debug && debugInfo) {
            try {
                const parsedSasUrl = new URL(containerSasUrl);
                debugInfo.sasUrlHost = parsedSasUrl.hostname;
                debugInfo.sasUrlPath = parsedSasUrl.pathname;
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Requested container: ${containerName}`);
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Got SAS URL host: ${parsedSasUrl.hostname}`);
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Got SAS URL path: ${parsedSasUrl.pathname}`);
            } catch (debugError: any) {
                OutputLogger.warn(`⚠️ [DXP-118 DEBUG] Failed to parse SAS URL: ${debugError.message}`);
            }
        }

        // List blobs in container
        OutputLogger.info('📋 Listing log blobs...');
        OutputLogger.info(`🔍 [DXP-179] About to list blobs from container: ${containerName}`);
        OutputLogger.info(`🔍 [DXP-179] SAS URL hostname: ${new URL(containerSasUrl).hostname}`);

        let blobUrls = await AzureBlobStreamer.listBlobs(containerSasUrl);
        if (debugInfo) debugInfo.totalBlobsBeforeFilter = blobUrls.length;
        OutputLogger.info(`✅ Found ${blobUrls.length} blobs BEFORE filtering`);

        // DXP-179 ENHANCED DEBUG: Show sample blob URLs
        if (blobUrls.length > 0) {
            OutputLogger.info(`🔍 [DXP-179] Sample blob URLs (first 3):`);
            blobUrls.slice(0, 3).forEach((url: string, i: number) => {
                // Extract just the blob path (after container name)
                const pathMatch = url.match(/\/([^?]+)\?/);
                const blobPath = pathMatch ? pathMatch[1] : 'unknown';
                OutputLogger.info(`   ${i + 1}. ${blobPath}`);
            });
        }

        // DXP-179: Warn if no blobs found
        if (blobUrls.length === 0) {
            OutputLogger.warn(`⚠️  NO BLOBS FOUND in container: ${containerName}`);
            OutputLogger.warn(`   Possible causes:`);
            OutputLogger.warn(`   - Container is empty (no logs generated yet)`);
            OutputLogger.warn(`   - Wrong time range (logs might be older/newer)`);
            OutputLogger.warn(`   - Logs not being written to this container`);
            OutputLogger.warn(`\n💡 Try: Use download_logs with logType="${logType}" to verify container has logs`);
        }

        // DXP-118: DEBUG - Sample blob timestamps (only if debug=true)
        if (debug && debugInfo && blobUrls.length > 0) {
            OutputLogger.info(`🔍 [DXP-118 DEBUG] Sampling blob timestamps...`);

            // First 5 blobs
            const sampleBlobs = blobUrls.slice(0, 5);
            OutputLogger.info(`🔍 [DXP-118 DEBUG] First 5 blob URLs:`);
            sampleBlobs.forEach((url: string, i: number) => {
                const match = url.match(/y=(\d{4})\/m=(\d{2})\/d=(\d{2})/);
                if (match) {
                    const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
                    debugInfo!.firstBlobDates.push(dateStr);
                    OutputLogger.info(`  ${i + 1}. Date: ${dateStr}`);
                } else {
                    OutputLogger.info(`  ${i + 1}. No date pattern found in: ${url.substring(0, 150)}...`);
                }
            });

            // Last 5 blobs
            const lastBlobs = blobUrls.slice(-5);
            OutputLogger.info(`🔍 [DXP-118 DEBUG] Last 5 blob URLs:`);
            lastBlobs.forEach((url: string, i: number) => {
                const match = url.match(/y=(\d{4})\/m=(\d{2})\/d=(\d{2})/);
                if (match) {
                    const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
                    debugInfo!.lastBlobDates.push(dateStr);
                    OutputLogger.info(`  ${i + 1}. Date: ${dateStr}`);
                } else {
                    OutputLogger.info(`  ${i + 1}. No date pattern found in: ${url.substring(0, 150)}...`);
                }
            });
        } else if (debug && blobUrls.length === 0) {
            OutputLogger.warn(`⚠️ [DXP-118 DEBUG] No blobs found in container!`);
        }

        // DXP-116: Filter by slot parameter (main site vs deployment slot)
        if (slot !== undefined) {
            const beforeSlotFilter = blobUrls.length;
            blobUrls = blobUrls.filter((url: string) => {
                const nameUpper = url.toUpperCase();
                if (slot === true) {
                    // slot=true: Only include deployment slot logs (/SLOTS/SLOT/)
                    return nameUpper.includes('/SLOTS/SLOT/');
                } else if (slot === false) {
                    // slot=false (default): Exclude ALL slot logs (any /SLOTS/ path)
                    return !nameUpper.includes('/SLOTS/');
                }
                return true;
            });
            OutputLogger.info(`After slot filter (slot=${slot}): ${blobUrls.length} blobs (removed ${beforeSlotFilter - blobUrls.length})`);
        }

        // Filter blobs by date
        const beforeDateFilter = blobUrls.length;
        const filteredBlobs = AzureBlobStreamer.filterBlobsByDate(blobUrls, { ...timeFilter, debug });  // DXP-189: Pass debug flag
        if (debugInfo) debugInfo.totalBlobsAfterFilter = filteredBlobs.length;

        // DXP-179: Debug logging for date filter stage
        const removedByDateFilter = beforeDateFilter - filteredBlobs.length;
        OutputLogger.info(`After date filter: ${filteredBlobs.length} blobs (removed ${removedByDateFilter})`);

        if (filteredBlobs.length === 0 && beforeDateFilter > 0) {
            OutputLogger.warn(`⚠️  All ${beforeDateFilter} blobs filtered out by date range`);
            OutputLogger.warn(`   Time filter: ${JSON.stringify(timeFilter)}`);
            OutputLogger.warn(`💡 Try: Expand the time range or check if logs exist for this period`);
        }

        // Stream and parse logs
        const parsedLogs: ParsedLog[] = [];
        let totalBytes = 0;
        let totalLines = 0;

        for (const blobUrl of filteredBlobs) {
            try {
                // DXP-179: Pass debug flag so parsing errors are logged
                const stats = await AzureBlobStreamer.streamBlob(blobUrl, async (line: string) => {
                    const parsed = parseLogEntry(line, debug);  // DXP-179: Pass debug to parser
                    if (parsed) {
                        parsedLogs.push(parsed);
                    }
                }, { debug });

                totalBytes += stats.bytesDownloaded;
                totalLines += stats.linesProcessed;
            } catch (error: any) {
                OutputLogger.debug(`Skipping blob ${blobUrl}: ${error.message}`);
            }
        }

        OutputLogger.info(`✅ Parsed ${parsedLogs.length} log entries from ${totalLines} lines (${Math.round(totalBytes / 1024)} KB)`);

        // Analyze logs
        const errorAnalysis = analyzeErrors(parsedLogs);
        const perfAnalysis = analyzePerformance(parsedLogs);
        const aiAnalysis = detectAIAgents(parsedLogs);
        const healthStatus = calculateHealthScore(errorAnalysis, parsedLogs.length);
        const recommendations = generateRecommendations(errorAnalysis, perfAnalysis, aiAnalysis);

        return {
            parsedLogs,
            errorAnalysis,
            perfAnalysis,
            aiAnalysis,
            healthStatus,
            recommendations,
            debugInfo  // DXP-118: Include debug info for investigation
        };
    }

    /**
     * Build empty response for no logs found
     * DXP-179: Added debugInfo parameter to help troubleshoot why 0 logs returned
     */
    static buildEmptyResponse(logType: string, structuredContent: boolean, debugInfo?: any): any {
        let message = `No ${logType} logs found in the specified time range`;

        // DXP-179: Add debug section to message if debug info available
        if (debugInfo) {
            message += `\n\n## 🔍 Debug Info (DXP-179 Investigation)\n\n`;
            message += `**Container Requested:** ${debugInfo.containerName}\n`;
            message += `**SAS URL Host:** ${debugInfo.sasUrlHost || 'N/A'}\n`;
            message += `**SAS URL Path:** ${debugInfo.sasUrlPath || 'N/A'}\n`;
            message += `**Total Blobs Found:** ${debugInfo.totalBlobsBeforeFilter}\n`;
            message += `**Blobs After Filtering:** ${debugInfo.totalBlobsAfterFilter}\n`;
            if (debugInfo.firstBlobDates && debugInfo.firstBlobDates.length > 0) {
                message += `**First Blob Dates:** ${debugInfo.firstBlobDates.join(', ')}\n`;
            }
            if (debugInfo.lastBlobDates && debugInfo.lastBlobDates.length > 0) {
                message += `**Last Blob Dates:** ${debugInfo.lastBlobDates.join(', ')}\n`;
            }
            if (debugInfo.availableContainers) {
                message += `\n**Available Containers:**\n\`\`\`json\n${JSON.stringify(debugInfo.availableContainers, null, 2)}\n\`\`\`\n`;
            }
        }

        if (structuredContent) {
            return ResponseBuilder.successWithStructuredData({
                summary: {
                    totalLogs: 0,
                    httpLogs: logType === 'web' ? 0 : null,
                    consoleLogs: logType === 'application' ? 0 : null,
                    healthScore: 100,
                    healthy: true,
                    timeRange: {
                        start: null,
                        end: null,
                        startFormatted: null,  // DXP-138: Human-friendly format
                        endFormatted: null      // DXP-138: Human-friendly format
                    }
                },
                errors: { total: 0, byStatusCode: {}, topErrors: [] },
                performance: {
                    avgResponseTime: null,
                    p95ResponseTime: null,
                    p99ResponseTime: null,
                    slowestPaths: []
                },
                aiAgents: { detected: [], byAgent: {} },
                recommendations: [],
                // DXP-179: Include debug info in structured response when debug flag is set
                ...(debugInfo && { debug: debugInfo })
            }, message);
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Build structured response
     */
    static buildResponse(data: any): any {
        const {
            parsedLogs,
            errorAnalysis,
            perfAnalysis,
            aiAnalysis,
            healthStatus,
            recommendations,
            logType,
            environment,
            projectName,
            structuredContent,
            debugInfo
        } = data;

        // Calculate time range
        const timestamps = parsedLogs.map((log: ParsedLog) => log.timestamp).filter((t: any) => t instanceof Date);
        const startISO = timestamps.length > 0 ? new Date(Math.min(...timestamps.map((t: Date) => t.getTime()))).toISOString() : null;
        const endISO = timestamps.length > 0 ? new Date(Math.max(...timestamps.map((t: Date) => t.getTime()))).toISOString() : null;

        // DXP-138: Add human-friendly timestamp formatting
        const timeRange: TimeRange = {
            start: startISO,
            end: endISO,
            startFormatted: LogAnalysisTools.formatTimestamp(startISO),
            endFormatted: LogAnalysisTools.formatTimestamp(endISO)
        };

        // Build formatted message
        let message = `# 📊 Log Analysis Report\n\n`;

        // DXP-118: Add debug section at top if debug info available
        if (debugInfo) {
            message += `## 🔍 Debug Info (DXP-118 Investigation)\n\n`;
            message += `**Container Requested:** ${debugInfo.containerName}\n`;
            message += `**SAS URL Host:** ${debugInfo.sasUrlHost || 'N/A'}\n`;
            message += `**SAS URL Path:** ${debugInfo.sasUrlPath || 'N/A'}\n`;
            message += `**Total Blobs Found:** ${debugInfo.totalBlobsBeforeFilter}\n`;
            message += `**Blobs After Filtering:** ${debugInfo.totalBlobsAfterFilter}\n`;
            if (debugInfo.firstBlobDates.length > 0) {
                message += `**First Blob Dates:** ${debugInfo.firstBlobDates.join(', ')}\n`;
            }
            if (debugInfo.lastBlobDates.length > 0) {
                message += `**Last Blob Dates:** ${debugInfo.lastBlobDates.join(', ')}\n`;
            }
            if (debugInfo.availableContainers) {
                message += `\n**Available Containers:**\n\`\`\`json\n${JSON.stringify(debugInfo.availableContainers, null, 2)}\n\`\`\`\n`;
            }
            message += `\n---\n\n`;
        }

        message += `**Project:** ${projectName}\n`;
        message += `**Environment:** ${environment}\n`;
        message += `**Log Type:** ${logType}\n`;
        message += `**Total Logs:** ${parsedLogs.length}\n`;
        message += `**Health Score:** ${healthStatus.score}/100 ${healthStatus.healthy ? '✅' : '⚠️'}\n\n`;

        if (errorAnalysis.total > 0) {
            message += `## 🚨 Errors (${errorAnalysis.total})\n\n`;
            const topCodes = Object.entries(errorAnalysis.byStatusCode)
                .sort((a, b) => (b[1] as number) - (a[1] as number))
                .slice(0, 5);
            for (const [code, count] of topCodes) {
                message += `- **${code}**: ${count} errors\n`;
            }
            message += '\n';
        }

        if (perfAnalysis.avgResponseTime !== null) {
            message += `## ⏱️ Performance\n\n`;
            message += `- **Avg:** ${perfAnalysis.avgResponseTime}ms\n`;
            message += `- **P95:** ${perfAnalysis.p95ResponseTime}ms\n`;
            message += `- **P99:** ${perfAnalysis.p99ResponseTime}ms\n\n`;
        }

        if (aiAnalysis.detected.length > 0) {
            message += `## 🤖 AI Agents (${aiAnalysis.detected.length})\n\n`;
            for (const agent of aiAnalysis.detected) {
                const stats = aiAnalysis.byAgent[agent];
                message += `- **${agent}**: ${stats.requests} requests (${(stats.successRate * 100).toFixed(0)}% success)\n`;
            }
            message += '\n';
        }

        if (recommendations.length > 0) {
            message += `## 💡 Recommendations\n\n`;
            for (const rec of recommendations) {
                message += `- ${rec}\n`;
            }
        }

        if (structuredContent) {
            // DXP-110: Guaranteed structured output with null safety
            const structuredData = {
                summary: {
                    totalLogs: parsedLogs.length,
                    httpLogs: logType === 'web' ? parsedLogs.length : null,
                    consoleLogs: logType === 'application' ? parsedLogs.length : null,
                    healthScore: healthStatus.score,
                    healthy: healthStatus.healthy,
                    timeRange
                },
                errors: {
                    total: errorAnalysis.total,
                    byStatusCode: errorAnalysis.byStatusCode || {},
                    topErrors: errorAnalysis.topErrors || []
                },
                performance: {
                    avgResponseTime: perfAnalysis.avgResponseTime,
                    p95ResponseTime: perfAnalysis.p95ResponseTime,
                    p99ResponseTime: perfAnalysis.p99ResponseTime,
                    slowestPaths: perfAnalysis.slowestPaths || []
                },
                aiAgents: {
                    detected: aiAnalysis.detected || [],
                    byAgent: aiAnalysis.byAgent || {}
                },
                recommendations: recommendations || [],
                // DXP-179: Include debug info in structured response when debug flag is set
                ...(debugInfo && { debug: debugInfo })
            };

            return ResponseBuilder.successWithStructuredData(structuredData, message);
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Build dual response for logType: 'all'
     * DXP-114: Combines application + web log analysis
     */
    static buildDualResponse(data: any): any {
        const {
            appResult,
            webResult,
            combinedLogs,
            combinedErrors,
            combinedHealthScore,
            combinedRecommendations,
            environment,
            projectName,
            structuredContent
        } = data;

        // Calculate time ranges
        const appTimestamps = appResult.parsedLogs.map((log: ParsedLog) => log.timestamp).filter((t: any) => t instanceof Date);
        const webTimestamps = webResult.parsedLogs.map((log: ParsedLog) => log.timestamp).filter((t: any) => t instanceof Date);
        const allTimestamps = [...appTimestamps, ...webTimestamps];

        const startISO = allTimestamps.length > 0 ? new Date(Math.min(...allTimestamps.map((t: Date) => t.getTime()))).toISOString() : null;
        const endISO = allTimestamps.length > 0 ? new Date(Math.max(...allTimestamps.map((t: Date) => t.getTime()))).toISOString() : null;

        // DXP-138: Add human-friendly timestamp formatting
        const timeRange: TimeRange = {
            start: startISO,
            end: endISO,
            startFormatted: LogAnalysisTools.formatTimestamp(startISO),
            endFormatted: LogAnalysisTools.formatTimestamp(endISO)
        };

        // Build formatted message
        let message = `# 📊 Combined Log Analysis Report\n\n`;
        message += `**Project:** ${projectName}\n`;
        message += `**Environment:** ${environment}\n`;
        message += `**Log Types:** Application + Web (ALL)\n`;
        message += `**Total Logs:** ${combinedLogs.length} (${appResult.parsedLogs.length} console + ${webResult.parsedLogs.length} HTTP)\n`;
        message += `**Health Score:** ${combinedHealthScore.score}/100 ${combinedHealthScore.healthy ? '✅' : '⚠️'}\n\n`;

        if (combinedErrors.total > 0) {
            message += `## 🚨 Errors (${combinedErrors.total} total)\n\n`;

            // Console errors
            if (combinedErrors.console.total > 0) {
                message += `### 📱 Console Errors (${combinedErrors.console.total})\n`;
                const topConsoleErrors = (combinedErrors.console.topErrors || []).slice(0, 3);
                for (const error of topConsoleErrors) {
                    message += `- ${error.message} (${error.count}x)\n`;
                }
                message += '\n';
            }

            // HTTP errors
            if (combinedErrors.http.total > 0) {
                message += `### 🌐 HTTP Errors (${combinedErrors.http.total})\n`;
                const topCodes = Object.entries(combinedErrors.http.byStatusCode || {})
                    .sort((a: any, b: any) => b[1] - a[1])
                    .slice(0, 5);
                for (const [code, count] of topCodes) {
                    message += `- **${code}**: ${count} errors\n`;
                }
                message += '\n';
            }
        }

        if (webResult.perfAnalysis.avgResponseTime !== null) {
            message += `## ⏱️ Performance (HTTP)\n\n`;
            message += `- **Avg:** ${webResult.perfAnalysis.avgResponseTime}ms\n`;
            message += `- **P95:** ${webResult.perfAnalysis.p95ResponseTime}ms\n`;
            message += `- **P99:** ${webResult.perfAnalysis.p99ResponseTime}ms\n\n`;
        }

        // Combine AI agents from both log types
        const allAIAgents = new Set([...appResult.aiAnalysis.detected, ...webResult.aiAnalysis.detected]);
        if (allAIAgents.size > 0) {
            message += `## 🤖 AI Agents (${allAIAgents.size})\n\n`;
            for (const agent of allAIAgents) {
                const appStats = appResult.aiAnalysis.byAgent[agent];
                const webStats = webResult.aiAnalysis.byAgent[agent];
                const totalRequests = (appStats?.requests || 0) + (webStats?.requests || 0);
                const avgSuccessRate = appStats && webStats
                    ? ((appStats.successRate + webStats.successRate) / 2)
                    : (appStats?.successRate || webStats?.successRate || 0);
                message += `- **${agent}**: ${totalRequests} requests (${(avgSuccessRate * 100).toFixed(0)}% success)\n`;
            }
            message += '\n';
        }

        if (combinedRecommendations.length > 0) {
            message += `## 💡 Recommendations\n\n`;
            // Deduplicate recommendations
            const uniqueRecs = [...new Set(combinedRecommendations)];
            for (const rec of uniqueRecs) {
                message += `- ${rec}\n`;
            }
        }

        if (structuredContent) {
            // DXP-114: Structured output with separate breakdowns
            const structuredData = {
                summary: {
                    totalLogs: combinedLogs.length,
                    consoleLogs: appResult.parsedLogs.length,
                    httpLogs: webResult.parsedLogs.length,
                    healthScore: combinedHealthScore.score,
                    healthy: combinedHealthScore.healthy,
                    timeRange
                },
                errors: {
                    total: combinedErrors.total,
                    console: {
                        total: combinedErrors.console.total,
                        topErrors: combinedErrors.console.topErrors || []
                    },
                    http: {
                        total: combinedErrors.http.total,
                        byStatusCode: combinedErrors.http.byStatusCode || {},
                        topErrors: combinedErrors.http.topErrors || []
                    }
                },
                performance: {
                    avgResponseTime: webResult.perfAnalysis.avgResponseTime,
                    p95ResponseTime: webResult.perfAnalysis.p95ResponseTime,
                    p99ResponseTime: webResult.perfAnalysis.p99ResponseTime,
                    slowestPaths: webResult.perfAnalysis.slowestPaths || []
                },
                aiAgents: {
                    detected: [...allAIAgents],
                    byAgent: {
                        ...appResult.aiAnalysis.byAgent,
                        ...webResult.aiAnalysis.byAgent
                    }
                },
                recommendations: [...new Set(combinedRecommendations)]
            };

            return ResponseBuilder.successWithStructuredData(structuredData, message);
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Handle compare_logs command
     * Compares baseline vs slot log analysis for deployment decisions
     */
    static async handleCompareLogs(args: CompareLogsArgs): Promise<any> {
        try {
            const { baseline, slot, thresholds } = args;

            // Validate inputs
            if (!baseline || !slot) {
                return ResponseBuilder.error('Both baseline and slot analysis results are required');
            }

            // Perform comparison
            const comparison = compareLogs(baseline, slot, thresholds);

            // Build human-readable message
            let message = `# 🔍 Log Comparison Report\n\n`;
            message += `**Decision:** ${comparison.decision.toUpperCase()} ${LogAnalysisTools.getDecisionEmoji(comparison.decision)}\n`;
            message += `**Recommendation:** ${comparison.recommendation.toUpperCase()}\n\n`;

            message += `## 📊 Metrics Comparison\n\n`;
            message += `| Metric | Baseline | Slot | Delta |\n`;
            message += `|--------|----------|------|-------|\n`;
            message += `| **Errors** | ${comparison.baseline.totalErrors} | ${comparison.slot.totalErrors} | ${LogAnalysisTools.formatDelta(comparison.deltas.errorDelta)} (${LogAnalysisTools.formatPercent(comparison.deltas.errorDeltaPercent)}) |\n`;
            message += `| **Health Score** | ${comparison.baseline.healthScore} | ${comparison.slot.healthScore} | ${LogAnalysisTools.formatDelta(comparison.deltas.scoreDelta)} pts |\n`;
            message += `| **P95 Latency** | ${comparison.baseline.p95Latency}ms | ${comparison.slot.p95Latency}ms | ${LogAnalysisTools.formatDelta(comparison.deltas.latencyDelta)}ms |\n\n`;

            if (comparison.reasons.length > 0) {
                message += `## ${comparison.decision === 'safe' ? '✅' : '⚠️'} Analysis\n\n`;
                for (const reason of comparison.reasons) {
                    message += `- ${reason}\n`;
                }
                message += '\n';
            }

            message += `## 🎯 Thresholds Applied\n\n`;
            message += `- **Max Error Increase:** ${comparison.thresholdsApplied.maxErrorIncrease}%\n`;
            message += `- **Max Score Decrease:** ${comparison.thresholdsApplied.maxScoreDecrease} points\n`;
            message += `- **Max Latency Increase:** ${comparison.thresholdsApplied.maxLatencyIncrease}ms\n`;

            // Return with structured data
            return ResponseBuilder.successWithStructuredData(comparison, message);

        } catch (error: any) {
            OutputLogger.error(`Log comparison error: ${error}`);
            return ResponseBuilder.internalError('Failed to compare logs', error.message);
        }
    }

    /**
     * Helper: Format timestamp for human readability
     * DXP-138: Convert ISO timestamp to "Oct 17 at 5:42 PM UTC" format
     */
    static formatTimestamp(date: string | null): string | null {
        if (!date) return null;

        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const d = new Date(date);

        const month = months[d.getUTCMonth()];
        const day = d.getUTCDate();
        let hours = d.getUTCHours();
        const minutes = d.getUTCMinutes().toString().padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12 || 12; // Convert 0 to 12 for midnight

        return `${month} ${day} at ${hours}:${minutes} ${ampm} UTC`;
    }

    /**
     * Helper: Get emoji for decision
     */
    static getDecisionEmoji(decision: string): string {
        switch (decision) {
            case 'safe': return '✅';
            case 'warning': return '⚠️';
            case 'critical': return '🚨';
            default: return '';
        }
    }

    /**
     * Helper: Format delta with +/- sign
     */
    static formatDelta(delta: number): string {
        if (delta > 0) return `+${delta}`;
        if (delta < 0) return delta.toString();
        return '0';
    }

    /**
     * Helper: Format percentage
     */
    static formatPercent(percent: number): string {
        const sign = percent > 0 ? '+' : '';
        return `${sign}${percent}%`;
    }

    /**
     * Extract container list from storage tools response
     * DXP-179: Helper method for dynamic container discovery
     */
    static extractContainerList(result: any): string[] {
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

        const containers: string[] = [];
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
}

export default LogAnalysisTools;
