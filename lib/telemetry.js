/**
 * Telemetry Module
 * Anonymous usage analytics and error tracking for improvement
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

class Telemetry {
    constructor() {
        // Check if telemetry is enabled (opt-out - enabled by default)
        this.enabled = process.env.OPTIMIZELY_MCP_TELEMETRY !== 'false' && 
                      process.env.MCP_TELEMETRY !== 'false';
        
        // Anonymous session ID
        this.sessionId = this.generateSessionId();
        
        // Telemetry endpoint - must be explicitly configured for enterprise use
        // Default endpoint managed internally by Jaxon Digital
        this.endpoint = process.env.TELEMETRY_ENDPOINT || 'https://accelerator.jaxondigital.com/api/telemetry/mcp';
        
        // Local storage for offline events
        this.localStoragePath = path.join(os.tmpdir(), 'optimizely-mcp-telemetry');
        this.pendingEvents = [];
        
        // Metrics collection
        this.metrics = {
            sessionStart: Date.now(),
            toolUsage: {},
            errors: [],
            performance: {},
            environment: this.getEnvironmentInfo()
        };
        
        // Initialize local storage
        this.initializeStorage();
        
        // Send pending events on startup
        if (this.enabled) {
            this.sendPendingEvents();
        }
    }

    /**
     * Generate anonymous session ID
     */
    generateSessionId() {
        // Use random data instead of hostname for privacy
        const data = `${Date.now()}-${Math.random()}-${crypto.randomUUID()}`;
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
    }

    /**
     * Get anonymous environment information
     */
    getEnvironmentInfo() {
        return {
            platform: os.platform(),
            nodeVersion: process.version,
            mpcVersion: this.getPackageVersion(),
            osVersion: os.release(),
            arch: os.arch(),
            // Remove potentially identifying environment variables for privacy
            isCI: !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.AZURE_PIPELINES),
            isDevelopment: process.env.NODE_ENV === 'development',
            hasMultipleProjects: this.detectMultipleProjects()
        };
    }

    /**
     * Detect if multiple projects are configured (privacy-safe)
     */
    detectMultipleProjects() {
        try {
            // Count configured projects without exposing names
            const envVars = Object.keys(process.env);
            const projectVars = envVars.filter(key => 
                key.startsWith('OPTIMIZELY_PROJECT_') || 
                key.startsWith('OPTIMIZELY_API_KEY_')
            );
            return projectVars.length > 1;
        } catch {
            return false;
        }
    }

    /**
     * Get package version
     */
    getPackageVersion() {
        try {
            const packageJson = require('../package.json');
            return packageJson.version;
        } catch {
            return 'unknown';
        }
    }

    /**
     * Initialize local storage
     */
    initializeStorage() {
        try {
            if (!fs.existsSync(this.localStoragePath)) {
                fs.mkdirSync(this.localStoragePath, { recursive: true });
            }
            
            // Load pending events
            const eventsFile = path.join(this.localStoragePath, 'pending.json');
            if (fs.existsSync(eventsFile)) {
                const data = fs.readFileSync(eventsFile, 'utf8');
                this.pendingEvents = JSON.parse(data);
            }
        } catch (error) {
            // Silently fail - telemetry should never break the app
            if (process.env.DEBUG) {
                console.error('Telemetry storage init failed:', error.message);
            }
        }
    }

    /**
     * Track tool usage
     */
    trackToolUsage(toolName, args = {}) {
        if (!this.enabled) return;
        
        try {
            // Increment usage counter
            if (!this.metrics.toolUsage[toolName]) {
                this.metrics.toolUsage[toolName] = {
                    count: 0,
                    firstUsed: Date.now(),
                    lastUsed: Date.now(),
                    errors: 0,
                    avgDuration: 0,
                    environments: new Set()
                };
            }
            
            const tool = this.metrics.toolUsage[toolName];
            tool.count++;
            tool.lastUsed = Date.now();
            
            // Track which environments are used
            if (args.environment) {
                tool.environments.add(args.environment);
            }
            
            // Create event
            const event = {
                type: 'tool_usage',
                tool: toolName,
                timestamp: Date.now(),
                sessionId: this.sessionId,
                environment: args.environment,
                hasCredentials: !!(args.apiKey || args.projectId)
            };
            
            this.queueEvent(event);
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Telemetry tool tracking failed:', error.message);
            }
        }
    }

    /**
     * Track errors
     */
    trackError(error, context = {}) {
        if (!this.enabled) return;
        
        try {
            const errorInfo = {
                type: 'error',
                timestamp: Date.now(),
                sessionId: this.sessionId,
                error: {
                    type: error.type || 'unknown',
                    code: error.code,
                    // Don't send actual error messages (might contain sensitive data)
                    category: this.categorizeError(error),
                    isRetryable: error.retryable || false
                },
                context: {
                    tool: context.tool,
                    operation: context.operation,
                    environment: context.environment
                }
            };
            
            this.metrics.errors.push(errorInfo);
            this.queueEvent(errorInfo);
        } catch (err) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Telemetry error tracking failed:', err.message);
            }
        }
    }

    /**
     * Track performance metrics
     */
    trackPerformance(operation, duration, metadata = {}) {
        if (!this.enabled) return;
        
        try {
            if (!this.metrics.performance[operation]) {
                this.metrics.performance[operation] = {
                    count: 0,
                    totalDuration: 0,
                    avgDuration: 0,
                    minDuration: duration,
                    maxDuration: duration
                };
            }
            
            const perf = this.metrics.performance[operation];
            perf.count++;
            perf.totalDuration += duration;
            perf.avgDuration = perf.totalDuration / perf.count;
            perf.minDuration = Math.min(perf.minDuration, duration);
            perf.maxDuration = Math.max(perf.maxDuration, duration);
            
            const event = {
                type: 'performance',
                operation,
                duration,
                timestamp: Date.now(),
                sessionId: this.sessionId,
                metadata: {
                    size: metadata.size,
                    environment: metadata.environment,
                    success: metadata.success !== false
                }
            };
            
            this.queueEvent(event);
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Telemetry performance tracking failed:', error.message);
            }
        }
    }

    /**
     * Track deployment patterns
     */
    trackDeployment(sourceEnv, targetEnv, options = {}) {
        if (!this.enabled) return;
        
        try {
            const event = {
                type: 'deployment',
                timestamp: Date.now(),
                sessionId: this.sessionId,
                deployment: {
                    path: `${sourceEnv}->${targetEnv}`,
                    isUpward: this.isUpwardPath(sourceEnv, targetEnv),
                    hasCode: options.includeCode,
                    hasContent: options.includeContent,
                    directDeploy: options.directDeploy,
                    useMaintenancePage: options.useMaintenancePage
                }
            };
            
            this.queueEvent(event);
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Telemetry deployment tracking failed:', error.message);
            }
        }
    }

    /**
     * Categorize errors for analytics
     */
    categorizeError(error) {
        const message = (error.message || '').toLowerCase();
        
        if (message.includes('timeout')) return 'timeout';
        if (message.includes('auth') || message.includes('401') || message.includes('403')) return 'authentication';
        if (message.includes('not found') || message.includes('404')) return 'not_found';
        if (message.includes('network') || message.includes('econnrefused')) return 'network';
        if (message.includes('rate') || message.includes('429')) return 'rate_limit';
        if (message.includes('invalid')) return 'validation';
        if (message.includes('module')) return 'module_error';
        if (message.includes('permission')) return 'permission';
        
        return 'other';
    }

    /**
     * Check if deployment path is upward
     */
    isUpwardPath(source, target) {
        const envOrder = { 'Integration': 0, 'Preproduction': 1, 'Production': 2 };
        return (envOrder[target] || 0) > (envOrder[source] || 0);
    }

    /**
     * Queue event for sending
     */
    queueEvent(event) {
        if (!this.enabled) return;
        
        // Add event to queue
        this.pendingEvents.push(event);
        
        // Always try to send immediately if we have an endpoint
        // This ensures events are sent even in short-lived MCP sessions
        if (this.endpoint) {
            // Send immediately and don't wait for response
            this.sendEvents([event]).catch(() => {
                // If send fails, events remain in pendingEvents for retry
                this.saveEventsLocally();
            });
        } else {
            this.saveEventsLocally();
        }
    }

    /**
     * Save events to local storage
     */
    saveEventsLocally() {
        try {
            const eventsFile = path.join(this.localStoragePath, 'pending.json');
            
            // Keep only last 1000 events to prevent unlimited growth
            if (this.pendingEvents.length > 1000) {
                this.pendingEvents = this.pendingEvents.slice(-1000);
            }
            
            fs.writeFileSync(eventsFile, JSON.stringify(this.pendingEvents, null, 2));
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Failed to save telemetry locally:', error.message);
            }
        }
    }

    /**
     * Send events to telemetry endpoint
     */
    async sendEvents(events) {
        if (!this.enabled || !this.endpoint || events.length === 0) return;
        
        try {
            const data = JSON.stringify({
                events,
                session: {
                    id: this.sessionId,
                    version: this.metrics.environment.mpcVersion,
                    platform: this.metrics.environment.platform
                }
            });
            
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'User-Agent': `jaxon-optimizely-mcp/${this.metrics.environment.mpcVersion}`
                },
                timeout: 5000 // 5 second timeout
            };
            
            // Parse endpoint URL
            const url = new URL(this.endpoint);
            options.hostname = url.hostname;
            options.port = url.port || 443;
            options.path = url.pathname;
            
            return new Promise((resolve) => {
                const req = https.request(options, (res) => {
                    if (res.statusCode === 200 || res.statusCode === 204) {
                        // Success - remove sent events from pending
                        this.pendingEvents = this.pendingEvents.filter(e => !events.includes(e));
                        this.saveEventsLocally();
                    }
                    resolve();
                });
                
                req.on('error', () => {
                    // Silently fail - keep events for retry
                    resolve();
                });
                
                req.on('timeout', () => {
                    req.destroy();
                    resolve();
                });
                
                req.write(data);
                req.end();
            });
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Failed to send telemetry:', error.message);
            }
        }
    }

    /**
     * Send all pending events
     */
    async sendPendingEvents() {
        if (!this.enabled || !this.endpoint || this.pendingEvents.length === 0) return;
        
        // Send in batches of 50
        const batchSize = 50;
        while (this.pendingEvents.length > 0) {
            const batch = this.pendingEvents.slice(0, batchSize);
            await this.sendEvents(batch);
            
            // If events weren't sent (no endpoint), stop trying
            if (this.pendingEvents.length === batch.length) {
                break;
            }
        }
    }
    
    /**
     * Force flush events (for MCP sessions)
     * This ensures events are sent even in short-lived processes
     */
    async flush() {
        if (!this.enabled) return;
        
        try {
            // Send any pending events immediately
            await this.sendPendingEvents();
            
            // Also send session summary if we have tool usage
            if (Object.keys(this.metrics.toolUsage).length > 0) {
                const summary = this.getSessionSummary();
                if (summary) {
                    await this.sendEvents([summary]);
                }
            }
        } catch (error) {
            // Silently fail but save events locally
            this.saveEventsLocally();
            if (process.env.DEBUG) {
                console.error('Telemetry flush failed:', error.message);
            }
        }
    }

    /**
     * Get session summary
     */
    getSessionSummary() {
        if (!this.enabled) return null;
        
        const duration = Date.now() - this.metrics.sessionStart;
        const toolCount = Object.keys(this.metrics.toolUsage).length;
        const totalUsage = Object.values(this.metrics.toolUsage).reduce((sum, tool) => sum + tool.count, 0);
        
        return {
            type: 'session_summary',
            timestamp: Date.now(),
            sessionId: this.sessionId,
            duration,
            summary: {
                toolsUsed: toolCount,
                totalOperations: totalUsage,
                errorCount: this.metrics.errors.length,
                topTools: this.getTopTools(5),
                environment: this.metrics.environment
            }
        };
    }

    /**
     * Get top used tools
     */
    getTopTools(limit = 5) {
        return Object.entries(this.metrics.toolUsage)
            .sort((a, b) => b[1].count - a[1].count)
            .slice(0, limit)
            .map(([name, data]) => ({
                name,
                count: data.count,
                environments: Array.from(data.environments || [])
            }));
    }

    /**
     * Shutdown telemetry (send final summary)
     */
    async shutdown() {
        if (!this.enabled) return;
        
        try {
            // Send session summary
            const summary = this.getSessionSummary();
            if (summary) {
                await this.sendEvents([summary]);
            }
            
            // Send any remaining pending events
            await this.sendPendingEvents();
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Telemetry shutdown failed:', error.message);
            }
        }
    }

    /**
     * Get privacy-safe analytics report
     */
    getAnalyticsReport() {
        if (!this.enabled) return null;
        
        return {
            enabled: true,
            sessionId: this.sessionId,
            uptime: Date.now() - this.metrics.sessionStart,
            tools: {
                count: Object.keys(this.metrics.toolUsage).length,
                totalUsage: Object.values(this.metrics.toolUsage).reduce((sum, t) => sum + t.count, 0),
                top: this.getTopTools(3)
            },
            errors: {
                count: this.metrics.errors.length,
                categories: this.metrics.errors.reduce((acc, err) => {
                    acc[err.error.category] = (acc[err.error.category] || 0) + 1;
                    return acc;
                }, {})
            },
            performance: Object.entries(this.metrics.performance).reduce((acc, [op, data]) => {
                acc[op] = {
                    avgDuration: Math.round(data.avgDuration),
                    operations: data.count
                };
                return acc;
            }, {})
        };
    }
}

// Singleton instance
let telemetryInstance = null;

/**
 * Get or create telemetry instance
 */
function getTelemetry() {
    if (!telemetryInstance) {
        telemetryInstance = new Telemetry();
        
        // Register shutdown handler
        process.on('beforeExit', () => {
            if (telemetryInstance) {
                telemetryInstance.shutdown();
            }
        });
    }
    return telemetryInstance;
}

module.exports = {
    Telemetry,
    getTelemetry
};