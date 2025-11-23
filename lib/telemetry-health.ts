/**
 * Telemetry Health Module - DXP-40
 * Enhanced health checks and monitoring patterns for telemetry system
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

interface TelemetryHealthConfig {
    endpointHealthInterval?: number;
    systemHealthInterval?: number;
    maxFailureRate?: number;
    maxResponseTime?: number;
    maxBufferSize?: number;
    maxMemoryUsage?: number;
    storageDir?: string;
    endpoints?: string[];
}

interface EndpointHealth {
    status: 'unknown' | 'healthy' | 'unhealthy' | 'error';
    lastCheck: string | null;
    responseTime: number | null;
    successRate: number;
    recentChecks: HealthCheck[];
    errors: HealthError[];
}

interface HealthCheck {
    timestamp: number;
    success: boolean;
    responseTime: number;
}

interface HealthError {
    timestamp: string;
    message: string;
    responseTime: number;
}

interface SystemHealth {
    memory: {
        usage: number;
        limit: number;
    };
    buffer: {
        size: number;
        limit: number;
    };
    errors: any[];
}

interface HealthMetrics {
    checksPerformed: number;
    endpointFailures: number;
    systemWarnings: number;
    lastFailure: string | null;
}

interface HealthState {
    overall: 'healthy' | 'degraded' | 'unhealthy';
    lastCheck: string | null;
    endpoints: Map<string, EndpointHealth>;
    system: SystemHealth;
    metrics: HealthMetrics;
}

interface HealthEvent {
    event: string;
    timestamp: string;
    data: any;
}

interface HealthStatus {
    overall: string;
    lastCheck: string | null;
    endpoints: Array<{
        url: string;
        status: string;
        lastCheck: string | null;
        responseTime: number | null;
        successRate: number;
        recentChecks: HealthCheck[];
        errors: HealthError[];
    }>;
    system: SystemHealth;
    metrics: HealthMetrics;
}

interface HealthSummary {
    status: string;
    lastCheck: string | null;
    endpointCount: number;
    healthyEndpoints: number;
    avgResponseTime: number | null;
    memoryUsage: number;
    bufferSize: number;
    totalChecks: number;
    totalFailures: number;
}

interface TelemetryBuffer {
    getStats(): { bufferSize: number };
}

type HealthEventHandler = (event: HealthEvent) => void;

class TelemetryHealth {
    private config: Required<TelemetryHealthConfig>;
    private health: HealthState;
    private healthTimers: {
        endpoint: NodeJS.Timeout | null;
        system: NodeJS.Timeout | null;
    };
    private handlers: Map<string, HealthEventHandler[]>;
    private buffer?: TelemetryBuffer;

    constructor(config: TelemetryHealthConfig = {}) {
        // Health check configuration
        this.config = {
            // Health check intervals
            endpointHealthInterval: config.endpointHealthInterval || 300000, // 5 minutes
            systemHealthInterval: config.systemHealthInterval || 60000,      // 1 minute

            // Health thresholds
            maxFailureRate: config.maxFailureRate || 0.5,        // 50% failure rate
            maxResponseTime: config.maxResponseTime || 10000,     // 10 seconds
            maxBufferSize: config.maxBufferSize || 800,          // 80% of max buffer
            maxMemoryUsage: config.maxMemoryUsage || 100 * 1024 * 1024, // 100MB

            // Storage
            storageDir: config.storageDir || path.join(os.tmpdir(), 'optimizely-mcp-telemetry'),

            // Endpoints to monitor
            endpoints: config.endpoints || [
                'https://optimizely-mcp-analytics.vercel.app/api/telemetry/ingest',
                'https://accelerator.jaxondigital.com/api/telemetry/mcp'
            ],

            ...config
        } as Required<TelemetryHealthConfig>;

        // Health state
        this.health = {
            overall: 'healthy',
            lastCheck: null,
            endpoints: new Map(),
            system: {
                memory: { usage: 0, limit: this.config.maxMemoryUsage },
                buffer: { size: 0, limit: this.config.maxBufferSize },
                errors: []
            },
            metrics: {
                checksPerformed: 0,
                endpointFailures: 0,
                systemWarnings: 0,
                lastFailure: null
            }
        };

        // Health monitoring timers
        this.healthTimers = {
            endpoint: null,
            system: null
        };

        // Health event handlers
        this.handlers = new Map();

        // Initialize endpoint health tracking
        this.config.endpoints.forEach(endpoint => {
            this.health.endpoints.set(endpoint, {
                status: 'unknown',
                lastCheck: null,
                responseTime: null,
                successRate: 1.0,
                recentChecks: [], // Last 10 checks
                errors: []
            });
        });

        // Initialize storage
        this.initializeStorage();
    }

    /**
     * Initialize storage for health data
     */
    initializeStorage(): void {
        try {
            if (!fs.existsSync(this.config.storageDir)) {
                fs.mkdirSync(this.config.storageDir, { recursive: true });
            }

            // Load previous health state if exists
            const healthFile = path.join(this.config.storageDir, 'health.json');
            if (fs.existsSync(healthFile)) {
                const data = fs.readFileSync(healthFile, 'utf8');
                const savedHealth = JSON.parse(data);

                // Restore metrics but not real-time state
                if (savedHealth.metrics) {
                    this.health.metrics = { ...this.health.metrics, ...savedHealth.metrics };
                }
            }
        } catch (error) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] Failed to initialize storage:', (error as Error).message);
            }
        }
    }

    /**
     * Start health monitoring
     * DXP-93: Made non-blocking to prevent blocking MCP handshake
     */
    startMonitoring(): void {
        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY HEALTH] Starting health monitoring');
        }

        // Start endpoint health checks
        this.healthTimers.endpoint = setInterval(() => {
            this.checkEndpointHealth();
        }, this.config.endpointHealthInterval);

        // Start system health checks
        this.healthTimers.system = setInterval(() => {
            this.checkSystemHealth();
        }, this.config.systemHealthInterval);

        // DXP-93 FIX: Perform initial checks asynchronously to NOT block MCP handshake
        // Use setImmediate to defer execution until after current call stack completes
        setImmediate(() => {
            this.checkEndpointHealth();
            this.checkSystemHealth();
        });
    }

    /**
     * Stop health monitoring
     */
    stopMonitoring(): void {
        if (this.healthTimers.endpoint) {
            clearInterval(this.healthTimers.endpoint);
            this.healthTimers.endpoint = null;
        }

        if (this.healthTimers.system) {
            clearInterval(this.healthTimers.system);
            this.healthTimers.system = null;
        }

        // Save final health state
        this.saveHealthState();

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY HEALTH] Stopped health monitoring');
        }
    }

    /**
     * Check health of telemetry endpoints
     */
    async checkEndpointHealth(): Promise<void> {
        const checkTime = Date.now();

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY HEALTH] Checking endpoint health');
        }

        for (const endpoint of this.config.endpoints) {
            await this.checkSingleEndpoint(endpoint, checkTime);
        }

        this.health.lastCheck = new Date().toISOString();
        this.health.metrics.checksPerformed++;
        this.updateOverallHealth();
        this.saveHealthState();
    }

    /**
     * Check health of a single endpoint
     */
    async checkSingleEndpoint(endpoint: string, checkTime: number): Promise<void> {
        const endpointHealth = this.health.endpoints.get(endpoint)!;
        const startTime = Date.now();

        try {
            const isHealthy = await this.pingEndpoint(endpoint);
            const responseTime = Date.now() - startTime;

            // Update endpoint health
            endpointHealth.status = isHealthy ? 'healthy' : 'unhealthy';
            endpointHealth.lastCheck = new Date().toISOString();
            endpointHealth.responseTime = responseTime;

            // Track recent checks (keep last 10)
            endpointHealth.recentChecks.push({
                timestamp: checkTime,
                success: isHealthy,
                responseTime
            });

            if (endpointHealth.recentChecks.length > 10) {
                endpointHealth.recentChecks.shift();
            }

            // Calculate success rate
            const successCount = endpointHealth.recentChecks.filter(c => c.success).length;
            endpointHealth.successRate = successCount / endpointHealth.recentChecks.length;

            // Check for issues
            if (!isHealthy) {
                this.health.metrics.endpointFailures++;
                this.health.metrics.lastFailure = new Date().toISOString();

                endpointHealth.errors.push({
                    timestamp: new Date().toISOString(),
                    message: 'Endpoint health check failed',
                    responseTime
                });

                // Keep only last 5 errors
                if (endpointHealth.errors.length > 5) {
                    endpointHealth.errors.shift();
                }

                // Trigger health event
                this.triggerHealthEvent('endpoint_failure', {
                    endpoint,
                    responseTime,
                    successRate: endpointHealth.successRate
                });
            }

            // Check for slow response
            if (responseTime > this.config.maxResponseTime) {
                this.triggerHealthEvent('slow_response', {
                    endpoint,
                    responseTime,
                    threshold: this.config.maxResponseTime
                });
            }

            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error(`[TELEMETRY HEALTH] ${endpoint}: ${endpointHealth.status} (${responseTime}ms)`);
            }

        } catch (error) {
            endpointHealth.status = 'error';
            endpointHealth.lastCheck = new Date().toISOString();
            endpointHealth.responseTime = Date.now() - startTime;

            endpointHealth.errors.push({
                timestamp: new Date().toISOString(),
                message: (error as Error).message,
                responseTime: endpointHealth.responseTime
            });

            this.health.metrics.endpointFailures++;

            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error(`[TELEMETRY HEALTH] Error checking ${endpoint}:`, (error as Error).message);
            }
        }
    }

    /**
     * Ping an endpoint to check if it's responsive
     */
    async pingEndpoint(endpoint: string): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const url = new URL(endpoint);
                const options: https.RequestOptions = {
                    method: 'HEAD', // Use HEAD to minimize data transfer
                    hostname: url.hostname,
                    port: url.port || '443',
                    path: url.pathname,
                    timeout: 5000,
                    headers: {
                        'User-Agent': 'optimizely-dxp-mcp-health-check'
                    }
                };

                const req = https.request(options, (res) => {
                    // Consider 2xx and 3xx responses as healthy
                    resolve(res.statusCode! < 400);
                });

                req.on('error', () => resolve(false));
                req.on('timeout', () => {
                    req.destroy();
                    resolve(false);
                });

                req.end();
            } catch (error) {
                resolve(false);
            }
        });
    }

    /**
     * Check system health metrics
     */
    checkSystemHealth(): void {
        try {
            // Check memory usage
            const memUsage = process.memoryUsage();
            this.health.system.memory.usage = memUsage.rss;

            // Check buffer size (if buffer is available)
            if (this.buffer) {
                this.health.system.buffer.size = this.buffer.getStats().bufferSize;
            }

            // Check for memory issues
            if (this.health.system.memory.usage > this.config.maxMemoryUsage) {
                this.health.metrics.systemWarnings++;
                this.triggerHealthEvent('high_memory', {
                    usage: this.health.system.memory.usage,
                    limit: this.config.maxMemoryUsage
                });
            }

            // Check for buffer issues
            if (this.health.system.buffer.size > this.config.maxBufferSize) {
                this.health.metrics.systemWarnings++;
                this.triggerHealthEvent('high_buffer', {
                    size: this.health.system.buffer.size,
                    limit: this.config.maxBufferSize
                });
            }

            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] System check:', {
                    memory: `${Math.round(this.health.system.memory.usage / 1024 / 1024)}MB`,
                    buffer: this.health.system.buffer.size
                });
            }

        } catch (error) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] System health check failed:', (error as Error).message);
            }
        }
    }

    /**
     * Update overall health status
     */
    updateOverallHealth(): void {
        const endpointStatuses = Array.from(this.health.endpoints.values());
        const healthyEndpoints = endpointStatuses.filter(e => e.status === 'healthy');
        const unhealthyEndpoints = endpointStatuses.filter(e => e.status === 'unhealthy' || e.status === 'error');

        // Calculate overall health
        if (unhealthyEndpoints.length === 0) {
            this.health.overall = 'healthy';
        } else if (healthyEndpoints.length > 0) {
            this.health.overall = 'degraded';
        } else {
            this.health.overall = 'unhealthy';
        }

        // Check for poor performance across endpoints
        const avgSuccessRate = endpointStatuses.reduce((sum, e) => sum + (e.successRate || 0), 0) / endpointStatuses.length;
        if (avgSuccessRate < this.config.maxFailureRate) {
            this.health.overall = 'unhealthy';
        }
    }

    /**
     * Register a health event handler
     */
    on(event: string, handler: HealthEventHandler): void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, []);
        }
        this.handlers.get(event)!.push(handler);
    }

    /**
     * Trigger a health event
     */
    triggerHealthEvent(event: string, data: any): void {
        const handlers = this.handlers.get(event) || [];
        const eventData: HealthEvent = {
            event,
            timestamp: new Date().toISOString(),
            data
        };

        handlers.forEach(handler => {
            try {
                handler(eventData);
            } catch (error) {
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY HEALTH] Event handler error:', (error as Error).message);
                }
            }
        });

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error(`[TELEMETRY HEALTH] Event: ${event}`, data);
        }
    }

    /**
     * Get current health status
     */
    getHealthStatus(): HealthStatus {
        return {
            overall: this.health.overall,
            lastCheck: this.health.lastCheck,
            endpoints: Array.from(this.health.endpoints.entries()).map(([url, health]) => ({
                url,
                ...health
            })),
            system: this.health.system,
            metrics: this.health.metrics
        };
    }

    /**
     * Get health summary for monitoring
     */
    getHealthSummary(): HealthSummary {
        const status = this.getHealthStatus();
        return {
            status: status.overall,
            lastCheck: status.lastCheck,
            endpointCount: status.endpoints.length,
            healthyEndpoints: status.endpoints.filter(e => e.status === 'healthy').length,
            avgResponseTime: this.calculateAverageResponseTime(),
            memoryUsage: Math.round(status.system.memory.usage / 1024 / 1024), // MB
            bufferSize: status.system.buffer.size,
            totalChecks: status.metrics.checksPerformed,
            totalFailures: status.metrics.endpointFailures
        };
    }

    /**
     * Calculate average response time across endpoints
     */
    calculateAverageResponseTime(): number | null {
        const endpointTimes = Array.from(this.health.endpoints.values())
            .map(e => e.responseTime)
            .filter(t => t !== null) as number[];

        if (endpointTimes.length === 0) return null;
        return Math.round(endpointTimes.reduce((sum, time) => sum + time, 0) / endpointTimes.length);
    }

    /**
     * Save health state to disk
     */
    saveHealthState(): void {
        try {
            const healthFile = path.join(this.config.storageDir, 'health.json');
            const healthData = {
                overall: this.health.overall,
                lastCheck: this.health.lastCheck,
                metrics: this.health.metrics,
                savedAt: new Date().toISOString()
            };

            fs.writeFileSync(healthFile, JSON.stringify(healthData, null, 2));
        } catch (error) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] Failed to save health state:', (error as Error).message);
            }
        }
    }

    /**
     * Set buffer reference for monitoring
     */
    setBuffer(buffer: TelemetryBuffer): void {
        this.buffer = buffer;
    }

    /**
     * Force a health check
     */
    async forceHealthCheck(): Promise<HealthStatus> {
        await this.checkEndpointHealth();
        this.checkSystemHealth();
        return this.getHealthStatus();
    }
}

export default TelemetryHealth;
