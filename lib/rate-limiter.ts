/**
 * Rate Limiter Module
 * Handles API rate limiting and throttling for Optimizely DXP operations
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Type definitions
interface RateLimiterOptions {
    maxRequestsPerMinute?: number;
    maxRequestsPerHour?: number;
    burstAllowance?: number;
    initialBackoff?: number;
    maxBackoff?: number;
    backoffMultiplier?: number;
    persistState?: boolean;
    storageDir?: string;
    debug?: boolean;
}

interface RequestRecord {
    timestamp: number;
    _operation: string;
    success: boolean;
}

interface ProjectLimits {
    requests: RequestRecord[];
    lastRequest: number;
    consecutiveFailures: number;
    backoffUntil: number;
}

interface ThrottleState {
    throttledAt: number;
    retryAfter: number;
    consecutiveThrottles: number;
    lastRetryAfter: number;
}

interface RateLimitCheck {
    allowed: boolean;
    waitTime?: number;
    reason?: string;
    retryAfter?: number;
    throttleCount?: number;
}

interface RateLimitResponse {
    retryAfter?: string | number;
    [key: string]: any;
}

interface RateLimitStatus {
    projectId: string;
    requestsLastMinute: number;
    requestsLastHour: number;
    maxRequestsPerMinute?: number;
    maxRequestsPerHour?: number;
    isThrottled: boolean;
    throttleRetryAfter?: number;
    consecutiveFailures: number;
    backoffUntil: number | null;
    lastRequest: number;
}

interface PersistedState {
    projectLimits: Record<string, ProjectLimits>;
    throttleState: Record<string, ThrottleState>;
    savedAt: number;
}

interface ExtendedError extends Error {
    code?: string;
}

class RateLimiter {
    private options: Required<RateLimiterOptions>;
    private projectLimits: Map<string, ProjectLimits>;
    private throttleState: Map<string, ThrottleState>;
    private cleanupInterval: NodeJS.Timeout | null;

    constructor(options: RateLimiterOptions = {}) {
        this.options = {
            // Default limits (per project per minute)
            maxRequestsPerMinute: options.maxRequestsPerMinute || 60,
            maxRequestsPerHour: options.maxRequestsPerHour || 1000,

            // Burst allowance
            burstAllowance: options.burstAllowance || 10,

            // Backoff settings
            initialBackoff: options.initialBackoff || 1000, // 1 second
            maxBackoff: options.maxBackoff || 30000, // 30 seconds
            backoffMultiplier: options.backoffMultiplier || 2,

            // Storage
            persistState: options.persistState !== false,
            storageDir: options.storageDir || path.join(os.tmpdir(), 'optimizely-mcp-rate-limiter'),

            // Debugging
            debug: options.debug || process.env.DEBUG === 'true'
        };

        // Rate limit tracking per project
        this.projectLimits = new Map();

        // 429 response tracking
        this.throttleState = new Map();

        this.cleanupInterval = null;

        // Initialize storage
        this.initializeStorage();

        // Load persisted state
        if (this.options.persistState) {
            this.loadState();
        }

        // Periodic cleanup
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // Every minute
    }

    /**
     * Initialize storage directory
     */
    private initializeStorage(): void {
        if (!this.options.persistState) return;

        try {
            if (!fs.existsSync(this.options.storageDir)) {
                fs.mkdirSync(this.options.storageDir, { recursive: true });
            }
        } catch (error) {
            if (this.options.debug) {
                console.error('Rate limiter storage init failed:', (error as Error).message);
            }
        }
    }

    /**
     * Load persisted rate limit state
     */
    private loadState(): void {
        try {
            const stateFile = path.join(this.options.storageDir, 'rate-limits.json');
            if (fs.existsSync(stateFile)) {
                const data: PersistedState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

                // Load project limits (only recent ones)
                const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour ago
                if (data.projectLimits) {
                    Object.entries(data.projectLimits).forEach(([projectId, limits]) => {
                        const recentRequests = limits.requests.filter(r => r.timestamp > cutoff);
                        if (recentRequests.length > 0) {
                            this.projectLimits.set(projectId, {
                                ...limits,
                                requests: recentRequests
                            });
                        }
                    });
                }

                // Load throttle states
                if (data.throttleState) {
                    Object.entries(data.throttleState).forEach(([projectId, state]) => {
                        if (state.retryAfter && state.retryAfter > Date.now()) {
                            this.throttleState.set(projectId, state);
                        }
                    });
                }
            }
        } catch (error) {
            if (this.options.debug) {
                console.error('Failed to load rate limiter state:', (error as Error).message);
            }
        }
    }

    /**
     * Save rate limit state to disk
     */
    private saveState(): void {
        if (!this.options.persistState) return;

        try {
            const stateFile = path.join(this.options.storageDir, 'rate-limits.json');
            const data: PersistedState = {
                projectLimits: Object.fromEntries(this.projectLimits.entries()),
                throttleState: Object.fromEntries(this.throttleState.entries()),
                savedAt: Date.now()
            };

            fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
        } catch (error) {
            if (this.options.debug) {
                console.error('Failed to save rate limiter state:', (error as Error).message);
            }
        }
    }

    /**
     * Check if a request is allowed
     * @param projectId - Project identifier
     * @param operation - Operation type (for specific limits)
     * @returns Rate limit check result
     */
    checkRateLimit(projectId: string, _operation: string = 'api_call'): RateLimitCheck {
        const now = Date.now();

        // Check if we're in a throttled state
        const throttleStatus = this.checkThrottleState(projectId);
        if (!throttleStatus.allowed) {
            return throttleStatus;
        }

        // Get or create project limits
        if (!this.projectLimits.has(projectId)) {
            this.projectLimits.set(projectId, {
                requests: [],
                lastRequest: 0,
                consecutiveFailures: 0,
                backoffUntil: 0
            });
        }

        const limits = this.projectLimits.get(projectId)!;

        // Check backoff period
        if (limits.backoffUntil > now) {
            return {
                allowed: false,
                waitTime: limits.backoffUntil - now,
                reason: 'backoff',
                retryAfter: limits.backoffUntil
            };
        }

        // Clean old requests
        const oneHourAgo = now - (60 * 60 * 1000);
        const oneMinuteAgo = now - (60 * 1000);
        limits.requests = limits.requests.filter(r => r.timestamp > oneHourAgo);

        // Count requests in time windows
        const requestsLastMinute = limits.requests.filter(r => r.timestamp > oneMinuteAgo);
        const requestsLastHour = limits.requests.length;

        // Check per-minute limit
        if (requestsLastMinute.length >= this.options.maxRequestsPerMinute) {
            const oldestInMinute = Math.min(...requestsLastMinute.map(r => r.timestamp));
            const waitTime = (oldestInMinute + 60000) - now;

            return {
                allowed: false,
                waitTime: Math.max(0, waitTime),
                reason: 'rate_limit_minute',
                retryAfter: now + waitTime
            };
        }

        // Check per-hour limit
        if (requestsLastHour >= this.options.maxRequestsPerHour) {
            const oldestInHour = Math.min(...limits.requests.map(r => r.timestamp));
            const waitTime = (oldestInHour + 3600000) - now;

            return {
                allowed: false,
                waitTime: Math.max(0, waitTime),
                reason: 'rate_limit_hour',
                retryAfter: now + waitTime
            };
        }

        // Check burst protection
        if (requestsLastMinute.length >= this.options.burstAllowance) {
            const timeSinceLastRequest = now - limits.lastRequest;
            if (timeSinceLastRequest < 1000) { // Less than 1 second
                return {
                    allowed: false,
                    waitTime: 1000 - timeSinceLastRequest,
                    reason: 'burst_protection',
                    retryAfter: now + (1000 - timeSinceLastRequest)
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Record a successful request
     * @param projectId - Project identifier
     * @param operation - Operation type
     */
    recordRequest(projectId: string, _operation: string = 'api_call'): void {
        const now = Date.now();

        if (!this.projectLimits.has(projectId)) {
            this.projectLimits.set(projectId, {
                requests: [],
                lastRequest: 0,
                consecutiveFailures: 0,
                backoffUntil: 0
            });
        }

        const limits = this.projectLimits.get(projectId)!;
        limits.requests.push({
            timestamp: now,
            _operation,
            success: true
        });
        limits.lastRequest = now;
        limits.consecutiveFailures = 0; // Reset on success

        // Save state
        this.saveState();

        if (this.options.debug) {
            console.error(`Rate limit: Request recorded for ${projectId} (${_operation})`);
        }
    }

    /**
     * Record a rate limit response (429)
     * @param projectId - Project identifier
     * @param response - Rate limit response details
     */
    recordRateLimit(projectId: string, response: RateLimitResponse = {}): void {
        const now = Date.now();
        const retryAfter = this.parseRetryAfter(response.retryAfter) || 60000; // Default 1 minute

        if (!this.projectLimits.has(projectId)) {
            this.projectLimits.set(projectId, {
                requests: [],
                lastRequest: 0,
                consecutiveFailures: 0,
                backoffUntil: 0
            });
        }

        const limits = this.projectLimits.get(projectId)!;
        limits.consecutiveFailures++;

        // Set throttle state
        this.throttleState.set(projectId, {
            throttledAt: now,
            retryAfter: now + retryAfter,
            consecutiveThrottles: (this.throttleState.get(projectId)?.consecutiveThrottles || 0) + 1,
            lastRetryAfter: retryAfter
        });

        // Increase backoff for repeated failures
        const backoffTime = Math.min(
            this.options.initialBackoff * Math.pow(this.options.backoffMultiplier, limits.consecutiveFailures - 1),
            this.options.maxBackoff
        );
        limits.backoffUntil = now + backoffTime;

        // Save state
        this.saveState();

        if (this.options.debug) {
            console.error(`Rate limit: 429 recorded for ${projectId}, retry after ${retryAfter}ms`);
        }
    }

    /**
     * Record a failed request (for backoff calculation)
     * @param projectId - Project identifier
     * @param error - Error details
     */
    recordFailure(projectId: string, error: ExtendedError): void {
        const now = Date.now();

        if (!this.projectLimits.has(projectId)) {
            this.projectLimits.set(projectId, {
                requests: [],
                lastRequest: 0,
                consecutiveFailures: 0,
                backoffUntil: 0
            });
        }

        const limits = this.projectLimits.get(projectId)!;
        limits.consecutiveFailures++;

        // Only apply backoff for certain error types
        if (this.shouldBackoff(error)) {
            const backoffTime = Math.min(
                this.options.initialBackoff * Math.pow(this.options.backoffMultiplier, limits.consecutiveFailures - 1),
                this.options.maxBackoff
            );
            limits.backoffUntil = now + backoffTime;

            if (this.options.debug) {
                console.error(`Rate limit: Backoff applied for ${projectId}, wait ${backoffTime}ms`);
            }
        }

        // Save state
        this.saveState();
    }

    /**
     * Check throttle state for a project
     * @param projectId - Project identifier
     * @returns Rate limit check result
     */
    private checkThrottleState(projectId: string): RateLimitCheck {
        const throttleState = this.throttleState.get(projectId);
        if (!throttleState) {
            return { allowed: true };
        }

        const now = Date.now();
        if (throttleState.retryAfter > now) {
            return {
                allowed: false,
                waitTime: throttleState.retryAfter - now,
                reason: 'throttled',
                retryAfter: throttleState.retryAfter,
                throttleCount: throttleState.consecutiveThrottles
            };
        }

        // Clear expired throttle state
        this.throttleState.delete(projectId);
        return { allowed: true };
    }

    /**
     * Parse Retry-After header
     * @param retryAfter - Retry-After header value
     * @returns Milliseconds to wait
     */
    private parseRetryAfter(retryAfter?: string | number): number | null {
        if (!retryAfter) return null;

        // If it's a number, treat as seconds
        if (typeof retryAfter === 'number') {
            return retryAfter * 1000;
        }

        // If it's a string, could be seconds or HTTP date
        if (typeof retryAfter === 'string') {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                return seconds * 1000;
            }

            // Try parsing as date
            const date = new Date(retryAfter);
            if (!isNaN(date.getTime())) {
                return Math.max(0, date.getTime() - Date.now());
            }
        }

        return null;
    }

    /**
     * Check if an error should trigger backoff
     * @param error - Error object
     * @returns Whether to apply backoff
     */
    private shouldBackoff(error: ExtendedError): boolean {
        if (!error) return false;

        const message = (error.message || '').toLowerCase();
        const code = error.code;

        // Network errors should trigger backoff
        if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
            return true;
        }

        // Service unavailable
        if (message.includes('503') || message.includes('service unavailable')) {
            return true;
        }

        // Bad gateway
        if (message.includes('502') || message.includes('bad gateway')) {
            return true;
        }

        // Gateway timeout
        if (message.includes('504') || message.includes('gateway timeout')) {
            return true;
        }

        // Too many requests (should be handled by recordRateLimit, but just in case)
        if (message.includes('429') || message.includes('too many requests')) {
            return true;
        }

        return false;
    }

    /**
     * Get current rate limit status for a project
     * @param projectId - Project identifier
     * @returns Current status
     */
    getStatus(projectId: string): RateLimitStatus {
        const now = Date.now();
        const limits = this.projectLimits.get(projectId);
        const throttle = this.throttleState.get(projectId);

        if (!limits) {
            return {
                projectId,
                requestsLastMinute: 0,
                requestsLastHour: 0,
                isThrottled: false,
                consecutiveFailures: 0,
                backoffUntil: null,
                lastRequest: 0
            };
        }

        const oneMinuteAgo = now - (60 * 1000);
        const oneHourAgo = now - (60 * 60 * 1000);

        return {
            projectId,
            requestsLastMinute: limits.requests.filter(r => r.timestamp > oneMinuteAgo).length,
            requestsLastHour: limits.requests.filter(r => r.timestamp > oneHourAgo).length,
            maxRequestsPerMinute: this.options.maxRequestsPerMinute,
            maxRequestsPerHour: this.options.maxRequestsPerHour,
            isThrottled: throttle ? throttle.retryAfter > now : false,
            throttleRetryAfter: throttle?.retryAfter,
            consecutiveFailures: limits.consecutiveFailures,
            backoffUntil: limits.backoffUntil > now ? limits.backoffUntil : null,
            lastRequest: limits.lastRequest
        };
    }

    /**
     * Get suggested wait time for optimal request timing
     * @param projectId - Project identifier
     * @returns Suggested wait time in milliseconds
     */
    getSuggestedWaitTime(projectId: string): number {
        const status = this.getStatus(projectId);
        const now = Date.now();

        // If throttled, wait for throttle to clear
        if (status.isThrottled && status.throttleRetryAfter) {
            return status.throttleRetryAfter - now;
        }

        // If in backoff, wait for backoff to clear
        if (status.backoffUntil) {
            return status.backoffUntil - now;
        }

        // If approaching limits, suggest spacing requests
        if (status.requestsLastMinute >= this.options.maxRequestsPerMinute * 0.8) {
            return 5000; // 5 seconds
        }

        if (status.requestsLastMinute >= this.options.maxRequestsPerMinute * 0.6) {
            return 2000; // 2 seconds
        }

        return 0; // No wait needed
    }

    /**
     * Clean up old data
     */
    private cleanup(): void {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);

        // Clean up project limits
        for (const [projectId, limits] of this.projectLimits.entries()) {
            // Remove old requests
            limits.requests = limits.requests.filter(r => r.timestamp > oneHourAgo);

            // Remove project if no recent activity
            if (limits.requests.length === 0 && limits.lastRequest < oneHourAgo) {
                this.projectLimits.delete(projectId);
            }
        }

        // Clean up throttle states
        for (const [projectId, throttle] of this.throttleState.entries()) {
            if (throttle.retryAfter < now) {
                this.throttleState.delete(projectId);
            }
        }

        // Save cleaned state
        this.saveState();

        if (this.options.debug && (this.projectLimits.size > 0 || this.throttleState.size > 0)) {
            console.error(`Rate limiter: Cleaned up, ${this.projectLimits.size} projects, ${this.throttleState.size} throttled`);
        }
    }

    /**
     * Reset rate limits for a project (for testing)
     * @param projectId - Project identifier
     */
    reset(projectId?: string): void {
        if (projectId) {
            this.projectLimits.delete(projectId);
            this.throttleState.delete(projectId);
        } else {
            this.projectLimits.clear();
            this.throttleState.clear();
        }

        this.saveState();
    }

    /**
     * Destroy rate limiter and clean up
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        this.saveState();
    }
}

export default RateLimiter;
