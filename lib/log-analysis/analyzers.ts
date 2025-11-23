/**
 * Log Analyzers Module
 * Analyzes parsed logs for errors, performance, AI agents, and health
 * Ported from log-analyzer-mcp for DXP-110
 */

interface ParsedLogEntry {
    timestamp: Date;
    type: 'console' | 'http' | 'unknown';
    method: string;
    path: string;
    statusCode: number;
    userAgent: string;
    ip: string;
    message?: string;
    responseTime?: number;
    size?: number;
    referrer?: string;
    resourceId?: string;
    host?: string;
    isError?: boolean;
    level?: string;
}

interface ErrorAnalysis {
    total: number;
    byStatusCode: Record<string, number>;
    topErrors: Array<{
        path: string;
        count: number;
        statusCodes: number[];
    }>;
}

interface PerformanceAnalysis {
    avgResponseTime: number | null;
    p95ResponseTime: number | null;
    p99ResponseTime: number | null;
    slowestPaths: Array<{
        path: string;
        avgTime: number;
        count: number;
    }>;
}

interface AIAgentAnalysis {
    detected: string[];
    byAgent: Record<string, {
        requests: number;
        successRate: number;
        paths: Array<{
            path: string;
            count: number;
            statusCodes: number[];
        }>;
    }>;
}

interface HealthScore {
    score: number;
    healthy: boolean;
}

/**
 * Analyze errors in logs
 * @param {Object[]} logs - Parsed log entries
 * @returns {Object} Error analysis with guaranteed structure
 */
function analyzeErrors(logs: ParsedLogEntry[]): ErrorAnalysis {
    // DXP-128: Filter errors differently for console vs HTTP logs
    const errors = logs.filter(log => {
        // Console logs: use isError flag (level + keywords)
        if (log.type === 'console') {
            return log.isError === true;
        }
        // HTTP logs: use statusCode >= 400
        return log.statusCode >= 400;
    });

    const byStatusCode: Record<string, number> = {};
    const byUrl: Record<string, { count: number; statusCodes: Set<number> }> = {};

    for (const error of errors) {
        // DXP-137: Only populate byStatusCode for HTTP logs, not console logs
        // Console logs don't have meaningful HTTP status codes
        if (error.type !== 'console' && error.statusCode) {
            const code = String(error.statusCode);

            // Count by status code
            if (!byStatusCode[code]) {
                byStatusCode[code] = 0;
            }
            byStatusCode[code]++;
        }

        // Count by URL (for all error types)
        if (!byUrl[error.path]) {
            byUrl[error.path] = {
                count: 0,
                statusCodes: new Set()
            };
        }
        byUrl[error.path].count++;
        if (error.statusCode) {
            byUrl[error.path].statusCodes.add(error.statusCode);
        }
    }

    // Convert to array of top errors
    const topErrors = Object.entries(byUrl)
        .map(([path, data]) => ({
            path,
            count: data.count,
            statusCodes: Array.from(data.statusCodes)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);

    // DXP-137: Filter byStatusCode to only include error status codes (>= 400)
    // Exclude 2xx (success) and 3xx (redirects) from error reporting
    const errorStatusCodes: Record<string, number> = {};
    for (const [code, count] of Object.entries(byStatusCode)) {
        const statusCode = parseInt(code, 10);
        if (statusCode >= 400) {
            errorStatusCodes[code] = count;
        }
    }

    return {
        total: errors.length,
        byStatusCode: errorStatusCodes,
        topErrors
    };
}

/**
 * Analyze performance metrics
 * @param {Object[]} logs - Parsed log entries
 * @returns {Object} Performance analysis with guaranteed structure
 */
function analyzePerformance(logs: ParsedLogEntry[]): PerformanceAnalysis {
    const logsWithTiming = logs.filter(log => log.responseTime !== undefined && log.responseTime > 0);

    if (logsWithTiming.length === 0) {
        return {
            avgResponseTime: null,
            p95ResponseTime: null,
            p99ResponseTime: null,
            slowestPaths: []
        };
    }

    // Calculate average
    const sum = logsWithTiming.reduce((acc, log) => acc + log.responseTime!, 0);
    const avg = Math.round(sum / logsWithTiming.length);

    // Calculate percentiles
    const sorted = logsWithTiming.map(log => log.responseTime!).sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);
    const p95 = sorted[p95Index] || 0;
    const p99 = sorted[p99Index] || 0;

    // Find slowest paths
    const pathTimes: Record<string, { total: number; count: number }> = {};
    for (const log of logsWithTiming) {
        if (!pathTimes[log.path]) {
            pathTimes[log.path] = { total: 0, count: 0 };
        }
        pathTimes[log.path].total += log.responseTime!;
        pathTimes[log.path].count++;
    }

    const slowestPaths = Object.entries(pathTimes)
        .map(([path, data]) => ({
            path,
            avgTime: Math.round(data.total / data.count),
            count: data.count
        }))
        .sort((a, b) => b.avgTime - a.avgTime)
        .slice(0, 10);

    return {
        avgResponseTime: avg,
        p95ResponseTime: Math.round(p95),
        p99ResponseTime: Math.round(p99),
        slowestPaths
    };
}

/**
 * Detect AI agents in logs
 * @param {Object[]} logs - Parsed log entries
 * @returns {Object} AI agent analysis with guaranteed structure
 */
function detectAIAgents(logs: ParsedLogEntry[]): AIAgentAnalysis {
    // AI agent patterns (from log-analyzer-mcp)
    const patterns = [
        { name: 'ChatGPT-User', pattern: /ChatGPT-User/i },
        { name: 'GPTBot', pattern: /GPTBot/i },
        { name: 'ClaudeBot', pattern: /ClaudeBot|Claude-Web/i },
        { name: 'Google-Extended', pattern: /Google-Extended/i },
        { name: 'Bingbot', pattern: /bingbot/i },
        { name: 'Anthropic-AI', pattern: /anthropic/i },
        { name: 'PerplexityBot', pattern: /PerplexityBot/i },
        { name: 'Applebot-Extended', pattern: /Applebot-Extended/i }
    ];

    const aiLogs: (ParsedLogEntry & { aiAgent: string })[] = [];
    const agentStats: Record<string, {
        requests: number;
        successCount: number;
        paths: Set<string>;
    }> = {};

    for (const log of logs) {
        const userAgent = log.userAgent || '';

        for (const { name, pattern } of patterns) {
            if (pattern.test(userAgent)) {
                aiLogs.push({ ...log, aiAgent: name });

                if (!agentStats[name]) {
                    agentStats[name] = {
                        requests: 0,
                        successCount: 0,
                        paths: new Set()
                    };
                }

                agentStats[name].requests++;
                if (log.statusCode < 400) {
                    agentStats[name].successCount++;
                }
                agentStats[name].paths.add(log.path);
                break;
            }
        }
    }

    // Build structured output
    const detected = Object.keys(agentStats);
    const byAgent: Record<string, {
        requests: number;
        successRate: number;
        paths: Array<{
            path: string;
            count: number;
            statusCodes: number[];
        }>;
    }> = {};

    for (const [agent, stats] of Object.entries(agentStats)) {
        byAgent[agent] = {
            requests: stats.requests,
            successRate: stats.requests > 0 ? Math.round((stats.successCount / stats.requests) * 100) / 100 : 0,
            paths: Array.from(stats.paths).slice(0, 10).map(path => ({
                path,
                count: 1, // Simplified
                statusCodes: []
            }))
        };
    }

    return {
        detected,
        byAgent
    };
}

/**
 * Calculate health score based on error rate and issues
 * @param {Object} errorAnalysis - Error analysis results
 * @param {number} totalLogs - Total log count
 * @returns {Object} Health score and status
 */
function calculateHealthScore(errorAnalysis: ErrorAnalysis, totalLogs: number): HealthScore {
    if (totalLogs === 0) {
        return { score: 100, healthy: true };
    }

    const errorRate = (errorAnalysis.total / totalLogs) * 100;

    // Deduct points for error rate
    let score = 100 - (errorRate * 2);

    // Deduct points for 500 errors
    const serverErrors = Object.keys(errorAnalysis.byStatusCode || {})
        .filter(code => code.startsWith('5'))
        .reduce((sum, code) => sum + errorAnalysis.byStatusCode[code], 0);

    score -= serverErrors * 0.5;

    // Cap between 0-100
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
        score,
        healthy: score >= 70
    };
}

/**
 * Generate recommendations based on analysis
 * @param {Object} errorAnalysis - Error analysis results
 * @param {Object} perfAnalysis - Performance analysis results
 * @param {Object} aiAnalysis - AI agent analysis results
 * @returns {string[]} Array of recommendation strings
 */
function generateRecommendations(
    errorAnalysis: ErrorAnalysis,
    perfAnalysis: PerformanceAnalysis,
    aiAnalysis: AIAgentAnalysis
): string[] {
    const recommendations: string[] = [];

    // High error rate
    if (errorAnalysis.total > 0) {
        const total404s = errorAnalysis.byStatusCode['404'] || 0;
        if (total404s > 10) {
            recommendations.push(`HIGH: ${total404s} 404 errors detected - review and fix broken links`);
        }

        const serverErrors = Object.keys(errorAnalysis.byStatusCode)
            .filter(code => code.startsWith('5'))
            .reduce((sum, code) => sum + errorAnalysis.byStatusCode[code], 0);

        if (serverErrors > 0) {
            recommendations.push(`HIGH: ${serverErrors} server errors detected - investigate application issues`);
        }
    }

    // Slow performance
    if (perfAnalysis.p95ResponseTime && perfAnalysis.p95ResponseTime > 3000) {
        recommendations.push(`MEDIUM: Slow response times detected (P95: ${perfAnalysis.p95ResponseTime}ms) - optimize slow endpoints`);
    }

    // AI agent issues
    for (const [agent, data] of Object.entries(aiAnalysis.byAgent)) {
        if (data.successRate < 0.8) {
            recommendations.push(`MEDIUM: ${agent} has low success rate (${(data.successRate * 100).toFixed(0)}%) - review AI agent access patterns`);
        }
    }

    return recommendations;
}

export default {
    analyzeErrors,
    analyzePerformance,
    detectAIAgents,
    calculateHealthScore,
    generateRecommendations
};
