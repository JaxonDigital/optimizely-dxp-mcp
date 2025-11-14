/**
 * Telemetry Buffer Module - DXP-39
 * Implements buffering and retry logic for telemetry events
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

// Type definitions
interface TelemetryBufferConfig {
    maxBufferSize?: number;
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    backoffMultiplier?: number;
    jitter?: number;
    retryInterval?: number;
    storageDir?: string;
    maxFailures?: number;
    resetTimeout?: number;
}

interface CircuitBreaker {
    isOpen: boolean;
    failures: number;
    maxFailures: number;
    resetTimeout: number;
    lastFailureTime: number | null;
    resetTimer: NodeJS.Timeout | null;
}

interface RetryInfo {
    attempts: number;
    lastAttempt: Date | null;
}

interface BufferStats {
    eventsBuffered: number;
    eventsSent: number;
    eventsFailed: number;
    eventsDropped: number;
    circuitBreakerTrips: number;
}

interface BufferStatsReport extends BufferStats {
    bufferSize: number;
    circuitBreakerOpen: boolean;
    circuitBreakerFailures: number;
}

interface BufferedEvent {
    _id?: string;
    [key: string]: any;
}

interface SerializedRetryInfo {
    id: string;
    attempts: number;
    lastAttempt: string | null;
}

interface PersistedBufferData {
    buffer: BufferedEvent[];
    retryInfo: SerializedRetryInfo[];
    stats: BufferStats;
    savedAt: string;
}

interface RequestOptions extends https.RequestOptions {
    timeout?: number;
}

class TelemetryBuffer {
    private config: Required<TelemetryBufferConfig>;
    private circuitBreaker: CircuitBreaker;
    private buffer: BufferedEvent[];
    private retryMap: Map<string, RetryInfo>;
    private retryTimer: NodeJS.Timeout | null;
    private stats: BufferStats;

    constructor(config: TelemetryBufferConfig = {}) {
        // Buffer configuration
        this.config = {
            maxBufferSize: config.maxBufferSize || 1000,
            maxRetries: config.maxRetries || 3,
            baseDelay: config.baseDelay || 1000,
            maxDelay: config.maxDelay || 60000,
            backoffMultiplier: config.backoffMultiplier || 2,
            jitter: config.jitter || 0.25,
            retryInterval: config.retryInterval || 30000,
            storageDir: config.storageDir || path.join(os.tmpdir(), 'optimizely-mcp-telemetry'),
            maxFailures: config.maxFailures || 5,
            resetTimeout: config.resetTimeout || 300000 // 5 minutes
        };

        // Circuit breaker configuration
        this.circuitBreaker = {
            isOpen: false,
            failures: 0,
            maxFailures: this.config.maxFailures,
            resetTimeout: this.config.resetTimeout,
            lastFailureTime: null,
            resetTimer: null
        };

        // Event tracking
        this.buffer = [];
        this.retryMap = new Map();
        this.retryTimer = null;

        // Statistics
        this.stats = {
            eventsBuffered: 0,
            eventsSent: 0,
            eventsFailed: 0,
            eventsDropped: 0,
            circuitBreakerTrips: 0
        };

        // Initialize storage
        this.initializeStorage();
    }

    /**
     * Initialize storage directory
     */
    private initializeStorage(): void {
        try {
            if (!fs.existsSync(this.config.storageDir)) {
                fs.mkdirSync(this.config.storageDir, { recursive: true });
            }

            // Load buffered events from disk
            const bufferFile = path.join(this.config.storageDir, 'buffer.json');
            if (fs.existsSync(bufferFile)) {
                const data = fs.readFileSync(bufferFile, 'utf8');
                const loaded: PersistedBufferData = JSON.parse(data);

                // Restore buffer and retry tracking
                this.buffer = loaded.buffer || [];
                if (loaded.retryInfo) {
                    loaded.retryInfo.forEach(info => {
                        this.retryMap.set(info.id, {
                            attempts: info.attempts,
                            lastAttempt: info.lastAttempt ? new Date(info.lastAttempt) : null
                        });
                    });
                }

                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error(`[TELEMETRY BUFFER] Loaded ${this.buffer.length} events from disk`);
                }
            }
        } catch (error) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY BUFFER] Failed to initialize storage:', (error as Error).message);
            }
        }
    }

    /**
     * Add event to buffer
     */
    addEvent(event: BufferedEvent): boolean {
        // Check circuit breaker
        if (this.circuitBreaker.isOpen) {
            this.stats.eventsDropped++;
            return false;
        }

        // Ensure event has unique ID
        if (!event._id) {
            event._id = this.generateEventId();
        }

        // Check buffer size limit
        if (this.buffer.length >= this.config.maxBufferSize) {
            // Remove oldest event
            const removed = this.buffer.shift();
            if (removed && removed._id) {
                this.retryMap.delete(removed._id);
            }
            this.stats.eventsDropped++;
        }

        // Add to buffer
        this.buffer.push(event);
        this.retryMap.set(event._id!, { attempts: 0, lastAttempt: null });
        this.stats.eventsBuffered++;

        // Persist to disk
        this.saveBuffer();

        return true;
    }

    /**
     * Generate unique event ID
     */
    private generateEventId(): string {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Start automatic retry timer
     */
    startRetryTimer(): void {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
        }

        this.retryTimer = setInterval(() => {
            this.processBuffer();
        }, this.config.retryInterval);

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error(`[TELEMETRY BUFFER] Started retry timer (${this.config.retryInterval}ms interval)`);
        }
    }

    /**
     * Stop retry timer
     */
    private stopRetryTimer(): void {
        if (this.retryTimer) {
            clearInterval(this.retryTimer);
            this.retryTimer = null;
        }
    }

    /**
     * Process buffered events
     */
    async processBuffer(): Promise<void> {
        if (this.buffer.length === 0) return;

        // Check circuit breaker
        if (this.circuitBreaker.isOpen) {
            if (this.shouldResetCircuitBreaker()) {
                this.resetCircuitBreaker();
            } else {
                return;
            }
        }

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error(`[TELEMETRY BUFFER] Processing ${this.buffer.length} buffered events`);
        }

        const processedEvents: BufferedEvent[] = [];
        const failedEvents: BufferedEvent[] = [];

        for (const event of [...this.buffer]) {
            const retryInfo = this.retryMap.get(event._id!);
            if (!retryInfo) continue;

            // Check if max retries exceeded
            if (retryInfo.attempts >= this.config.maxRetries) {
                processedEvents.push(event);
                this.stats.eventsDropped++;
                continue;
            }

            // Calculate delay with exponential backoff
            const delay = this.calculateBackoffDelay(retryInfo.attempts);

            // Check if enough time has passed since last attempt
            if (retryInfo.lastAttempt) {
                const timeSinceLastAttempt = Date.now() - retryInfo.lastAttempt.getTime();
                if (timeSinceLastAttempt < delay) {
                    failedEvents.push(event);
                    continue;
                }
            }

            // Attempt to send event
            const success = await this.sendEvent(event);

            if (success) {
                processedEvents.push(event);
                this.stats.eventsSent++;
                this.onSendSuccess();
            } else {
                retryInfo.attempts++;
                retryInfo.lastAttempt = new Date();
                failedEvents.push(event);
                this.stats.eventsFailed++;
                this.onSendFailure();
            }
        }

        // Update buffer
        this.buffer = failedEvents;

        // Clean up retry map
        processedEvents.forEach(event => {
            if (event._id) {
                this.retryMap.delete(event._id);
            }
        });

        // Persist changes
        this.saveBuffer();

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error(`[TELEMETRY BUFFER] Processed: ${processedEvents.length} sent, ${failedEvents.length} remaining`);
        }
    }

    /**
     * Send single event to endpoints
     */
    private async sendEvent(event: BufferedEvent, endpoints?: string[]): Promise<boolean> {
        // Default endpoints if not provided
        if (!endpoints) {
            endpoints = [
                'https://optimizely-mcp-analytics.vercel.app/api/telemetry/ingest',
                'https://accelerator.jaxondigital.com/api/telemetry/mcp'
            ];
        }

        // Remove internal tracking fields
        const eventToSend = { ...event };
        delete eventToSend._id;

        // Try all endpoints
        const promises = endpoints.map(endpoint => this.sendToEndpoint(endpoint, eventToSend));
        const results = await Promise.allSettled(promises);

        // Success if at least one endpoint accepted the event
        return results.some(result => result.status === 'fulfilled' && result.value === true);
    }

    /**
     * Send event to specific endpoint
     */
    private sendToEndpoint(url: string, event: any): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const urlObj = new URL(url);
                const data = JSON.stringify([event]);

                const options: RequestOptions = {
                    hostname: urlObj.hostname,
                    port: urlObj.port ? parseInt(urlObj.port) : 443,
                    path: urlObj.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data)
                    },
                    timeout: 5000
                };

                const req = https.request(options, (res) => {
                    let responseData = '';
                    res.on('data', chunk => responseData += chunk);
                    res.on('end', () => {
                        const success = res.statusCode ? res.statusCode >= 200 && res.statusCode < 300 : false;
                        resolve(success);
                    });
                });

                req.on('error', (error) => {
                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.error(`[TELEMETRY BUFFER] Request error: ${error.message}`);
                    }
                    resolve(false);
                });

                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });

                req.write(data);
                req.end();
            } catch (error) {
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error(`[TELEMETRY BUFFER] Send error: ${(error as Error).message}`);
                }
                resolve(false);
            }
        });
    }

    /**
     * Calculate backoff delay with jitter
     */
    private calculateBackoffDelay(attempts: number): number {
        const baseDelay = Math.min(
            this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempts),
            this.config.maxDelay
        );

        // Add jitter to prevent thundering herd
        const jitterRange = baseDelay * this.config.jitter;
        const jitter = (Math.random() * 2 - 1) * jitterRange;

        return Math.max(0, Math.round(baseDelay + jitter));
    }

    /**
     * Handle successful send
     */
    private onSendSuccess(): void {
        // Reduce failure count on success
        if (this.circuitBreaker.failures > 0) {
            this.circuitBreaker.failures = Math.max(0, this.circuitBreaker.failures - 1);
        }
    }

    /**
     * Handle failed send
     */
    private onSendFailure(): void {
        this.circuitBreaker.failures++;
        this.circuitBreaker.lastFailureTime = Date.now();

        // Check if circuit breaker should trip
        if (this.circuitBreaker.failures >= this.circuitBreaker.maxFailures) {
            this.tripCircuitBreaker();
        }
    }

    /**
     * Trip circuit breaker
     */
    private tripCircuitBreaker(): void {
        this.circuitBreaker.isOpen = true;
        this.stats.circuitBreakerTrips++;
        this.stopRetryTimer();

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY BUFFER] Circuit breaker tripped - telemetry disabled temporarily');
        }

        // Schedule circuit breaker reset
        if (this.circuitBreaker.resetTimer) {
            clearTimeout(this.circuitBreaker.resetTimer);
        }

        this.circuitBreaker.resetTimer = setTimeout(() => {
            this.resetCircuitBreaker();
        }, this.circuitBreaker.resetTimeout);
    }

    /**
     * Check if circuit breaker should be reset
     */
    private shouldResetCircuitBreaker(): boolean {
        if (!this.circuitBreaker.isOpen) return false;
        if (!this.circuitBreaker.lastFailureTime) return true;

        const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
        return timeSinceFailure >= this.circuitBreaker.resetTimeout;
    }

    /**
     * Reset circuit breaker
     */
    private resetCircuitBreaker(): void {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failures = 0;
        this.circuitBreaker.lastFailureTime = null;

        if (this.circuitBreaker.resetTimer) {
            clearTimeout(this.circuitBreaker.resetTimer);
            this.circuitBreaker.resetTimer = null;
        }

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY BUFFER] Circuit breaker reset - telemetry re-enabled');
        }

        // Restart retry timer
        this.startRetryTimer();
    }

    /**
     * Save buffer to disk
     */
    private saveBuffer(): void {
        try {
            const bufferFile = path.join(this.config.storageDir, 'buffer.json');

            // Convert retry map to serializable format
            const retryInfo: SerializedRetryInfo[] = Array.from(this.retryMap.entries()).map(([id, info]) => ({
                id,
                attempts: info.attempts,
                lastAttempt: info.lastAttempt ? info.lastAttempt.toISOString() : null
            }));

            const data: PersistedBufferData = {
                buffer: this.buffer,
                retryInfo,
                stats: this.stats,
                savedAt: new Date().toISOString()
            };

            fs.writeFileSync(bufferFile, JSON.stringify(data, null, 2));
        } catch (error) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY BUFFER] Failed to save buffer:', (error as Error).message);
            }
        }
    }

    /**
     * Flush all events immediately
     */
    async flush(): Promise<void> {
        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error(`[TELEMETRY BUFFER] Flushing ${this.buffer.length} events`);
        }

        // Process all events without delay checks
        await this.processBuffer();
    }

    /**
     * Get buffer statistics
     */
    getStats(): BufferStatsReport {
        return {
            ...this.stats,
            bufferSize: this.buffer.length,
            circuitBreakerOpen: this.circuitBreaker.isOpen,
            circuitBreakerFailures: this.circuitBreaker.failures
        };
    }

    /**
     * Shutdown buffer (flush and cleanup)
     */
    async shutdown(): Promise<void> {
        this.stopRetryTimer();

        if (this.circuitBreaker.resetTimer) {
            clearTimeout(this.circuitBreaker.resetTimer);
        }

        // Final flush attempt
        await this.flush();

        // Save final state
        this.saveBuffer();

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY BUFFER] Shutdown complete');
        }
    }
}

export default TelemetryBuffer;
