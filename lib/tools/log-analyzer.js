/**
 * Intelligent Log Analyzer
 * AI-powered log analysis for Optimizely DXP
 * Part of Jaxon Digital Optimizely DXP MCP Server
 * 
 * This module provides intelligent analysis of application and web logs,
 * enabling natural language queries like "find errors in the last hour"
 */

const ResponseBuilder = require('../response-builder');
const LogDownloadTools = require('./log-download-tools');
const StorageTools = require('./storage-tools');
const OutputLogger = require('../output-logger');

class LogAnalyzer {
    /**
     * Common log patterns we can detect
     */
    static PATTERNS = {
        error: {
            regex: /ERROR|FATAL|Exception|Failed|Failure|Error:|crashed|critical/i,
            severity: 'high',
            description: 'Error or exception'
        },
        warning: {
            regex: /WARN|WARNING|Warning:|deprecated|timeout/i,
            severity: 'medium',
            description: 'Warning or potential issue'
        },
        security: {
            regex: /unauthorized|forbidden|denied|authentication failed|invalid token|security/i,
            severity: 'high',
            description: 'Security-related event'
        },
        performance: {
            regex: /slow|timeout|exceeded|latency|performance|took \d{4,}ms/i,
            severity: 'medium',
            description: 'Performance issue'
        },
        database: {
            regex: /sql|database|query|connection|transaction|deadlock/i,
            severity: 'medium',
            description: 'Database operation'
        },
        deployment: {
            regex: /deploy|deployment|release|rollback|build|package/i,
            severity: 'info',
            description: 'Deployment activity'
        },
        cache: {
            regex: /cache|cached|cache miss|cache hit|invalidate/i,
            severity: 'info',
            description: 'Cache operation'
        },
        api: {
            regex: /API|REST|endpoint|request|response|webhook/i,
            severity: 'info',
            description: 'API activity'
        },
        user: {
            regex: /login|logout|session|user|authentication|registered/i,
            severity: 'info',
            description: 'User activity'
        },
        http_error: {
            regex: /\b(4\d{2}|5\d{2})\b|404|500|503|502|401|403/,
            severity: 'high',
            description: 'HTTP error status'
        }
    };

    /**
     * Analyze logs with intelligent pattern matching
     */
    static async analyzeLogs(args) {
        try {
            const analysis = {
                summary: {},
                patterns: {},
                timeline: {},
                recommendations: [],
                insights: []
            };

            // Get log content (preview mode to analyze without downloading)
            const logsResult = await this.getLogContent(args);
            if (!logsResult || !logsResult.logs) {
                return ResponseBuilder.error('No logs found for analysis');
            }

            const logs = logsResult.logs;
            
            // Perform analysis
            analysis.summary = this.analyzeSummary(logs);
            analysis.patterns = this.detectPatterns(logs);
            analysis.timeline = this.analyzeTimeline(logs);
            analysis.insights = this.generateInsights(analysis);
            analysis.recommendations = this.generateRecommendations(analysis);

            return this.formatAnalysisResult(analysis, args);
        } catch (error) {
            OutputLogger.error('Log analysis failed:', error.message);
            return ResponseBuilder.error(`Failed to analyze logs: ${error.message}`);
        }
    }

    /**
     * Get log content for analysis
     */
    static async getLogContent(args) {
        try {
            // Download logs to temp directory for analysis
            const tempDir = require('os').tmpdir();
            const tempLogPath = require('path').join(tempDir, `log-analysis-${Date.now()}`);
            
            // Create temp directory
            const fs = require('fs').promises;
            await fs.mkdir(tempLogPath, { recursive: true });
            
            // Download logs with time constraints
            const downloadArgs = {
                ...args,
                downloadPath: tempLogPath,
                skipConfirmation: true, // Skip user confirmation for analysis
                daysBack: args.daysBack || 1, // Default to last day
                logType: args.logType || 'application'
            };
            
            OutputLogger.info(`Downloading ${downloadArgs.logType} logs from ${args.environment || 'Production'} for analysis...`);
            
            // Download logs
            const downloadResult = await LogDownloadTools.handleDownloadLogs(downloadArgs);
            
            // Read downloaded log files
            const logFiles = await fs.readdir(tempLogPath);
            const logs = [];
            
            for (const file of logFiles) {
                if (file.endsWith('.log') || file.endsWith('.txt')) {
                    const filePath = require('path').join(tempLogPath, file);
                    const content = await fs.readFile(filePath, 'utf8');
                    const lines = content.split('\n').filter(line => line.trim());
                    logs.push(...lines);
                }
            }
            
            // Clean up temp files
            try {
                for (const file of logFiles) {
                    await fs.unlink(require('path').join(tempLogPath, file));
                }
                await fs.rmdir(tempLogPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            
            OutputLogger.info(`Analyzing ${logs.length} log lines...`);
            
            return {
                logs,
                metadata: {
                    environment: args.environment || 'Production',
                    logType: args.logType || 'application',
                    timeRange: `Last ${args.daysBack || 1} day(s)`,
                    totalLines: logs.length
                }
            };
        } catch (error) {
            OutputLogger.error('Failed to get log content:', error.message);
            // Return empty logs if download fails
            return {
                logs: [],
                metadata: {
                    environment: args.environment || 'Production',
                    logType: args.logType || 'application',
                    timeRange: args.timeRange || 'last 24 hours',
                    totalLines: 0,
                    error: error.message
                }
            };
        }
    }

    /**
     * Analyze summary statistics
     */
    static analyzeSummary(logs) {
        const summary = {
            totalLines: logs.length,
            errorCount: 0,
            warningCount: 0,
            uniqueErrors: new Set(),
            requestCount: 0,
            avgResponseTime: null,
            timeRange: null,
            topErrors: [],
            errorRate: 0
        };

        // Count errors and warnings
        logs.forEach(log => {
            if (this.PATTERNS.error.regex.test(log)) {
                summary.errorCount++;
                // Extract error message for uniqueness
                const errorMsg = this.extractErrorMessage(log);
                if (errorMsg) {
                    summary.uniqueErrors.add(errorMsg);
                }
            }
            if (this.PATTERNS.warning.regex.test(log)) {
                summary.warningCount++;
            }
        });

        summary.uniqueErrorCount = summary.uniqueErrors.size;
        summary.errorRate = logs.length > 0 ? (summary.errorCount / logs.length * 100).toFixed(2) : 0;

        return summary;
    }

    /**
     * Detect patterns in logs
     */
    static detectPatterns(logs) {
        const patterns = {};

        // Check each pattern
        Object.entries(this.PATTERNS).forEach(([name, pattern]) => {
            const matches = logs.filter(log => pattern.regex.test(log));
            if (matches.length > 0) {
                patterns[name] = {
                    count: matches.length,
                    percentage: (matches.length / logs.length * 100).toFixed(2),
                    severity: pattern.severity,
                    description: pattern.description,
                    samples: matches.slice(0, 3) // First 3 examples
                };
            }
        });

        return patterns;
    }

    /**
     * Analyze timeline of events
     */
    static analyzeTimeline(logs) {
        const timeline = {
            hourly: {},
            peaks: [],
            quietPeriods: []
        };

        // This would parse timestamps and create hourly buckets
        // For now, return a basic structure
        return timeline;
    }

    /**
     * Generate insights from analysis
     */
    static generateInsights(analysis) {
        const insights = [];

        // High error rate
        if (analysis.summary.errorRate > 5) {
            insights.push({
                type: 'alert',
                message: `High error rate detected: ${analysis.summary.errorRate}% of logs contain errors`,
                severity: 'high'
            });
        }

        // Security concerns
        if (analysis.patterns.security && analysis.patterns.security.count > 0) {
            insights.push({
                type: 'security',
                message: `${analysis.patterns.security.count} security-related events detected`,
                severity: 'high'
            });
        }

        // Performance issues
        if (analysis.patterns.performance && analysis.patterns.performance.count > 10) {
            insights.push({
                type: 'performance',
                message: `${analysis.patterns.performance.count} performance issues detected`,
                severity: 'medium'
            });
        }

        // Database issues
        if (analysis.patterns.database && analysis.patterns.database.count > 0) {
            const dbErrors = analysis.patterns.database.samples.filter(log => 
                /error|failed|timeout/i.test(log)
            );
            if (dbErrors.length > 0) {
                insights.push({
                    type: 'database',
                    message: `Database errors detected in ${dbErrors.length} log entries`,
                    severity: 'medium'
                });
            }
        }

        return insights;
    }

    /**
     * Generate recommendations based on analysis
     */
    static generateRecommendations(analysis) {
        const recommendations = [];

        if (analysis.summary.errorRate > 10) {
            recommendations.push('🔴 Critical: Error rate exceeds 10%. Immediate investigation recommended.');
        }

        if (analysis.summary.errorRate > 5) {
            recommendations.push('⚠️  High error rate detected. Review error logs and consider rollback if recent deployment.');
        }

        if (analysis.patterns.security) {
            recommendations.push('🔒 Security events detected. Review authentication and authorization logs.');
        }

        if (analysis.patterns.performance && analysis.patterns.performance.count > 20) {
            recommendations.push('⚡ Multiple performance issues detected. Consider scaling or optimization.');
        }

        if (analysis.patterns.database && analysis.patterns.database.count > 50) {
            recommendations.push('💾 High database activity. Check query performance and connection pooling.');
        }

        if (analysis.patterns.http_error) {
            const count = analysis.patterns.http_error.count;
            if (count > 100) {
                recommendations.push(`🌐 ${count} HTTP errors detected. Check API endpoints and external services.`);
            }
        }

        return recommendations;
    }

    /**
     * Extract error message from log line
     */
    static extractErrorMessage(log) {
        // Try to extract meaningful error message
        const patterns = [
            /Error: (.+?)$/i,
            /Exception: (.+?)$/i,
            /Failed: (.+?)$/i,
            /ERROR.*?: (.+?)$/i
        ];

        for (const pattern of patterns) {
            const match = log.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }

        return null;
    }

    /**
     * Format analysis result for output
     */
    static formatAnalysisResult(analysis, args) {
        let message = '# 📊 Log Analysis Report\n\n';
        
        message += `**Environment**: ${args.environment || 'Production'}\n`;
        message += `**Log Type**: ${args.logType || 'application'}\n`;
        message += `**Time Range**: ${args.timeRange || 'Last 24 hours'}\n\n`;

        // Summary
        message += '## 📈 Summary\n';
        message += `- **Total Log Lines**: ${analysis.summary.totalLines.toLocaleString()}\n`;
        message += `- **Errors**: ${analysis.summary.errorCount} (${analysis.summary.errorRate}%)\n`;
        message += `- **Warnings**: ${analysis.summary.warningCount}\n`;
        message += `- **Unique Errors**: ${analysis.summary.uniqueErrorCount || 0}\n\n`;

        // Insights
        if (analysis.insights.length > 0) {
            message += '## 💡 Key Insights\n';
            analysis.insights.forEach(insight => {
                const icon = insight.severity === 'high' ? '🔴' : insight.severity === 'medium' ? '⚠️' : 'ℹ️';
                message += `${icon} ${insight.message}\n`;
            });
            message += '\n';
        }

        // Pattern Detection
        if (Object.keys(analysis.patterns).length > 0) {
            message += '## 🔍 Pattern Detection\n';
            Object.entries(analysis.patterns)
                .sort((a, b) => b[1].count - a[1].count)
                .forEach(([name, data]) => {
                    const icon = data.severity === 'high' ? '🔴' : data.severity === 'medium' ? '⚠️' : '📊';
                    message += `${icon} **${name}**: ${data.count} occurrences (${data.percentage}%)\n`;
                });
            message += '\n';
        }

        // Recommendations
        if (analysis.recommendations.length > 0) {
            message += '## 🎯 Recommendations\n';
            analysis.recommendations.forEach(rec => {
                message += `${rec}\n`;
            });
            message += '\n';
        }

        // Sample errors (if any)
        if (analysis.patterns.error && analysis.patterns.error.samples.length > 0) {
            message += '## 🔴 Sample Errors\n```\n';
            analysis.patterns.error.samples.slice(0, 3).forEach(sample => {
                message += sample.substring(0, 200) + '...\n';
            });
            message += '```\n';
        }

        return ResponseBuilder.success(message);
    }

    /**
     * Handle natural language queries about logs
     */
    static async queryLogs(query, args) {
        // Parse natural language query
        const intent = this.parseLogQuery(query);
        
        // Execute appropriate analysis
        switch (intent.action) {
            case 'find_errors':
                return this.findErrors(intent.params, args);
            case 'find_by_pattern':
                return this.findByPattern(intent.params, args);
            case 'analyze_timeframe':
                return this.analyzeTimeframe(intent.params, args);
            case 'get_statistics':
                return this.getStatistics(intent.params, args);
            default:
                return this.analyzeLogs(args);
        }
    }

    /**
     * Parse natural language query
     */
    static parseLogQuery(query) {
        const lowerQuery = query.toLowerCase();
        
        // Detect intent
        if (lowerQuery.includes('error') || lowerQuery.includes('exception')) {
            return {
                action: 'find_errors',
                params: { 
                    severity: lowerQuery.includes('critical') ? 'critical' : 'all'
                }
            };
        }
        
        if (lowerQuery.includes('slow') || lowerQuery.includes('performance')) {
            return {
                action: 'find_by_pattern',
                params: { pattern: 'performance' }
            };
        }
        
        if (lowerQuery.includes('last hour') || lowerQuery.includes('today')) {
            return {
                action: 'analyze_timeframe',
                params: { 
                    timeframe: lowerQuery.includes('hour') ? '1h' : '24h'
                }
            };
        }
        
        return {
            action: 'general_analysis',
            params: {}
        };
    }

    /**
     * Find errors in logs
     */
    static async findErrors(params, args) {
        const analysis = await this.analyzeLogs({
            ...args,
            focusOn: 'errors'
        });
        
        return analysis;
    }

    /**
     * Find logs by pattern
     */
    static async findByPattern(params, args) {
        const pattern = this.PATTERNS[params.pattern];
        if (!pattern) {
            return ResponseBuilder.error(`Unknown pattern: ${params.pattern}`);
        }
        
        // Analyze with focus on specific pattern
        const analysis = await this.analyzeLogs({
            ...args,
            focusOn: params.pattern
        });
        
        return analysis;
    }

    /**
     * Analyze specific timeframe
     */
    static async analyzeTimeframe(params, args) {
        return this.analyzeLogs({
            ...args,
            timeRange: params.timeframe
        });
    }

    /**
     * Get statistics about logs
     */
    static async getStatistics(params, args) {
        const analysis = await this.analyzeLogs(args);
        
        // Format as statistics report
        let message = '# 📊 Log Statistics\n\n';
        message += '## Volume Metrics\n';
        message += `- Total Lines: ${analysis.summary.totalLines.toLocaleString()}\n`;
        message += `- Error Rate: ${analysis.summary.errorRate}%\n`;
        message += `- Warning Rate: ${(analysis.summary.warningCount / analysis.summary.totalLines * 100).toFixed(2)}%\n\n`;
        
        message += '## Pattern Distribution\n';
        Object.entries(analysis.patterns).forEach(([name, data]) => {
            message += `- ${name}: ${data.percentage}% (${data.count} occurrences)\n`;
        });
        
        return ResponseBuilder.success(message);
    }
}

module.exports = LogAnalyzer;