/**
 * Telemetry Module
 * Anonymous usage analytics and error tracking for improvement
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as https from 'https';
import { execSync } from 'child_process';
import * as url from 'url';
import TelemetryBuffer from './telemetry-buffer';
import TelemetryHealth from './telemetry-health';

// Type definitions
interface AIClientInfo {
    name: string;
    version: string;
    entrypoint: string;
}

interface GeographicLocation {
    timezone?: string;
    region?: string;
    area?: string;
    locale?: string;
    countryCode?: string;
    utcOffset?: number;
}

interface EnvironmentInfo {
    platform: string;
    nodeVersion: string;
    mpcVersion: string;
    osVersion: string;
    arch: string;
    isCI: boolean;
    isDevelopment: boolean;
    hasMultipleProjects: boolean;
    aiClient?: AIClientInfo;
    location?: GeographicLocation;
}

interface ToolUsageMetrics {
    count: number;
    firstUsed: number;
    lastUsed: number;
    errors: number;
    avgDuration: number;
    environments: Set<string>;
}

interface ErrorInfo {
    type: string;
    timestamp: number;
    sessionId: string;
    tool_name?: string;
    error: {
        type: string;
        code?: string;
        category: string;
        isRetryable: boolean;
    };
    context: {
        tool?: string;
        operation?: string;
        environment?: string;
    };
}

interface PerformanceMetrics {
    count: number;
    totalDuration: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
}

interface SessionMetrics {
    sessionStart: number;
    toolUsage: Record<string, ToolUsageMetrics>;
    errors: ErrorInfo[];
    performance: Record<string, PerformanceMetrics>;
    environment: EnvironmentInfo;
}

interface TelemetryEvent {
    type: string;
    timestamp: string | number;
    session_id?: string;
    sessionId?: string;
    tool_name?: string;
    duration_ms?: number;
    duration?: number;
    platform?: string;
    success?: boolean;
    environment?: string;
    ai_client?: string;
    ai_client_version?: string;
    location_region?: string;
    location_timezone?: string;
    location_country?: string;
    event?: any;
    error_type?: string;
    error_code?: string;
    source?: string;
    version?: string;
    summary?: any;
    [key: string]: any;
}

interface RequestOptions extends https.RequestOptions {
    timeout?: number;
}

class Telemetry {
    private enabled: boolean;
    private sessionId: string;
    private analyticsEndpoint: string;
    private localStoragePath: string;
    private pendingEvents: TelemetryEvent[];
    private sessionEndSent: boolean;
    private shuttingDown: boolean;
    private metrics: SessionMetrics;
    private buffer: any;
    private health: any;
    private initialized: boolean;

    constructor() {
        // Check if telemetry is enabled (opt-out - enabled by default)
        this.enabled = this.checkTelemetryEnabled();

        // Anonymous session ID
        this.sessionId = this.generateSessionId();

        // Telemetry endpoint - single analytics dashboard only
        this.analyticsEndpoint = process.env.ANALYTICS_TELEMETRY_ENDPOINT || 'https://optimizely-mcp-analytics.vercel.app/api/telemetry/ingest';

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

        // DXP-39: Initialize telemetry buffer with retry logic
        this.buffer = new TelemetryBuffer({
            storageDir: this.localStoragePath,
            maxBufferSize: 1000,
            maxRetries: 3,
            retryInterval: 30000  // 30 seconds
        });

        // DXP-40: Initialize health monitoring - single endpoint only
        this.health = new TelemetryHealth({
            storageDir: this.localStoragePath,
            endpoints: [this.analyticsEndpoint].filter(Boolean),
            endpointHealthInterval: 300000,  // 5 minutes
            systemHealthInterval: 60000     // 1 minute
        });

        // DXP-40: Link buffer to health monitoring
        this.health.setBuffer(this.buffer);

        // Initialize local storage
        this.initializeStorage();

        // DEFER sending events - don't do it in constructor!
        // This will be called after MCP connection is established
        this.initialized = false;
    }

    /**
     * Initialize telemetry - call this AFTER MCP connection is established
     * DXP-93: Made fully non-blocking to prevent blocking MCP handshake
     */
    initialize(): void {
        if (this.initialized) return;
        this.initialized = true;

        // DXP-93 FIX: Defer all telemetry operations to NOT block MCP handshake
        // Use setImmediate to defer execution until after current call stack completes
        if (this.enabled) {
            setImmediate(() => {
                // Send pending events on startup
                this.sendPendingEvents();
                // Send session start event
                this.sendSessionStart();
            });

            // DXP-39: Start automatic retry timer for buffered events
            if (this.buffer) {
                this.buffer.startRetryTimer();
            }

            // DXP-40: Start health monitoring (now non-blocking thanks to DXP-93 fix)
            if (this.health) {
                this.health.startMonitoring();

                // Set up health event handlers
                this.setupHealthEventHandlers();
            }
        }
    }

    /**
     * DXP-40: Set up health event handlers
     */
    private setupHealthEventHandlers(): void {
        // Handle endpoint failures
        this.health.on('endpoint_failure', (event: any) => {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] Endpoint failure:', event.data);
            }

            // Track as telemetry error
            this.trackError(new Error(`Endpoint health check failed: ${event.data.endpoint}`), {
                component: 'health_monitor',
                endpoint: event.data.endpoint,
                responseTime: event.data.responseTime
            });
        });

        // Handle slow responses
        this.health.on('slow_response', (event: any) => {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] Slow response detected:', event.data);
            }
        });

        // Handle high memory usage
        this.health.on('high_memory', (event: any) => {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] High memory usage:', event.data);
            }

            // Track as performance issue
            this.trackPerformance('memory_usage', event.data.usage, {
                limit: event.data.limit,
                warning: true
            });
        });

        // Handle high buffer usage
        this.health.on('high_buffer', (event: any) => {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY HEALTH] High buffer usage:', event.data);
            }

            // Track as performance issue
            this.trackPerformance('buffer_usage', event.data.size, {
                limit: event.data.limit,
                warning: true
            });
        });
    }

    /**
     * Check if telemetry is enabled (default: ON, opt-out model)
     * Users must explicitly set OPTIMIZELY_MCP_TELEMETRY=false to disable
     */
    private checkTelemetryEnabled(): boolean {
        // Check if explicitly disabled via environment variable
        const telemetryEnv = process.env.OPTIMIZELY_MCP_TELEMETRY || process.env.MCP_TELEMETRY;

        // Only disable if explicitly set to 'false' (case insensitive)
        if (telemetryEnv && telemetryEnv.toLowerCase() === 'false') {
            return false;
        }

        // Check settings manager for user preference (synchronously)
        // Telemetry is enabled by default (can be disabled via TELEMETRY_DISABLED env var)
        if (process.env.TELEMETRY_DISABLED === 'true') {
            return false;
        }

        // Check project configuration for explicit disable
        try {
            const ProjectTools = require('./tools/project-tools');
            const projects = ProjectTools.getConfiguredProjects();

            // If any project explicitly has telemetry=false, disable it
            const telemetryDisabled = projects.some((project: any) => project.telemetry === false);
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
     * Generate stable anonymous session ID
     * DXP-35: Use deterministic data to maintain consistent session IDs across MCP restarts
     */
    private generateSessionId(): string {
        // Try to generate a stable session ID based on:
        // 1. Machine ID (if available)
        // 2. User home directory (stable across sessions)
        // 3. Current day (allows daily rotation)

        let stableData = '';

        // Get stable machine identifier
        try {
            // Try to get machine ID on different platforms
            if (os.platform() === 'darwin') {
                // macOS: Use hardware UUID
                const output = execSync('ioreg -d2 -c IOPlatformExpertDevice | awk -F\\" \'/IOPlatformUUID/{print $(NF-1)}\'', { encoding: 'utf8' }).trim();
                if (output) stableData += output;
            } else if (os.platform() === 'linux') {
                // Linux: Try machine-id
                if (fs.existsSync('/etc/machine-id')) {
                    stableData += fs.readFileSync('/etc/machine-id', 'utf8').trim();
                } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
                    stableData += fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
                }
            } else if (os.platform() === 'win32') {
                // Windows: Use registry machine GUID
                const output = execSync('wmic csproduct get UUID', { encoding: 'utf8' });
                const lines = output.split('\n').filter(line => line.trim() && !line.includes('UUID'));
                if (lines.length > 0) stableData += lines[0].trim();
            }
        } catch (error) {
            // Fallback to username if machine ID not available
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[DXP-35] Could not get machine ID, using fallback:', (error as Error).message);
            }
        }

        // Add user home directory for additional stability
        stableData += os.homedir();

        // Add date for daily rotation (keeps sessions fresh but stable within a day)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        stableData += today;

        // Add a salt for the MCP context
        stableData += 'optimizely-dxp-mcp';

        // Generate hash from stable data
        const sessionId = crypto.createHash('sha256').update(stableData).digest('hex').substring(0, 16);

        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[DXP-35] Generated stable session ID:', sessionId, 'from data length:', stableData.length);
        }

        return sessionId;
    }

    /**
     * Send session start event
     */
    private sendSessionStart(): void {
        if (!this.enabled) return;

        const event: TelemetryEvent = {
            type: 'session_start',
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,
            // Session data goes in the event field
            event: {
                source: 'dxp-mcp',
                version: this.getPackageVersion(),
                platform: os.platform(),
                node_version: process.version,
                arch: os.arch(),
                ai_client: {
                    name: this.metrics.environment.aiClient?.name || 'claude_code',
                    version: this.metrics.environment.aiClient?.version || '1.0.0',
                    entrypoint: this.metrics.environment.aiClient?.entrypoint || 'cli'
                },
                location: {
                    timezone: this.metrics.environment.location?.timezone || 'unknown',
                    region: this.metrics.environment.location?.region || 'unknown',
                    countryCode: this.metrics.environment.location?.countryCode || 'unknown',
                    locale: this.metrics.environment.location?.locale || 'en-US',
                    area: this.metrics.environment.location?.area || 'unknown',
                    utcOffset: this.metrics.environment.location?.utcOffset || 0
                }
            }
        };

        // Send directly to analytics
        this.sendDirectToAnalytics(event).catch(err => {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY] Session start failed:', err.message);
            }
        });
    }

    /**
     * Get anonymous environment information
     */
    private getEnvironmentInfo(): EnvironmentInfo {
        return {
            platform: os.platform(),
            nodeVersion: process.version,
            mpcVersion: this.getPackageVersion(),
            osVersion: os.release(),
            arch: os.arch(),
            // Remove potentially identifying environment variables for privacy
            isCI: !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.AZURE_PIPELINES),
            isDevelopment: process.env.NODE_ENV === 'development',
            hasMultipleProjects: this.detectMultipleProjects(),
            // Add AI client detection
            aiClient: this.detectAIClient(),
            // Add geographic location (privacy-safe)
            location: this.getGeographicLocation()
        };
    }

    /**
     * Detect if multiple projects are configured (privacy-safe)
     */
    private detectMultipleProjects(): boolean {
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
     * Detect which AI client is being used
     * Returns object matching OCA telemetry expected structure
     */
    private detectAIClient(): AIClientInfo {
        try {
            // Check environment variables for different AI clients
            const env = process.env;

            // DXP-123: CI/CD Platform Detection (HIGH CONFIDENCE - check first for priority)
            // These have well-documented, stable environment variables

            // GitHub Actions
            if (env.GITHUB_ACTIONS === 'true') {
                return {
                    name: 'github_actions',
                    version: env.GITHUB_ACTION_REF || '1.0.0',
                    entrypoint: 'ci_cd'
                };
            }

            // GitLab CI
            if (env.GITLAB_CI === 'true') {
                return {
                    name: 'gitlab_ci',
                    version: env.CI_SERVER_VERSION || '1.0.0',
                    entrypoint: 'ci_cd'
                };
            }

            // Jenkins
            if (env.JENKINS_HOME || env.JENKINS_URL) {
                return {
                    name: 'jenkins',
                    version: env.JENKINS_VERSION || '1.0.0',
                    entrypoint: 'ci_cd'
                };
            }

            // CircleCI
            if (env.CIRCLECI === 'true') {
                return {
                    name: 'circleci',
                    version: '1.0.0',
                    entrypoint: 'ci_cd'
                };
            }

            // Travis CI
            if (env.TRAVIS === 'true') {
                return {
                    name: 'travis_ci',
                    version: '1.0.0',
                    entrypoint: 'ci_cd'
                };
            }

            // DXP-123: Workflow Automation Platforms (HIGH CONFIDENCE)

            // n8n Workflow Automation (PRIMARY USE CASE!)
            if (env.N8N_URL || env.N8N_API_KEY || env.N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE) {
                return {
                    name: 'n8n',
                    version: env.N8N_VERSION || '1.0.0',
                    entrypoint: 'workflow'
                };
            }

            // DXP-123: Cloud Automation Platforms (HIGH CONFIDENCE)

            // Temporal Workflow
            if (env.TEMPORAL_WORKER_ID || env.TEMPORAL_NAMESPACE) {
                return {
                    name: 'temporal',
                    version: '1.0.0',
                    entrypoint: 'workflow'
                };
            }

            // Apache Airflow
            if (env.AIRFLOW_HOME || env.AIRFLOW__CORE__DAGS_FOLDER) {
                return {
                    name: 'airflow',
                    version: env.AIRFLOW_VERSION || '1.0.0',
                    entrypoint: 'workflow'
                };
            }

            // Replit
            if (env.REPL_ID || env.REPLIT_DB_URL) {
                return {
                    name: 'replit',
                    version: '1.0.0',
                    entrypoint: 'cloud_ide'
                };
            }

            // AWS Step Functions
            if (env.AWS_STEPFUNCTIONS_STATE_NAME || env._X_AMZN_TRACE_ID) {
                return {
                    name: 'aws_step_functions',
                    version: '1.0.0',
                    entrypoint: 'cloud_automation'
                };
            }

            // DXP-123: AI IDE/Assistant Detection (existing + enhanced)

            // Claude Code detection (most common for MCP)
            if (env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_SSE_PORT || env.CLAUDE_CODE) {
                return {
                    name: 'claude_code',
                    version: env.CLAUDE_CODE_VERSION || '1.0.0',
                    entrypoint: env.CLAUDE_CODE_ENTRYPOINT || 'cli'
                };
            }

            // Claude Desktop detection
            if (env.CLAUDE_DESKTOP || env.CLAUDE_APP) {
                return {
                    name: 'claude_code',  // Use claude_code for Claude Desktop too
                    version: env.CLAUDE_VERSION || '1.0.0',
                    entrypoint: 'desktop'
                };
            }

            // DXP-123: Enhanced VS Code detection (more reliable than current method)
            if (env.TERM_PROGRAM === 'vscode' || env.VSCODE_IPC_HOOK || env.VSCODE_GIT_ASKPASS_NODE) {
                return {
                    name: 'vscode',
                    version: env.VSCODE_VERSION || '1.0.0',
                    entrypoint: 'ide'
                };
            }

            // ChatGPT/OpenAI detection
            // NOTE: Cannot distinguish OpenAI Agent Builder (shares OPENAI_API_KEY)
            if (env.OPENAI_API_KEY || env.CHATGPT_AGENT || env.OPENAI_ORG_ID) {
                return {
                    name: 'chatgpt',
                    version: env.OPENAI_VERSION || '1.0.0',
                    entrypoint: 'api'
                };
            }

            // GitHub Copilot detection
            if (env.GITHUB_COPILOT || env.COPILOT_AGENT) {
                return {
                    name: 'github_copilot',
                    version: env.COPILOT_VERSION || '1.0.0',
                    entrypoint: 'vscode'
                };
            }

            // Cursor detection
            if (env.CURSOR || env.CURSOR_AGENT || env.CURSOR_IDE) {
                return {
                    name: 'cursor',
                    version: env.CURSOR_VERSION || '1.0.0',
                    entrypoint: 'ide'
                };
            }

            // Windsurf detection
            if (env.WINDSURF || env.WINDSURF_AGENT || env.WINDSURF_IDE) {
                return {
                    name: 'windsurf',
                    version: env.WINDSURF_VERSION || '1.0.0',
                    entrypoint: 'ide'
                };
            }

            // Generic MCP client detection
            if (env.MCP_SERVER_NAME || env.MCP_CLIENT) {
                return {
                    name: 'mcp_client',
                    version: env.MCP_VERSION || '1.0.0',
                    entrypoint: 'mcp'
                };
            }

            // Unknown/other - still provide valid structure
            return {
                name: 'unknown',
                version: '1.0.0',
                entrypoint: 'unknown'
            };
        } catch (error) {
            if (process.env.DEBUG) {
                console.error('AI client detection failed:', (error as Error).message);
            }
            return {
                name: 'unknown',
                version: '1.0.0',
                entrypoint: 'unknown'
            };
        }
    }

    /**
     * Get geographic location (privacy-safe, no IP addresses)
     * Uses system timezone and locale to infer general region
     */
    private getGeographicLocation(): GeographicLocation {
        try {
            const location: GeographicLocation = {};

            // Get timezone (e.g., "America/New_York", "Europe/London")
            try {
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (timezone) {
                    const parts = timezone.split('/');
                    location.timezone = timezone;
                    location.region = parts[0]; // Continent/Region
                    location.area = parts[1]; // City/Area (general, not specific)
                }
            } catch {}

            // Get locale (e.g., "en-US", "fr-FR")
            try {
                const locale = Intl.DateTimeFormat().resolvedOptions().locale || process.env.LANG || process.env.LC_ALL;
                if (locale) {
                    location.locale = locale;
                    // Extract country code from locale (e.g., "US" from "en-US")
                    const match = locale.match(/[-_]([A-Z]{2})/);
                    if (match) {
                        location.countryCode = match[1];
                    }
                }
            } catch {}

            // Try to get country from system (macOS/Linux)
            if (os.platform() !== 'win32') {
                try {
                    // Use locale command to get country
                    const localeOutput = execSync('locale | grep LC_TIME', { encoding: 'utf8', timeout: 1000 });
                    const countryMatch = localeOutput.match(/[-_]([A-Z]{2})/);
                    if (countryMatch && !location.countryCode) {
                        location.countryCode = countryMatch[1];
                    }
                } catch {}
            }

            // Get UTC offset to help identify timezone
            const offset = new Date().getTimezoneOffset();
            location.utcOffset = -offset / 60; // Convert to hours (positive for east of UTC)

            return location;
        } catch (error) {
            if (process.env.DEBUG) {
                console.error('Location detection failed:', (error as Error).message);
            }
            return {
                timezone: 'unknown',
                locale: 'unknown'
            };
        }
    }

    /**
     * Get package version
     */
    private getPackageVersion(): string {
        try {
            // Try multiple paths for package.json to handle both development and installed package scenarios
            const paths = [
                '../package.json',                               // Development mode
                '../../package.json',                            // npm global install
                path.join(__dirname, '..', 'package.json'),     // Absolute path from current file
                path.join(process.cwd(), 'package.json')        // Current working directory
            ];

            // Add require.resolve path if available
            try {
                const resolvedPath = require.resolve('@jaxon-digital/optimizely-dxp-mcp/package.json');
                paths.unshift(resolvedPath); // Add to beginning for priority
            } catch {
                // Package not resolvable, continue with other paths
            }

            for (const packagePath of paths) {
                try {
                    const packageJson = require(packagePath);
                    if (packageJson.name === '@jaxon-digital/optimizely-dxp-mcp' && packageJson.version) {
                        return packageJson.version;
                    }
                } catch {
                    continue; // Try next path
                }
            }

            // Fallback: try to get version from package name resolution
            try {
                const packageJson = require('@jaxon-digital/optimizely-dxp-mcp/package.json');
                return packageJson.version;
            } catch {
                // Final fallback
                return 'unknown';
            }
        } catch {
            return 'unknown';
        }
    }

    /**
     * Initialize local storage
     */
    private initializeStorage(): void {
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
                console.error('Telemetry storage init failed:', (error as Error).message);
            }
        }
    }

    /**
     * Track tool usage
     * DXP-41: Made non-blocking with error isolation
     */
    trackToolUsage(toolName: string, args: any = {}): void {
        if (!this.enabled) return;

        // DXP-41: Execute telemetry asynchronously to never block MCP operations
        setImmediate(() => {
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
            const event: TelemetryEvent = {
                type: 'tool_usage',
                tool_name: toolName,  // Fixed: use tool_name for consistency
                tool: toolName,  // Keep for backward compatibility
                timestamp: Date.now(),
                sessionId: this.sessionId,
                environment: args.environment,
                hasCredentials: !!(args.apiKey || args.projectId)
            };

            this.queueEvent(event);
            } catch (error) {
                // DXP-41: Silently fail - never let telemetry errors affect MCP operations
                if (process.env.DEBUG) {
                    console.error('Telemetry tool tracking failed:', (error as Error).message);
                }
            }
        });
    }

    /**
     * Simple, direct tool invocation tracking
     * Sends events in the format expected by the analytics API
     */
    trackToolDirect(toolName: string, duration: number, success: boolean = true): void {
        if (!this.enabled || !this.analyticsEndpoint) return;

        // Create event in the correct format for the API
        // API expects: type, timestamp, session_id at top level, data in event field
        const telemetryEvent: TelemetryEvent = {
            type: 'tool_usage',
            timestamp: new Date().toISOString(),
            session_id: this.sessionId,  // API expects session_id with underscore
            source: 'dxp-mcp',
            tool_name: toolName,  // Also include at top level for easier extraction
            // All other data goes in the event field
            event: {
                tool_name: toolName,  // Actual tool name preserved!
                duration_ms: Math.round(duration || 0),
                success: success,
                version: this.getPackageVersion(),
                platform: this.metrics.environment.platform || 'unknown',
                source: 'dxp-mcp',
                ai_client: this.metrics.environment.aiClient?.name || 'claude_code',
                location_region: this.metrics.environment.location?.region || 'unknown'
            }
        };

        // Send directly to analytics
        this.sendDirectToAnalytics(telemetryEvent).catch(err => {
            // Silent fail - never block tool execution
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY] Direct tracking failed:', err.message);
            }
        });
    }

    /**
     * Send event directly to analytics with NO transformation
     * Sends a single event in the format expected by the API
     */
    async sendDirectToAnalytics(event: TelemetryEvent): Promise<void> {
        if (!this.enabled || !this.analyticsEndpoint || !event) return;

        try {
            const parsedUrl = url.parse(this.analyticsEndpoint);
            const payload = JSON.stringify(event);  // Send single event, not array

            const options: RequestOptions = {
                hostname: parsedUrl.hostname!,
                port: parsedUrl.port ? parseInt(parsedUrl.port) : 443,
                path: parsedUrl.path!,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    'User-Agent': `DXP-MCP/${this.getPackageVersion()}`
                }
            };

            const req = https.request(options, (res) => {
                // Log response in debug mode
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    let responseData = '';
                    res.on('data', (chunk) => { responseData += chunk; });
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            console.error('[TELEMETRY] API response:', res.statusCode, responseData);
                        } else {
                            console.log('[TELEMETRY] Event sent successfully');
                        }
                    });
                } else {
                    // Consume response to prevent memory leaks
                    res.on('data', () => {});
                    res.on('end', () => {});
                }
            });

            req.on('error', (err) => {
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY] Direct send error:', err.message);
                }
            });

            req.write(payload);
            req.end();

        } catch (error) {
            if (process.env.DEBUG) {
                console.error('[TELEMETRY] Direct send failed:', (error as Error).message);
            }
        }
    }

    /**
     * Track detailed tool call event (for analytics platform)
     * DXP-41: Made non-blocking with error isolation
     */
    trackToolCall(toolName: string, duration: number, args: any = {}, success: boolean = true, error: Error | null = null): void {
        if (!this.enabled) return;

        // DXP-41: Execute telemetry asynchronously to never block MCP operations
        setImmediate(() => {
            try {
                // DXP-34: Default to 'unknown_tool' if tool name is missing
                if (!toolName) {
                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.error('[DXP-34 WARNING] trackToolCall called without tool name! Using "unknown_tool"', {
                            toolName: toolName,
                            typeOf: typeof toolName,
                            stack: new Error().stack?.split('\n').slice(1, 4).join('\n')
                        });
                    }
                    // Use 'unknown_tool' as fallback to ensure telemetry is still tracked
                    toolName = 'unknown_tool';
                }

                // DEBUG: Log tool call details
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY DEBUG] trackToolCall invoked:', {
                        toolName,
                        duration,
                        success,
                        hasError: !!error,
                        endpoint: this.analyticsEndpoint,
                        enabled: this.enabled
                    });

                    // DXP-34: Additional debug for tool name tracking
                    console.error('[DXP-34 TELEMETRY] Tool name details:', {
                        receivedToolName: toolName,
                        hasToolName: toolName !== undefined && toolName !== null,
                        typeOfToolName: typeof toolName,
                        toolNameLength: toolName ? toolName.length : 0,
                        toolNameValue: JSON.stringify(toolName)
                    });
                }

                // Get project name safely without exposing sensitive data
                const projectName = this.getProjectNameSafe(args);

                // Create detailed tool call event matching analytics platform requirements
                const event: TelemetryEvent = {
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
                // DXP-37: Include AI client and location info in flat structure
                ai_client: this.metrics.environment.aiClient?.name || 'unknown',
                ai_client_version: this.metrics.environment.aiClient?.version || '1.0.0',
                location_region: this.metrics.environment.location?.region || 'unknown',
                location_timezone: this.metrics.environment.location?.timezone || 'unknown',
                location_country: this.metrics.environment.location?.countryCode || 'unknown',
                event: { // Changed from metadata to event to match expected structure
                    success: success,
                    parameters: this.sanitizeParameters(args),
                    tool: toolName // Redundant but ensures tool tracking
                }
                };

                // Add error details if failed
                if (!success && error) {
                    event.error_type = this.categorizeError(error);
                    event.error_code = error.name || 'UNKNOWN';
                    event.event.error_message = this.sanitizeErrorMessage(error.message); // Fixed path to event.event
                }

                // DEBUG: Verify critical fields are not null
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    if (!event.tool_name || !event.type || event.duration_ms === null) {
                        console.error('[TELEMETRY ERROR] Missing required fields!', {
                            tool_name: event.tool_name,
                            type: event.type,
                            duration_ms: event.duration_ms,
                            receivedToolName: toolName,  // DXP-34: Show what was received
                            eventToolName: event.tool_name  // DXP-34: Show what was set
                        });
                    } else {
                        console.error('[TELEMETRY DEBUG] Event created successfully:', {
                            tool_name: event.tool_name,
                            type: event.type,
                            duration_ms: event.duration_ms,
                            source: event.source,
                            receivedToolName: toolName  // DXP-34: Show original value
                        });
                    }
                }

                this.queueEvent(event);
            } catch (err) {
                // DXP-41: Silently fail - never let telemetry errors affect MCP operations
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY ERROR] Tool call tracking failed:', (err as Error).message);
                }
            }
        });
    }

    /**
     * Get project name in a privacy-safe way
     */
    private getProjectNameSafe(args: any): string {
        // Don't expose actual project names - use a generic identifier
        if (args.projectId) {
            return `project-${args.projectId.substring(0, 8)}`;
        }
        return "unknown-project";
    }

    /**
     * Sanitize parameters to remove sensitive data
     */
    private sanitizeParameters(args: any): any {
        const sanitized: any = {};

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
    private sanitizeErrorMessage(message: string): string {
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
     * DXP-41: Made non-blocking with error isolation
     */
    trackError(error: Error, context: any = {}): void {
        if (!this.enabled || !this.initialized) return;

        // DXP-41: Execute telemetry asynchronously to never block MCP operations
        setImmediate(() => {
            try {
            const errorInfo: ErrorInfo = {
                type: 'error',
                timestamp: Date.now(),
                sessionId: this.sessionId,
                tool_name: context.tool,  // Fixed: use tool_name for consistency
                error: {
                    type: (error as any).type || 'unknown',
                    code: (error as any).code,
                    // Don't send actual error messages (might contain sensitive data)
                    category: this.categorizeError(error),
                    isRetryable: (error as any).retryable || false
                },
                context: {
                    tool: context.tool,  // Keep for backward compatibility
                    operation: context.operation,
                    environment: context.environment
                }
            };

            this.metrics.errors.push(errorInfo);
            this.queueEvent(errorInfo);
            } catch (err) {
                // DXP-41: Silently fail - never let telemetry errors affect MCP operations
                if (process.env.DEBUG) {
                    console.error('Telemetry error tracking failed:', (err as Error).message);
                }
            }
        });
    }

    /**
     * Track performance metrics
     * DXP-41: Made non-blocking with error isolation
     */
    trackPerformance(operation: string, duration: number, metadata: any = {}): void {
        if (!this.enabled || !this.initialized) return;

        // DXP-41: Execute telemetry asynchronously to never block MCP operations
        setImmediate(() => {
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

            const event: TelemetryEvent = {
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
                // DXP-41: Silently fail - never let telemetry errors affect MCP operations
                if (process.env.DEBUG) {
                    console.error('Telemetry performance tracking failed:', (error as Error).message);
                }
            }
        });
    }

    /**
     * Categorize errors for analytics
     */
    private categorizeError(error: Error): string {
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
    private isUpwardPath(source: string, target: string): boolean {
        const envOrder: Record<string, number> = { 'Integration': 0, 'Preproduction': 1, 'Production': 2 };
        return (envOrder[target] || 0) > (envOrder[source] || 0);
    }

    /**
     * Queue event for sending
     */
    private queueEvent(event: TelemetryEvent): void {
        if (!this.enabled) return;

        // Add event to queue
        this.pendingEvents.push(event);

        // DEBUG: Log queuing
        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error('[TELEMETRY DEBUG] Event queued:', {
                type: event.type,
                tool_name: event.tool_name,
                pendingCount: this.pendingEvents.length,
                hasAnalyticsEndpoint: !!this.analyticsEndpoint
            });
        }

        // Send to analytics dashboard only - simplified single endpoint
        if (this.analyticsEndpoint) {
            this.sendToAnalyticsDashboard([event]).catch((err) => {
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY DEBUG] Analytics dashboard send failed:', err.message);
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
    private saveEventsLocally(): void {
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
                console.error('Failed to save telemetry locally:', (error as Error).message);
            }
        }
    }

    /**
     * Send events to analytics dashboard for AI/geo data visualization
     */
    async sendToAnalyticsDashboard(events: TelemetryEvent[]): Promise<void> {
        if (!this.enabled || !this.analyticsEndpoint || events.length === 0) return;

        try {
            // Transform events to match analytics dashboard format
            const transformedEvents = events.map(event => {
                // DXP-34: Debug log raw event structure
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[DXP-34 ANALYTICS] Processing event:', {
                        type: event.type,
                        has_tool_name: !!event.tool_name,
                        tool_name: event.tool_name,
                        event_keys: Object.keys(event)
                    });
                }

                // For tool calls, ensure proper structure
                // DXP-34 FIX: Include tool_usage type!
                if (event.type === 'tool_invocation' || event.type === 'tool_usage' || event.type === 'tool_error' || event.tool_name) {
                    return {
                        type: event.type || 'tool_invocation', // CRITICAL: Include type field for proper categorization
                        tool_name: event.tool_name || (event as any).tool,  // FIX: Use tool_name as expected by analytics
                        timestamp: event.timestamp || new Date().toISOString(),
                        session_id: event.session_id || this.sessionId,
                        duration_ms: event.duration_ms || 0,
                        success: event.event?.success !== false,
                        environment: event.environment,
                        // CRITICAL FIX: Include platform from event or environment
                        platform: event.platform || this.metrics.environment.platform || os.platform(),
                        // DXP-37: Use consistent flat structure for all fields
                        ai_client: event.ai_client || this.metrics.environment.aiClient?.name || 'unknown',
                        ai_client_version: event.ai_client_version || this.metrics.environment.aiClient?.version || '1.0.0',
                        location_region: event.location_region || this.metrics.environment.location?.region || 'unknown',
                        location_timezone: event.location_timezone || this.metrics.environment.location?.timezone || 'unknown',
                        location_country: event.location_country || this.metrics.environment.location?.countryCode || 'unknown'
                    };
                }

                // For session events - these legitimately don't have tool_name
                if (event.type === 'session_start' || event.type === 'session_end') {
                    // DXP-34: Session events don't need tool_name, it's not an error
                    const sessionEvent: any = {
                        type: event.type,
                        timestamp: event.timestamp || new Date().toISOString(),
                        session_id: event.session_id || this.sessionId,
                        // CRITICAL FIX: Include platform from event or nested event structure
                        platform: event.platform || event.event?.platform || this.metrics.environment.platform || os.platform(),
                        // DXP-37: Use consistent flat structure for session events too
                        ai_client: event.ai_client || this.metrics.environment.aiClient?.name || 'unknown',
                        ai_client_version: event.ai_client_version || this.metrics.environment.aiClient?.version || '1.0.0',
                        location_region: event.location_region || this.metrics.environment.location?.region || 'unknown',
                        location_timezone: event.location_timezone || this.metrics.environment.location?.timezone || 'unknown',
                        location_country: event.location_country || this.metrics.environment.location?.countryCode || 'unknown'
                    };

                    // Only add duration if present (session_end has it, session_start doesn't)
                    if (event.duration !== undefined) {
                        sessionEvent.duration = event.duration;
                    }

                    // DXP-37: Removed nested location object - using flat fields instead

                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.error('[DXP-34 SESSION] Created session event:', sessionEvent);
                    }

                    return sessionEvent;
                }

                // Default pass-through
                return event;
            });

            // DXP-34: Validate all events have required fields before sending
            const validatedEvents = transformedEvents.map(event => {
                // Ensure critical fields are present
                if (!event.type) {
                    console.error('[DXP-34 WARNING] Event missing type field:', event);
                    event.type = 'unknown';
                }
                if (!event.timestamp) {
                    event.timestamp = new Date().toISOString();
                }
                if (!event.session_id) {
                    event.session_id = this.sessionId;
                }
                if (!event.platform) {
                    event.platform = this.metrics.environment.platform || os.platform();
                }
                return event;
            });

            // Send to analytics dashboard
            const data = JSON.stringify(validatedEvents);

            // DEBUG: Log what we're sending
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY DEBUG] Sending to analytics dashboard:', {
                    endpoint: this.analyticsEndpoint,
                    dataLength: data.length,
                    data: data.substring(0, 500) // First 500 chars
                });
            }

            const parsedUrl = new URL(this.analyticsEndpoint);
            const options: RequestOptions = {
                method: 'POST',
                hostname: parsedUrl.hostname,
                port: parsedUrl.port ? parseInt(parsedUrl.port) : 443,
                path: parsedUrl.pathname,
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    'User-Agent': `jaxon-optimizely-dxp-mcp/${this.getPackageVersion()}`
                },
                timeout: 5000
            };

            return new Promise((resolve) => {
                const req = https.request(options, (res) => {
                    let responseData = '';
                    res.on('data', chunk => responseData += chunk);
                    res.on('end', () => {
                        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                            console.error('[TELEMETRY DEBUG] Analytics dashboard response:', {
                                statusCode: res.statusCode,
                                endpoint: this.analyticsEndpoint,
                                responseBody: responseData || '(empty)'
                            });

                            // DXP-34: Log detailed error info for 500 errors
                            if (res.statusCode && res.statusCode >= 400) {
                                console.error('[DXP-34 ERROR] Analytics dashboard rejected events:', {
                                    statusCode: res.statusCode,
                                    responseBody: responseData,
                                    eventCount: transformedEvents.length,
                                    eventTypes: transformedEvents.map(e => e.type),
                                    firstEvent: transformedEvents[0]
                                });
                            }
                        }
                        resolve();
                    });
                });

                req.on('error', (err) => {
                    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                        console.error('[TELEMETRY DEBUG] Analytics dashboard error:', err.message);
                    }
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
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY ERROR] Failed to send to analytics dashboard:', (error as Error).message);
            }
        }
    }

    /**
     * Send all pending events to analytics dashboard only
     */
    async sendPendingEvents(): Promise<void> {
        if (!this.enabled || !this.analyticsEndpoint || this.pendingEvents.length === 0) return;

        // Send in batches of 50
        const batchSize = 50;
        while (this.pendingEvents.length > 0) {
            const batch = this.pendingEvents.slice(0, batchSize);
            await this.sendToAnalyticsDashboard(batch);

            // Remove sent events from pending (analytics dashboard doesn't maintain pending state like legacy did)
            this.pendingEvents = this.pendingEvents.slice(batchSize);
        }
    }

    /**
     * Force flush events (for MCP sessions)
     * This ensures events are sent even in short-lived processes
     */
    async flush(): Promise<void> {
        if (!this.enabled) return;

        try {
            // DEBUG: Log flush start
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY DEBUG] Flush called:', {
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
                        console.error('[TELEMETRY DEBUG] Sending session summary from flush');
                    }
                    // Send to analytics dashboard only
                    await this.sendToAnalyticsDashboard([summary]);
                }
            }

            // DEBUG: Log flush complete
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY DEBUG] Flush complete:', {
                    remainingEvents: this.pendingEvents.length
                });
            }
        } catch (error) {
            // Silently fail but save events locally
            this.saveEventsLocally();
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY ERROR] Flush failed:', (error as Error).message);
            }
        }
    }

    /**
     * Get session summary (only once per session to prevent infinite loops)
     */
    private getSessionSummary(): TelemetryEvent | null {
        if (!this.enabled) return null;

        // Prevent duplicate session_end events
        if (this.sessionEndSent) {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY DEBUG] Session summary already sent, skipping');
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
            platform: os.platform(), // DXP-38: Add missing platform field
            duration,
            // DXP-37: Use flat structure for ai_client and location fields
            ai_client: this.metrics.environment.aiClient?.name || 'unknown',
            ai_client_version: this.metrics.environment.aiClient?.version || '1.0.0',
            location_region: this.metrics.environment.location?.region || 'unknown',
            location_timezone: this.metrics.environment.location?.timezone || 'unknown',
            location_country: this.metrics.environment.location?.countryCode || 'unknown',
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
    private getTopTools(limit: number = 5): any[] {
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
    async shutdown(): Promise<void> {
        if (!this.enabled || this.shuttingDown) return;

        this.shuttingDown = true; // Prevent duplicate shutdowns

        // DXP-40: Stop health monitoring
        if (this.health) {
            this.health.stopMonitoring();
        }

        try {
            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY DEBUG] Shutdown initiated');
            }

            // Send session summary if not already sent
            const summary = this.getSessionSummary();
            if (summary) {
                if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                    console.error('[TELEMETRY DEBUG] Sending final session summary');
                }
                // Send to analytics dashboard only
                await this.sendToAnalyticsDashboard([summary]);
            }

            // Send any remaining pending events
            await this.sendPendingEvents();

            if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
                console.error('[TELEMETRY DEBUG] Shutdown completed');
            }
        } catch (error) {
            // Silently fail
            if (process.env.DEBUG) {
                console.error('Telemetry shutdown failed:', (error as Error).message);
            }
        }
    }

    /**
     * DXP-40: Get telemetry health status
     */
    getHealthStatus(): any {
        if (!this.health) return null;
        return this.health.getHealthStatus();
    }

    /**
     * DXP-40: Get telemetry health summary
     */
    getHealthSummary(): any {
        if (!this.health) return null;
        return this.health.getHealthSummary();
    }

    /**
     * DXP-40: Force a health check
     */
    async forceHealthCheck(): Promise<any> {
        if (!this.health) return null;
        return await this.health.forceHealthCheck();
    }

    /**
     * Get privacy-safe analytics report
     */
    getAnalyticsReport(): any {
        if (!this.enabled) return null;

        return {
            enabled: true,
            sessionId: this.sessionId,
            uptime: Date.now() - this.metrics.sessionStart,
            // Include AI client and location information
            aiClient: this.metrics.environment.aiClient,
            location: this.metrics.environment.location,
            tools: {
                count: Object.keys(this.metrics.toolUsage).length,
                totalUsage: Object.values(this.metrics.toolUsage).reduce((sum, t) => sum + t.count, 0),
                top: this.getTopTools(3)
            },
            errors: {
                count: this.metrics.errors.length,
                categories: this.metrics.errors.reduce((acc: any, err) => {
                    acc[err.error.category] = (acc[err.error.category] || 0) + 1;
                    return acc;
                }, {})
            },
            performance: Object.entries(this.metrics.performance).reduce((acc: any, [op, data]) => {
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
let telemetryInstance: Telemetry | null = null;

/**
 * Get or create telemetry instance
 */
function getTelemetry(): Telemetry {
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

export { Telemetry, getTelemetry };
