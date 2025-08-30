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
        this.enabled = this.checkTelemetryEnabled();
        
        // Anonymous session ID
        this.sessionId = this.generateSessionId();
        
        // Telemetry endpoint - must be explicitly configured for enterprise use
        // Default endpoint managed internally by Jaxon Digital
        this.endpoint = process.env.TELEMETRY_ENDPOINT || 'https://accelerator.jaxondigital.com/api/telemetry/mcp';
        
        // Local storage for offline events
        this.localStoragePath = path.join(os.tmpdir(), 'optimizely-mcp-telemetry');
        this.pendingEvents = [];
        this.sessionEndSent = false; // Prevent duplicate session_end events
        this.shuttingDown = false; // Prevent duplicate shutdown calls
        
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
            // Send session start event
            this.sendSessionStart();
        }
    }

    /**
     * Check if telemetry is enabled (default: ON, opt-out model)
     * Users must explicitly set OPTIMIZELY_MCP_TELEMETRY=false to disable
     */
    checkTelemetryEnabled() {
        // Check if explicitly disabled via environment variable
        const telemetryEnv = process.env.OPTIMIZELY_MCP_TELEMETRY || process.env.MCP_TELEMETRY;
        
        // Only disable if explicitly set to 'false' (case insensitive)
        if (telemetryEnv && telemetryEnv.toLowerCase() === 'false') {
            return false;
        }
        
        // Check settings manager for user preference (synchronously)
        try {
            const SettingsManager = require('./settings-manager');
            // Use cached settings if available to avoid async call
            if (SettingsManager.settings && SettingsManager.settings.telemetryEnabled === false) {
                return false;
            }
        } catch (error) {
            // Silently fail and continue checking
        }
        
        // Check project configuration for explicit disable
        try {
            const ProjectTools = require('./tools/project-tools');
            const projects = ProjectTools.getConfiguredProjects();
            
            // If any project explicitly has telemetry=false, disable it
            const telemetryDisabled = projects.some(project => project.telemetry === false);
            if (telemetryDisabled) {
                return false;
            }
        } catch (error) {
            // Silently fail and use default
        }
        
        // Default: ENABLED (opt-out model)
        // Telemetry is on unless explicitly disabled
        return true;
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
     * Send session start event
     */
    sendSessionStart() {
        if (!this.enabled) return;
        
        const event = {
            type: 'session_start',
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,
            source: 'dxp-mcp',
            version: this.getPackageVersion(),
            platform: os.platform(),
            tool_name: null, // No specific tool for session start
            duration_ms: 0,
            event: {
                node_version: process.version,
                platform: os.platform(),
                arch: os.arch()
            }
        };
        
        this.queueEvent(event);
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
     * Track detailed tool call event (for analytics platform)
     */
    trackToolCall(toolName, duration, args = {}, success = true, error = null) {
        if (!this.enabled) return;
        
        try {
            // DEBUG: Log tool call details
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] trackToolCall invoked:', {
                    toolName,
                    duration,
                    success,
                    hasError: !!error,
                    endpoint: this.endpoint,
                    enabled: this.enabled
                });
            }
            
            // Get project name safely without exposing sensitive data
            const projectName = this.getProjectNameSafe(args);
            
            // Create detailed tool call event matching analytics platform requirements
            const event = {
                timestamp: new Date().toISOString(),
                session_id: this.sessionId,
                type: success ? "tool_invocation" : "tool_error", // Analytics platform expects this field
                event_type: success ? "tool_call" : "error", // Keep for backward compatibility
                source: "dxp-mcp",
                version: this.getPackageVersion(),
                platform: os.platform(),
                tool_name: toolName, // Critical field - must not be null
                duration_ms: Math.round(duration), // Ensure it's an integer
                project_name: projectName,
                environment: args.environment || null,
                event: { // Changed from metadata to event to match expected structure
                    success: success,
                    parameters: this.sanitizeParameters(args),
                    tool: toolName // Redundant but ensures tool tracking
                }
            };
            
            // Add error details if failed
            if (!success && error) {
                event.error_type = this.categorizeError(error);
                event.error_code = error.code || 'UNKNOWN';
                event.event.error_message = this.sanitizeErrorMessage(error.message); // Fixed path to event.event
            }
            
            // DEBUG: Verify critical fields are not null
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                if (!event.tool_name || !event.type || event.duration_ms === null) {
                    console.error('[TELEMETRY ERROR] Missing required fields!', {
                        tool_name: event.tool_name,
                        type: event.type,
                        duration_ms: event.duration_ms
                    });
                } else {
                    console.log('[TELEMETRY DEBUG] Event created successfully:', {
                        tool_name: event.tool_name,
                        type: event.type,
                        duration_ms: event.duration_ms,
                        source: event.source
                    });
                }
            }
            
            this.queueEvent(event);
        } catch (err) {
            // Silently fail
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY ERROR] Tool call tracking failed:', err.message);
            }
        }
    }
    
    /**
     * Get project name in a privacy-safe way
     */
    getProjectNameSafe(args) {
        // Don't expose actual project names - use a generic identifier
        if (args.projectId) {
            return `project-${args.projectId.substring(0, 8)}`;
        }
        return "unknown-project";
    }
    
    /**
     * Sanitize parameters to remove sensitive data
     */
    sanitizeParameters(args) {
        const sanitized = {};
        
        // Include safe parameters only
        const safeParams = [
            'environment', 'containerName', 'downloadPath', 'databaseName',
            'sourceEnvironment', 'targetEnvironment', 'deploymentType',
            'includeBlob', 'includeDatabase', 'directDeploy', 'useMaintenancePage',
            'previewOnly', 'autoDownload', 'dateFilter', 'logType'
        ];
        
        safeParams.forEach(param => {
            if (args[param] !== undefined) {
                sanitized[param] = args[param];
            }
        });
        
        // Add counts/booleans without sensitive data
        sanitized.hasApiKey = !!args.apiKey;
        sanitized.hasProjectId = !!args.projectId;
        sanitized.hasFilter = !!args.filter;
        sanitized.hasDownloadPath = !!args.downloadPath;
        
        return sanitized;
    }
    
    /**
     * Sanitize error messages to remove sensitive data
     */
    sanitizeErrorMessage(message) {
        if (!message || typeof message !== 'string') return 'Unknown error';
        
        // Remove potentially sensitive patterns
        let sanitized = message
            .replace(/key=[\w-]+/gi, 'key=***')
            .replace(/secret=[\w-]+/gi, 'secret=***')
            .replace(/token=[\w-]+/gi, 'token=***')
            .replace(/password=[\w-]+/gi, 'password=***')
            .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, 'PROJECT_ID')
            .replace(/https?:\/\/[^\s]+/gi, 'URL');
        
        // Truncate if too long
        if (sanitized.length > 200) {
            sanitized = sanitized.substring(0, 200) + '...';
        }
        
        return sanitized;
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
        
        // DEBUG: Log queuing
        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.log('[TELEMETRY DEBUG] Event queued:', {
                type: event.type,
                tool_name: event.tool_name,
                pendingCount: this.pendingEvents.length,
                hasEndpoint: !!this.endpoint
            });
        }
        
        // Always try to send immediately if we have an endpoint
        // This ensures events are sent even in short-lived MCP sessions
        if (this.endpoint) {
            // Send immediately and don't wait for response
            this.sendEvents([event]).catch((err) => {
                // If send fails, events remain in pendingEvents for retry
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY DEBUG] Send failed:', err.message);
                }
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
            // DEBUG: Log send attempt
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] Sending events:', {
                    count: events.length,
                    endpoint: this.endpoint,
                    firstEvent: events[0] ? {
                        type: events[0].type,
                        tool_name: events[0].tool_name
                    } : null
                });
            }
            
            // Use the format expected by the OCA telemetry system
            const data = JSON.stringify({
                Session: {
                    Id: this.sessionId,
                    Version: this.metrics.environment.mpcVersion,
                    Platform: "DXP-MCP"
                },
                Events: events  // Send the events array directly
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
                    let responseData = '';
                    res.on('data', chunk => responseData += chunk);
                    res.on('end', () => {
                        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                            console.log('[TELEMETRY DEBUG] Response:', {
                                statusCode: res.statusCode,
                                body: responseData.substring(0, 200)
                            });
                        }
                        
                        if (res.statusCode === 200 || res.statusCode === 204) {
                            // Success - remove sent events from pending
                            // FIX: Use timestamp comparison instead of object reference
                            const sentTimestamps = events.map(e => e.timestamp);
                            const beforeCount = this.pendingEvents.length;
                            this.pendingEvents = this.pendingEvents.filter(e => 
                                !sentTimestamps.includes(e.timestamp)
                            );
                            const afterCount = this.pendingEvents.length;
                            
                            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                                console.log('[TELEMETRY DEBUG] Events sent successfully:', {
                                    removed: beforeCount - afterCount,
                                    remaining: afterCount
                                });
                            }
                            
                            this.saveEventsLocally();
                        } else {
                            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                                console.error('[TELEMETRY DEBUG] Non-200 response:', res.statusCode);
                            }
                        }
                    });
                    resolve();
                });
                
                req.on('error', (err) => {
                    // Log error but keep events for retry
                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.error('[TELEMETRY DEBUG] Request error:', err.message);
                    }
                    resolve();
                });
                
                req.on('timeout', () => {
                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.error('[TELEMETRY DEBUG] Request timeout');
                    }
                    req.destroy();
                    resolve();
                });
                
                req.write(data);
                req.end();
            });
        } catch (error) {
            // Log error
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY ERROR] Failed to send telemetry:', error.message);
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
            // DEBUG: Log flush start
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] Flush called:', {
                    pendingEvents: this.pendingEvents.length,
                    toolUsageCount: Object.keys(this.metrics.toolUsage).length
                });
            }
            
            // Send any pending events immediately
            await this.sendPendingEvents();
            
            // Send session summary only if we have tool usage and haven't sent it yet
            if (Object.keys(this.metrics.toolUsage).length > 0 && !this.sessionEndSent) {
                const summary = this.getSessionSummary();
                if (summary) {
                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.log('[TELEMETRY DEBUG] Sending session summary from flush');
                    }
                    await this.sendEvents([summary]);
                }
            }
            
            // DEBUG: Log flush complete
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] Flush complete:', {
                    remainingEvents: this.pendingEvents.length
                });
            }
        } catch (error) {
            // Silently fail but save events locally
            this.saveEventsLocally();
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY ERROR] Flush failed:', error.message);
            }
        }
    }

    /**
     * Get session summary (only once per session to prevent infinite loops)
     */
    getSessionSummary() {
        if (!this.enabled) return null;
        
        // Prevent duplicate session_end events
        if (this.sessionEndSent) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] Session summary already sent, skipping');
            }
            return null;
        }
        
        const duration = Date.now() - this.metrics.sessionStart;
        const toolCount = Object.keys(this.metrics.toolUsage).length;
        const totalUsage = Object.values(this.metrics.toolUsage).reduce((sum, tool) => sum + tool.count, 0);
        
        // Mark session_end as sent to prevent infinite loops
        this.sessionEndSent = true;
        
        return {
            type: 'session_end', // Changed to match expected event types
            timestamp: new Date().toISOString(),
            session_id: this.sessionId, // Changed to match expected field name
            sessionId: this.sessionId, // Keep for backward compatibility
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
        if (!this.enabled || this.shuttingDown) return;
        
        this.shuttingDown = true; // Prevent duplicate shutdowns
        
        try {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] Shutdown initiated');
            }
            
            // Send session summary if not already sent
            const summary = this.getSessionSummary();
            if (summary) {
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.log('[TELEMETRY DEBUG] Sending final session summary');
                }
                await this.sendEvents([summary]);
            }
            
            // Send any remaining pending events
            await this.sendPendingEvents();
            
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.log('[TELEMETRY DEBUG] Shutdown completed');
            }
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