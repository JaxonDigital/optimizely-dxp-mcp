/**
 * Webhook Logger
 * Delivery tracking and logging for webhooks
 * Part of Jaxon Digital Optimizely DXP MCP Server - DXP-136 Phase 2
 */

/**
 * Log entry for webhook delivery
 */
export interface LogEntry {
    webhookId: string;
    url: string;
    status: 'success' | 'failed' | 'retrying' | 'error';
    timestamp: string;
    attempts?: number;
    responseTime?: number;
    statusCode?: number;
    errors?: any[];
    finalError?: string;
    attemptNumber?: number;
    retryDelay?: number;
    error?: string;
    context?: Record<string, any>;
}

/**
 * Delivery statistics
 */
export interface LogStats {
    total: number;
    success: number;
    failed: number;
    retrying: number;
    errors: number;
    avgResponseTime?: number;
    successRate?: number;
}

/**
 * Log filter options
 */
export interface LogFilterOptions {
    since?: string | Date;
    url?: string;
}

/**
 * Get recent logs options
 */
export interface GetRecentLogsOptions {
    limit?: number;
    status?: 'success' | 'failed' | 'retrying' | 'error';
    url?: string;
}

/**
 * Webhook Logger Class
 * Tracks webhook delivery attempts and outcomes
 */
class WebhookLogger {
    static deliveryLog: LogEntry[] = [];
    static maxLogSize = 1000; // Keep last 1000 deliveries

    /**
     * Log successful webhook delivery
     * @param webhookId - Webhook ID
     * @param url - Webhook URL
     * @param details - Delivery details
     */
    static logSuccess(webhookId: string, url: string, details: { attempts?: number; responseTime?: number; statusCode?: number } = {}): void {
        const logEntry: LogEntry = {
            webhookId,
            url: this.sanitizeUrl(url),
            status: 'success',
            timestamp: new Date().toISOString(),
            attempts: details.attempts || 1,
            responseTime: details.responseTime,
            statusCode: details.statusCode
        };

        this.addToLog(logEntry);

        if (process.env.DEBUG === 'true') {
            console.error(`[WEBHOOK] ✅ Success: ${webhookId} → ${this.sanitizeUrl(url)} (${details.responseTime}ms, ${details.attempts} attempts)`);
        }
    }

    /**
     * Log webhook delivery failure
     * @param webhookId - Webhook ID
     * @param url - Webhook URL
     * @param details - Failure details
     */
    static logFailure(webhookId: string, url: string, details: { attempts?: number; errors?: any[]; finalError?: string } = {}): void {
        const logEntry: LogEntry = {
            webhookId,
            url: this.sanitizeUrl(url),
            status: 'failed',
            timestamp: new Date().toISOString(),
            attempts: details.attempts,
            errors: details.errors,
            finalError: details.finalError
        };

        this.addToLog(logEntry);

        console.error(`[WEBHOOK] ❌ Failed: ${webhookId} → ${this.sanitizeUrl(url)} after ${details.attempts} attempts: ${details.finalError}`);
    }

    /**
     * Log webhook retry
     * @param webhookId - Webhook ID
     * @param url - Webhook URL
     * @param attemptNumber - Current attempt number
     * @param retryDelay - Retry delay in ms
     * @param error - Error message
     */
    static logRetry(webhookId: string, url: string, attemptNumber: number, retryDelay: number, error: string): void {
        const logEntry: LogEntry = {
            webhookId,
            url: this.sanitizeUrl(url),
            status: 'retrying',
            timestamp: new Date().toISOString(),
            attemptNumber,
            retryDelay,
            error
        };

        this.addToLog(logEntry);

        if (process.env.DEBUG === 'true') {
            console.error(`[WEBHOOK] 🔄 Retry ${attemptNumber}: ${webhookId} → ${this.sanitizeUrl(url)} in ${retryDelay}ms (${error})`);
        }
    }

    /**
     * Log webhook error
     * @param webhookId - Webhook ID
     * @param url - Webhook URL
     * @param error - Error message
     * @param context - Additional context
     */
    static logError(webhookId: string, url: string, error: string, context: Record<string, any> = {}): void {
        const logEntry: LogEntry = {
            webhookId,
            url: this.sanitizeUrl(url),
            status: 'error',
            timestamp: new Date().toISOString(),
            error,
            context
        };

        this.addToLog(logEntry);

        console.error(`[WEBHOOK] ⚠️  Error: ${webhookId} → ${this.sanitizeUrl(url)}: ${error}`);
    }

    /**
     * Add entry to delivery log
     * @param logEntry - Log entry
     */
    static addToLog(logEntry: LogEntry): void {
        this.deliveryLog.push(logEntry);

        // Trim log if it exceeds max size
        if (this.deliveryLog.length > this.maxLogSize) {
            this.deliveryLog = this.deliveryLog.slice(-this.maxLogSize);
        }
    }

    /**
     * Sanitize URL for logging (remove sensitive query params)
     * @param url - URL to sanitize
     * @returns Sanitized URL
     */
    static sanitizeUrl(url: string): string {
        try {
            const parsed = new URL(url);
            // Remove query params that might contain secrets
            const sensitiveParams = ['token', 'key', 'secret', 'password', 'apikey', 'api_key'];
            for (const param of sensitiveParams) {
                if (parsed.searchParams.has(param)) {
                    parsed.searchParams.set(param, '***');
                }
            }
            return parsed.toString();
        } catch (error) {
            return url; // Return original if parsing fails
        }
    }

    /**
     * Get delivery statistics
     * @param options - Filter options
     * @returns Statistics
     */
    static getStats(options: LogFilterOptions = {}): LogStats {
        const { since, url } = options;
        let logs = this.deliveryLog;

        // Filter by time
        if (since) {
            const sinceTime = new Date(since).getTime();
            logs = logs.filter(log => new Date(log.timestamp).getTime() >= sinceTime);
        }

        // Filter by URL
        if (url) {
            const sanitizedUrl = this.sanitizeUrl(url);
            logs = logs.filter(log => log.url === sanitizedUrl);
        }

        // Calculate stats
        const stats: LogStats = {
            total: logs.length,
            success: logs.filter(log => log.status === 'success').length,
            failed: logs.filter(log => log.status === 'failed').length,
            retrying: logs.filter(log => log.status === 'retrying').length,
            errors: logs.filter(log => log.status === 'error').length
        };

        // Calculate average response time for successful deliveries
        const successfulLogs = logs.filter(log => log.status === 'success' && log.responseTime);
        if (successfulLogs.length > 0) {
            stats.avgResponseTime = Math.round(
                successfulLogs.reduce((sum, log) => sum + (log.responseTime || 0), 0) / successfulLogs.length
            );
        }

        // Calculate success rate
        if (stats.total > 0) {
            stats.successRate = Math.round((stats.success / stats.total) * 100);
        }

        return stats;
    }

    /**
     * Get recent delivery log entries
     * @param options - Filter options
     * @returns Log entries
     */
    static getRecentLogs(options: GetRecentLogsOptions = {}): LogEntry[] {
        const { limit = 100, status, url } = options;
        let logs = [...this.deliveryLog];

        // Filter by status
        if (status) {
            logs = logs.filter(log => log.status === status);
        }

        // Filter by URL
        if (url) {
            const sanitizedUrl = this.sanitizeUrl(url);
            logs = logs.filter(log => log.url === sanitizedUrl);
        }

        // Sort by timestamp (most recent first)
        logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        // Apply limit
        return logs.slice(0, limit);
    }

    /**
     * Clear delivery log
     */
    static clearLog(): void {
        this.deliveryLog = [];
    }
}

export default WebhookLogger;
