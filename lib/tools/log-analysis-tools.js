/**
 * Log Analysis Tools Module
 * Handles streaming log analysis from Azure Storage
 * Part of Jaxon Digital Optimizely DXP MCP Server (DXP-110)
 */

const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');
const StorageTools = require('./storage-tools');
const ProjectTools = require('./project-tools');
const ProjectResolutionFix = require('./project-resolution-fix');
const AzureBlobStreamer = require('../azure-blob-streamer');
const { parseLogEntry } = require('../log-analysis/log-parser');
const {
    analyzeErrors,
    analyzePerformance,
    detectAIAgents,
    calculateHealthScore,
    generateRecommendations
} = require('../log-analysis/analyzers');
const { compareLogs } = require('../log-analysis/log-comparator');

class LogAnalysisTools {
    /**
     * Handle analyze_logs_streaming command
     */
    static async handleAnalyzeLogsStreaming(args) {
        try {
            // Default environment to Production
            if (!args.environment) {
                args.environment = 'Production';
            }

            // Default logType to web (HTTP logs)
            if (!args.logType) {
                args.logType = 'web';
            }

            // Default minutesBack to 60
            if (!args.minutesBack && !args.startDateTime && !args.endDateTime) {
                args.minutesBack = 60;
            }

            // Default structuredContent to true
            const structuredContent = args.structuredContent !== false;

            // DXP-114: Handle logType: 'all' for dual log type analysis
            if (args.logType === 'all') {
                return this.handleDualLogTypeAnalysis(args, structuredContent);
            }

            OutputLogger.info(`🔍 Analyzing ${args.logType} logs from ${args.environment} (last ${args.minutesBack || 'custom'} minutes)`);

            // Resolve project configuration
            const resolution = ProjectResolutionFix.resolveProjectSafely(args, ProjectTools);

            if (!resolution.success) {
                if (resolution.requiresSelection) {
                    return ProjectResolutionFix.showProjectSelection(resolution.availableProjects);
                }
                return ResponseBuilder.error(resolution.message || 'Failed to resolve project');
            }

            const projectName = resolution.project ? resolution.project.name : 'Unknown';
            const credentials = resolution.credentials || resolution.project;

            // Analyze single log type
            const result = await this.analyzeSingleLogType({
                logType: args.logType,
                environment: args.environment,
                credentials,
                timeFilter: {
                    minutesBack: args.minutesBack,
                    startDateTime: args.startDateTime,
                    endDateTime: args.endDateTime
                },
                slot: args.slot,  // DXP-116: Pass slot parameter to filter main/slot storage
                debug: args.debug  // DXP-118: Pass debug parameter
            });

            if (result.parsedLogs.length === 0) {
                return this.buildEmptyResponse(args.logType, structuredContent);
            }

            // Build response
            return this.buildResponse({
                parsedLogs: result.parsedLogs,
                errorAnalysis: result.errorAnalysis,
                perfAnalysis: result.perfAnalysis,
                aiAnalysis: result.aiAnalysis,
                healthStatus: result.healthStatus,
                recommendations: result.recommendations,
                logType: args.logType,
                environment: args.environment,
                projectName,
                structuredContent,
                debugInfo: result.debugInfo  // DXP-118: Pass debug info
            });

        } catch (error) {
            OutputLogger.error('Log analysis error:', error);
            return ResponseBuilder.internalError('Failed to analyze logs', error.message);
        }
    }

    /**
     * Handle dual log type analysis (application + web)
     * DXP-114: Analyze both log types in a single call
     */
    static async handleDualLogTypeAnalysis(args, structuredContent) {
        OutputLogger.info(`🔍 Analyzing ALL logs (application + web) from ${args.environment} (last ${args.minutesBack || 'custom'} minutes)`);

        // Resolve project configuration
        const resolution = ProjectResolutionFix.resolveProjectSafely(args, ProjectTools);

        if (!resolution.success) {
            if (resolution.requiresSelection) {
                return ProjectResolutionFix.showProjectSelection(resolution.availableProjects);
            }
            return ResponseBuilder.error(resolution.message || 'Failed to resolve project');
        }

        const projectName = resolution.project ? resolution.project.name : 'Unknown';
        const credentials = resolution.credentials || resolution.project;

        const timeFilter = {
            minutesBack: args.minutesBack,
            startDateTime: args.startDateTime,
            endDateTime: args.endDateTime
        };

        // Analyze application logs
        OutputLogger.info('📱 Analyzing application (console) logs...');
        const appResult = await this.analyzeSingleLogType({
            logType: 'application',
            environment: args.environment,
            credentials,
            timeFilter,
            slot: args.slot,  // DXP-116: Pass slot parameter
            debug: args.debug  // DXP-118: Pass debug parameter
        });

        // Analyze web logs
        OutputLogger.info('🌐 Analyzing web (HTTP) logs...');
        const webResult = await this.analyzeSingleLogType({
            logType: 'web',
            environment: args.environment,
            credentials,
            timeFilter,
            slot: args.slot,  // DXP-116: Pass slot parameter
            debug: args.debug  // DXP-118: Pass debug parameter
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
            environment: args.environment,
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
    static async analyzeSingleLogType({ logType, environment, credentials, timeFilter, slot, debug = false }) {
        // DXP-118: Collect debug info only if requested
        let debugInfo = null;
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

        // Determine container name based on logType
        const containerName = logType === 'application'
            ? 'insights-logs-appserviceconsolelogs'
            : 'insights-logs-appservicehttplogs';

        if (debugInfo) debugInfo.containerName = containerName;
        OutputLogger.info(`📦 Using container: ${containerName}`);

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
                debugInfo.availableContainers = allContainers;
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Available containers:`, JSON.stringify(allContainers, null, 2));
            } catch (debugError) {
                debugInfo.availableContainers = `Error: ${debugError.message}`;
                OutputLogger.warn(`⚠️ [DXP-118 DEBUG] Failed to list containers: ${debugError.message}`);
            }
        }

        // Generate SAS URL for container
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

        const sasResult = await StorageTools.generateStorageSasLink(sasArgs);
        if (!sasResult || !sasResult.data || !sasResult.data.sasUrl) {
            throw new Error('Failed to generate SAS URL for log container');
        }

        const containerSasUrl = sasResult.data.sasUrl;

        // DXP-118: DEBUG - Decode SAS URL details (only if debug=true)
        if (debug) {
            try {
                const parsedSasUrl = new URL(containerSasUrl);
                debugInfo.sasUrlHost = parsedSasUrl.hostname;
                debugInfo.sasUrlPath = parsedSasUrl.pathname;
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Requested container: ${containerName}`);
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Got SAS URL host: ${parsedSasUrl.hostname}`);
                OutputLogger.info(`🔍 [DXP-118 DEBUG] Got SAS URL path: ${parsedSasUrl.pathname}`);
            } catch (debugError) {
                OutputLogger.warn(`⚠️ [DXP-118 DEBUG] Failed to parse SAS URL: ${debugError.message}`);
            }
        }

        // List blobs in container
        OutputLogger.info('📋 Listing log blobs...');
        let blobUrls = await AzureBlobStreamer.listBlobs(containerSasUrl);
        if (debugInfo) debugInfo.totalBlobsBeforeFilter = blobUrls.length;
        OutputLogger.info(`Found ${blobUrls.length} blobs`);

        // DXP-118: DEBUG - Sample blob timestamps (only if debug=true)
        if (debug && blobUrls.length > 0) {
            OutputLogger.info(`🔍 [DXP-118 DEBUG] Sampling blob timestamps...`);

            // First 5 blobs
            const sampleBlobs = blobUrls.slice(0, 5);
            OutputLogger.info(`🔍 [DXP-118 DEBUG] First 5 blob URLs:`);
            sampleBlobs.forEach((url, i) => {
                const match = url.match(/y=(\d{4})\/m=(\d{2})\/d=(\d{2})/);
                if (match) {
                    const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
                    debugInfo.firstBlobDates.push(dateStr);
                    OutputLogger.info(`  ${i + 1}. Date: ${dateStr}`);
                } else {
                    OutputLogger.info(`  ${i + 1}. No date pattern found in: ${url.substring(0, 150)}...`);
                }
            });

            // Last 5 blobs
            const lastBlobs = blobUrls.slice(-5);
            OutputLogger.info(`🔍 [DXP-118 DEBUG] Last 5 blob URLs:`);
            lastBlobs.forEach((url, i) => {
                const match = url.match(/y=(\d{4})\/m=(\d{2})\/d=(\d{2})/);
                if (match) {
                    const dateStr = `${match[1]}-${match[2]}-${match[3]}`;
                    debugInfo.lastBlobDates.push(dateStr);
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
            blobUrls = blobUrls.filter(url => {
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
        const filteredBlobs = AzureBlobStreamer.filterBlobsByDate(blobUrls, timeFilter);
        if (debugInfo) debugInfo.totalBlobsAfterFilter = filteredBlobs.length;
        OutputLogger.info(`Filtered to ${filteredBlobs.length} blobs in time range`);

        // Stream and parse logs
        const parsedLogs = [];
        let totalBytes = 0;
        let totalLines = 0;

        for (const blobUrl of filteredBlobs) {
            try {
                const stats = await AzureBlobStreamer.streamBlob(blobUrl, async (line) => {
                    const parsed = parseLogEntry(line);
                    if (parsed) {
                        parsedLogs.push(parsed);
                    }
                });

                totalBytes += stats.bytesDownloaded;
                totalLines += stats.linesProcessed;
            } catch (error) {
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
     */
    static buildEmptyResponse(logType, structuredContent) {
        const message = `No ${logType} logs found in the specified time range`;

        if (structuredContent) {
            return ResponseBuilder.successWithStructuredData({
                summary: {
                    totalLogs: 0,
                    httpLogs: logType === 'web' ? 0 : null,
                    consoleLogs: logType === 'application' ? 0 : null,
                    healthScore: 100,
                    healthy: true,
                    timeRange: { start: null, end: null }
                },
                errors: { total: 0, byStatusCode: {}, topErrors: [] },
                performance: {
                    avgResponseTime: null,
                    p95ResponseTime: null,
                    p99ResponseTime: null,
                    slowestPaths: []
                },
                aiAgents: { detected: [], byAgent: {} },
                recommendations: []
            }, message);
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Build structured response
     */
    static buildResponse(data) {
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
        const timestamps = parsedLogs.map(log => log.timestamp).filter(t => t instanceof Date);
        const timeRange = {
            start: timestamps.length > 0 ? new Date(Math.min(...timestamps.map(t => t.getTime()))).toISOString() : null,
            end: timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => t.getTime()))).toISOString() : null
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
                .sort((a, b) => b[1] - a[1])
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
                recommendations: recommendations || []
            };

            return ResponseBuilder.successWithStructuredData(structuredData, message);
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Build dual response for logType: 'all'
     * DXP-114: Combines application + web log analysis
     */
    static buildDualResponse(data) {
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
        const appTimestamps = appResult.parsedLogs.map(log => log.timestamp).filter(t => t instanceof Date);
        const webTimestamps = webResult.parsedLogs.map(log => log.timestamp).filter(t => t instanceof Date);
        const allTimestamps = [...appTimestamps, ...webTimestamps];

        const timeRange = {
            start: allTimestamps.length > 0 ? new Date(Math.min(...allTimestamps.map(t => t.getTime()))).toISOString() : null,
            end: allTimestamps.length > 0 ? new Date(Math.max(...allTimestamps.map(t => t.getTime()))).toISOString() : null
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
                    .sort((a, b) => b[1] - a[1])
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
    static async handleCompareLogs(args) {
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
            message += `**Decision:** ${comparison.decision.toUpperCase()} ${getDecisionEmoji(comparison.decision)}\n`;
            message += `**Recommendation:** ${comparison.recommendation.toUpperCase()}\n\n`;

            message += `## 📊 Metrics Comparison\n\n`;
            message += `| Metric | Baseline | Slot | Delta |\n`;
            message += `|--------|----------|------|-------|\n`;
            message += `| **Errors** | ${comparison.baseline.totalErrors} | ${comparison.slot.totalErrors} | ${formatDelta(comparison.deltas.errorDelta)} (${formatPercent(comparison.deltas.errorDeltaPercent)}) |\n`;
            message += `| **Health Score** | ${comparison.baseline.healthScore} | ${comparison.slot.healthScore} | ${formatDelta(comparison.deltas.scoreDelta)} pts |\n`;
            message += `| **P95 Latency** | ${comparison.baseline.p95Latency}ms | ${comparison.slot.p95Latency}ms | ${formatDelta(comparison.deltas.latencyDelta)}ms |\n\n`;

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

        } catch (error) {
            OutputLogger.error('Log comparison error:', error);
            return ResponseBuilder.internalError('Failed to compare logs', error.message);
        }
    }
}

/**
 * Helper: Get emoji for decision
 */
function getDecisionEmoji(decision) {
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
function formatDelta(delta) {
    if (delta > 0) return `+${delta}`;
    if (delta < 0) return delta.toString();
    return '0';
}

/**
 * Helper: Format percentage
 */
function formatPercent(percent) {
    const sign = percent > 0 ? '+' : '';
    return `${sign}${percent}%`;
}

module.exports = LogAnalysisTools;
