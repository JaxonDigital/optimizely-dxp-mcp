#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server
 * Built with official @modelcontextprotocol for full Claude compatibility
 *
 * Built by Jaxon Digital - Optimizely Gold Partner
 * https://www.jaxondigital.com
 */

// Telemetry is enabled by default (opt-out model)
// Users can disable by setting OPTIMIZELY_MCP_TELEMETRY=false in their environment

/**
 * Event Bus Configuration (DXP-136 Phase 3)
 *
 * The server supports pluggable event bus implementations:
 *
 * 1. In-Memory (Default):
 *    - No configuration required
 *    - Events only available within this process
 *    - 24-hour event history in RAM
 *
 * 2. Redis Pub/Sub (Enterprise):
 *    - Set EVENT_BUS_TYPE=redis
 *    - Set REDIS_URL=redis://localhost:6379 (or your Redis URL)
 *    - Events published to Redis for multi-subscriber consumption
 *    - Enables enterprise monitoring integrations (DataDog, Splunk, etc.)
 *    - Auto-fallback to in-memory if Redis unavailable
 *
 * Environment Variables:
 *   EVENT_BUS_TYPE     - 'memory' (default) or 'redis'
 *   REDIS_URL          - Redis connection URL (required if EVENT_BUS_TYPE=redis)
 *   EVENT_BUS_FALLBACK - Set to 'false' to disable auto-fallback to in-memory
 *
 * Example Redis Configuration:
 *   export EVENT_BUS_TYPE=redis
 *   export REDIS_URL=redis://localhost:6379
 *   jaxon-optimizely-dxp-mcp
 */

// Load required modules first
import fs from 'fs';
import path from 'path';

// DO NOT OUTPUT ANYTHING AT MODULE LOAD TIME!
// All logging must happen AFTER MCP connection is established

// Load environment variables from .env file if it exists (silently)
// Try multiple locations for .env file
const envPaths = [
  path.join(process.cwd(), '.env'),           // Current working directory
  path.join(__dirname, '..', '.env'),         // Parent of dist/ directory
  path.join(__dirname, '.env'),                // Same directory as script
  path.join(process.cwd(), '.env.local'),     // Local override file
  path.join(process.cwd(), '.env.oca')        // OCA-specific file
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    // Silent loading - no console output before connection!
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          // Don't override existing environment variables
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      }
    });
    break; // Only load the first .env file found
  }
}

// FALLBACK: Load from local config file if exists
if (!process.env.OCA) {
  const localConfigPath = path.join(process.cwd(), '.mcp-env.json');
  if (fs.existsSync(localConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(localConfigPath, 'utf8'));
      Object.keys(config).forEach(key => {
        if (!process.env[key]) {
          process.env[key] = config[key];
        }
      });
    } catch (e) {
      // Silent fail - don't break MCP startup
    }
  }
}

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema,
    SubscribeRequestSchema,
    UnsubscribeRequestSchema,
    ListPromptsRequestSchema,
    GetPromptRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Import existing modules - ES6 imports for esbuild bundling
import Config from '../lib/config';
import ErrorHandler from '../lib/error-handler';
import ResponseBuilder from '../lib/response-builder';
import OutputLogger from '../lib/output-logger';
import {
    DeploymentTools,
    StorageTools,
    ContentTools
} from '../lib/tools';
import ProjectTools from '../lib/tools/project-tools';
import MonitoringTools from '../lib/tools/monitoring-tools';
// DXP-101: ConnectionTestTools removed - functionality replaced by REST API in PermissionChecker
import PermissionChecker from '../lib/tools/permission-checker';
import SimpleTools from '../lib/tools/simple-tools';
import DatabaseSimpleTools from '../lib/tools/database-simple-tools';
import BlobDownloadTools from '../lib/tools/blob-download-tools';
import LogDownloadTools from '../lib/tools/log-download-tools';
import DownloadManagementTools from '../lib/tools/download-management-tools';
import ProjectSwitchTool from '../lib/tools/project-switch-tool';
import LogAnalysisTools from '../lib/tools/log-analysis-tools';
import VersionChecker from '../lib/version-check';
import AIGuidanceTools from '../lib/tools/ai-guidance-tools';
import DatabaseExportPrompts from '../lib/prompts/database-export-prompts';
import DeploymentWorkflowPrompts from '../lib/prompts/deployment-workflow-prompts';
import AutonomousDeploymentPrompts from '../lib/prompts/autonomous-deployment-prompts';
import DownloadPrompts from '../lib/prompts/download-prompts';
import { getTelemetry } from '../lib/telemetry';

// DXP-136: Import event system for MCP Resources
import { getGlobalResourceManager } from '../lib/events/resource-manager';
import { initializeNotificationSender } from '../lib/events/notification-sender';
import DeploymentResourceHandler from '../lib/resources/deployment-resource';
import ExportResourceHandler from '../lib/resources/export-resource';
import DownloadResourceHandler from '../lib/resources/download-resource';

// DXP-140: Import webhook system for Phase 2
import { getGlobalWebhookManager } from '../lib/webhooks/webhook-manager';

// DXP-124-3: Import audit logger for tool invocation tracking
import { AuditLogger } from '../lib/audit-logger';

// Hosting type detection and tool filtering (DXP-23)
import HostingDetector from '../lib/utils/hosting-detector';
import ToolAvailabilityMatrix from '../lib/utils/tool-availability-matrix';

// Additional tool imports
import DXPRestClient from '../lib/dxp-rest-client';
import LogDiscoveryTools from '../lib/tools/log-discovery-tools';
import DownloadConfigTools from '../lib/tools/download-config-tools';
import RateLimiter from '../lib/rate-limiter';

// Import package.json for version info
const packageJson = require('../package.json');

// DXP-124-3: Initialize audit logger singleton
const auditLogger = new AuditLogger({
    auditDir: process.env.DXP_AUDIT_DIR || './audit-logs',
    version: packageJson.version,
    enabled: process.env.DXP_AUDIT_ENABLED !== 'false' // Default: enabled, can disable with DXP_AUDIT_ENABLED=false
});

// Import express for HTTP mode
import express from 'express';

// Initialize telemetry
const telemetry = getTelemetry();

// Check for updates on startup (async, non-blocking) - Only for npm installations
// Detect if we're running from npm global install vs local development
const isLocalDevelopment = () => {
    // Check if we're running from a development directory (has .git, node_modules, etc.)
    const rootDir = path.join(__dirname, '..'); // Check root directory, not dist
    
    // If we have a .git folder or package.json with devDependencies, we're in development
    const hasGit = fs.existsSync(path.join(rootDir, '.git'));
    const hasPackageJson = fs.existsSync(path.join(rootDir, 'package.json'));
    
    if (hasPackageJson) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            const hasDevDeps = pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0;
            return hasGit || hasDevDeps;
        } catch (e) {
            return hasGit;
        }
    }
    
    return hasGit;
};

// Version check moved to after connection is established
// Store the result to check later
const shouldCheckVersion = !isLocalDevelopment();

// Helper function to normalize environment names
function normalizeEnvironmentName(env: any) {
    if (!env) return env;
    
    const envUpper = env.toUpperCase();
    
    // Map common abbreviations to full names
    const abbreviations: { [key: string]: string } = {
        'INT': 'Integration',
        'INTE': 'Integration',
        'INTEGRATION': 'Integration',
        'PREP': 'Preproduction',
        'PRE': 'Preproduction',
        'PREPRODUCTION': 'Preproduction',
        'PROD': 'Production',
        'PRODUCTION': 'Production'
    };

    return abbreviations[envUpper] || env;
}

// Custom Zod transformer for environment names
const environmentSchema = z.string().transform(normalizeEnvironmentName).pipe(
    z.enum(['Integration', 'Preproduction', 'Production'])
);

// Define Zod schemas for each tool
const schemas = {
    
    // Simple Commands - Dead Simple with Smart Defaults
    
    status: z.object({
        project: z.string().optional().describe('Project name (uses default if not specified)'),
        environment: z.string().optional().describe('Filter to specific environment')
    }),
    
    quick: z.object({
        project: z.string().optional().describe('Project name (uses default if not specified)')
    }),
    
    // Database export operations - Natural language for database exports
    // Database export operations - Consolidated tools (DXP-81)
    db_export: z.object({
        environment: z.string().optional().describe('Environment to export from: prod/production, staging/preproduction, int/integration (default: auto-select based on permissions)'),
        database: z.string().optional().default('epicms').describe('Database name: epicms or epicommerce (default: epicms)'),
        previewOnly: z.boolean().optional().describe('Preview export without executing - shows what would happen, includes capability check'),
        forceNew: z.boolean().optional().describe('Force new export - skip existing local backup check'),
        useExisting: z.boolean().optional().describe('Use existing local backup if available (returns immediately)'),
        autoDownload: z.boolean().optional().describe('Automatically download export when complete'),
        monitor: z.boolean().optional().default(false).describe('Automatically monitor export progress until complete (polls every 30s)'),
        downloadPath: z.string().optional().describe('Directory to save downloaded export (default: configured download path)'),
        background: z.boolean().optional().default(true).describe('Download in background vs wait for completion (default: true)'),
        skipConfirmation: z.boolean().optional().describe('Skip download confirmation prompts'),
        retentionHours: z.number().int().positive().optional().default(168).describe('How long Azure retains export in hours (default: 168 = 7 days)'),
        project: z.string().optional().describe('Project name (default: current project from environment)'),
        // Legacy parameters for compatibility
        projectName: z.string().optional().describe('Alternative to project parameter'),
        databaseName: z.string().optional().describe('Legacy: use database parameter instead'),
        projectId: z.string().optional().describe('Project UUID (if providing inline credentials)'),
        apiKey: z.string().optional().describe('API key (if providing inline credentials)'),
        apiSecret: z.string().optional().describe('API secret (if providing inline credentials)')
    }),

    db_export_status: z.object({
        exportId: z.string().optional().describe('Export ID to check status for (from db_export response)'),
        environment: z.string().optional().describe('Environment where export was created: Production, Preproduction, Integration (required if exportId provided)'),
        latest: z.boolean().optional().describe('Check status of latest/most recent export instead of specific exportId'),
        monitor: z.boolean().optional().describe('Enable continuous monitoring - polls every 30s until export completes'),
        waitBeforeCheck: z.number().int().min(60).max(180).optional().describe('Wait N seconds before checking status (60-180s). Tool waits synchronously.'),
        autoDownload: z.boolean().optional().describe('Automatically download export if status is complete'),
        downloadPath: z.string().optional().describe('Directory to save downloaded export'),
        background: z.boolean().optional().default(true).describe('Download in background vs wait for completion (default: true)'),
        skipConfirmation: z.boolean().optional().describe('Skip download confirmation prompts'),
        limit: z.number().min(1).max(100).optional().default(10).describe('Max results to return when listing exports (1-100)'),
        offset: z.number().min(0).optional().default(0).describe('Pagination offset when listing exports'),
        status: z.enum(['InProgress', 'Succeeded', 'Failed']).optional().describe('Filter by export status when listing'),
        format: z.enum(['concise', 'detailed']).optional().default('detailed').describe('Response format: concise (minimal fields) or detailed (all fields)'),
        project: z.string().optional().describe('Project name (default: current project)'),
        // Legacy parameters
        projectName: z.string().optional().describe('Alternative to project parameter'),
        projectId: z.string().optional().describe('Project UUID (if providing inline credentials)'),
        apiKey: z.string().optional().describe('API key (if providing inline credentials)'),
        apiSecret: z.string().optional().describe('API secret (if providing inline credentials)')
    }),

    check_download_status: z.object({
        downloadId: z.string().describe('Download ID to check (returned from background download operations)'),
        waitBeforeCheck: z.number().int().min(10).max(120).optional().describe('Wait N seconds before checking status (10-120s). Tool waits synchronously.'),
        monitor: z.boolean().optional().describe('Enable monitoring mode - adds instructions to keep checking if still downloading')
    }),

    db_export_download: z.object({
        exportId: z.string().optional().describe('Export ID to download (not required if downloadUrl provided)'),
        environment: z.string().optional().describe('Environment where export was created (not required if downloadUrl provided)'),
        downloadUrl: z.string().optional().describe('Direct SAS URL to download from (skips API authentication - useful for downloaded URLs from db_export_status)'),
        downloadPath: z.string().optional().describe('Directory to save downloaded export'),
        background: z.boolean().optional().default(true).describe('Download in background vs wait for completion (default: true)'),
        skipConfirmation: z.boolean().optional().describe('Skip file overwrite confirmation prompts'),
        monitor: z.boolean().optional().describe('Enable download monitoring - instructs AI to poll check_download_status until complete'),
        project: z.string().optional().describe('Project name (default: current project)'),
        // Legacy parameters
        projectName: z.string().optional().describe('Alternative to project parameter'),
        projectId: z.string().optional().describe('Project UUID (if providing inline credentials)'),
        apiKey: z.string().optional().describe('API key (if providing inline credentials)'),
        apiSecret: z.string().optional().describe('API secret (if providing inline credentials)')
    }),

    test_export_query: z.object({
        environment: z.string().optional().describe('Environment to test (default: Production)')
    }),

    // REMOVED: check_export_status - renamed to db_export_status
    // REMOVED: export_database - renamed to db_export
    // REMOVED: download_database_export - renamed to db_export_download
    // REMOVED: list_exports - tool relies on broken queryPaaSExports (DXP-49)
    // REMOVED: check_download_capabilities - embedded in db_export preview mode (DXP-81)
    
    
    // Blob download tools
    download_blobs: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional().default('Production'),
        containerName: z.string().optional().describe('Storage container name (auto-detected if not specified)'),
        downloadPath: z.string().optional().describe('Where to save files (auto-detected based on project)'),
        previewOnly: z.boolean().optional().describe('Show download preview without actually downloading'),
        filter: z.string().optional().describe('Filter for specific files: exact name ("logo.png"), glob pattern ("*.pdf", "2024/*.jpg"), or substring ("report")'),
        incremental: z.boolean().optional().describe('Use smart incremental download (skip unchanged files). Default: true'),
        forceFullDownload: z.boolean().optional().describe('Force full download even if files exist locally. Default: false'),
        skipConfirmation: z.boolean().optional().default(false).describe('Skip confirmation preview (WARNING: downloads immediately without preview). Default: false - always show preview'),
        monitor: z.boolean().optional().default(false).describe('DXP-3: Enable real-time progress monitoring during download. Shows progress updates every 10 seconds or 50 files. Default: false (opt-in)'),
        background: z.boolean().optional().default(false).describe('DXP-3: Start download in background and return immediately with downloadId. Use download_status({ downloadId, monitor: true }) to watch progress. Default: false (blocking download)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    // Log download tools
    download_logs: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional().default('Production'),
        logType: z.enum(['application', 'web', 'cloudflare', 'all']).optional(),
        containerName: z.string().optional().describe('Override default container name'),
        slot: z.boolean().optional().default(false).describe('Download deployment slot logs instead of production logs. Default: false (production logs only). Set to true to get logs from /SLOTS/SLOT/ path (deployment slot logs during warmup)'),
        dateFilter: z.string().optional().describe('Filter logs by date (e.g., "2025/08/24" or "2025/08")'),
        // Time-based filtering (⭐ EASIEST - recommended for most use cases)
        secondsBack: z.number().optional().describe('⭐ EASIEST: Last N seconds. No date math needed! (e.g., 30)'),
        minutesBack: z.number().optional().describe('⭐ EASIEST: Last N minutes. No date math needed! (e.g., 15)'),
        hoursBack: z.number().optional().describe('⭐ EASIEST: Last N hours. No date math needed! (e.g., 6)'),
        daysBack: z.number().optional().describe('⭐ EASIEST: Last N days. No date math needed! (e.g., 7 for last week)'),
        weeksBack: z.number().optional().describe('⭐ EASIEST: Last N weeks. No date math needed! (e.g., 2)'),
        monthsBack: z.number().optional().describe('⭐ EASIEST: Last N months. No date math needed! (e.g., 3)'),
        yearsBack: z.number().optional().describe('⭐ EASIEST: Last N years. No date math needed! (e.g., 1)'),
        // Date range filtering (medium complexity - smart defaults)
        startDate: z.string().optional().describe('Start date (e.g., "2025/10/01"). Can use alone - endDate defaults to NOW. Format: "YYYY/MM/DD" or "YYYY-MM-DD"'),
        endDate: z.string().optional().describe('End date (e.g., "2025/10/08"). Can use alone - startDate defaults to 7 days before. Format: "YYYY/MM/DD" or "YYYY-MM-DD"'),
        // DXP-20/DXP-88: ISO 8601 datetime support (advanced - for precise time windows with smart defaults)
        startDateTime: z.string().optional().describe('⚠️ ADVANCED: ISO 8601 start datetime. Can use alone - endDateTime defaults to NOW. For simpler filtering, use daysBack/hoursBack instead. (e.g., "2025-09-15T01:00:00-05:00")'),
        endDateTime: z.string().optional().describe('⚠️ ADVANCED: ISO 8601 end datetime. Can use alone - startDateTime defaults to 7 days before. For simpler filtering, use daysBack/hoursBack instead. (e.g., "2025-09-15T01:30:00-05:00")'),
        downloadPath: z.string().optional().describe('Where to save log files'),
        previewOnly: z.boolean().optional().describe('Show download preview without actually downloading'),
        skipConfirmation: z.boolean().optional().default(false).describe('Skip confirmation preview (WARNING: downloads immediately without preview). Default: false - always show preview'),
        incremental: z.boolean().optional().describe('Use smart incremental download (skip unchanged files). Default: true'),
        forceFullDownload: z.boolean().optional().describe('Force full download even if files exist locally. Default: false'),
        monitor: z.boolean().optional().default(false).describe('DXP-3: Enable real-time progress monitoring during download. Shows progress updates every 10 seconds or 50 files. Default: false (opt-in)'),
        background: z.boolean().optional().default(false).describe('DXP-3: Start download in background and return immediately with downloadId. Use download_status({ downloadId, monitor: true }) to watch progress. Default: false (blocking download)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    // DXP-110: Streaming log analysis (2x faster than download + analyze)
    analyze_logs_streaming: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional().default('Production').describe('Environment to analyze. Default: Production'),
        logType: z.enum(['application', 'web', 'all']).optional().default('web').describe('Log type: "application" for console logs, "web" for HTTP logs, "all" for both (DXP-114). Default: web'),
        minutesBack: z.number().optional().default(60).describe('Analyze logs from last N minutes. Default: 60 (1 hour)'),
        startDateTime: z.string().optional().describe('ISO 8601 start datetime (alternative to minutesBack)'),
        endDateTime: z.string().optional().describe('ISO 8601 end datetime (alternative to minutesBack)'),
        slot: z.boolean().optional().default(false).describe('Analyze deployment slot logs instead of production logs. Default: false (production logs only, excluding /SLOTS/ paths). Set to true for slot logs during warmup (DXP-116)'),
        structuredContent: z.boolean().optional().default(true).describe('Return guaranteed structured JSON (recommended for automation). All fields always present with null/0/[] for missing data. Default: true'),
        debug: z.boolean().optional().default(false).describe('Include debug information in response (container selection, blob dates, pagination details). Useful for troubleshooting. Default: false (DXP-118)'),
        timeoutSeconds: z.number().optional().describe('Maximum time in seconds to wait for analysis. Default: 300s (5 min) for <3 days, 600s (10 min) for larger ranges. Increase for very large time ranges (7+ days). (DXP-188)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    // DXP-112: Compare baseline vs slot logs for deployment decisions
    compare_logs: z.object({
        baseline: z.object({
            summary: z.object({
                totalLogs: z.number(),
                healthScore: z.number(),
                healthy: z.boolean()
            }),
            errors: z.object({
                total: z.number(),
                byStatusCode: z.record(z.number()).optional()
            }),
            performance: z.object({
                avgResponseTime: z.number().nullable(),
                p95ResponseTime: z.number().nullable(),
                p99ResponseTime: z.number().nullable()
            })
        }).describe('Baseline log analysis (from analyze_logs_streaming)'),
        slot: z.object({
            summary: z.object({
                totalLogs: z.number(),
                healthScore: z.number(),
                healthy: z.boolean()
            }),
            errors: z.object({
                total: z.number(),
                byStatusCode: z.record(z.number()).optional()
            }),
            performance: z.object({
                avgResponseTime: z.number().nullable(),
                p95ResponseTime: z.number().nullable(),
                p99ResponseTime: z.number().nullable()
            })
        }).describe('Slot log analysis (from analyze_logs_streaming)'),
        thresholds: z.object({
            maxErrorIncrease: z.number().optional().default(0.5).describe('Max error rate increase as decimal (0.5 = 50%). Default: 0.5'),
            maxScoreDecrease: z.number().optional().default(20).describe('Max health score decrease in points. Default: 20'),
            maxLatencyIncrease: z.number().optional().default(100).describe('Max P95 latency increase in milliseconds. Default: 100')
        }).optional().describe('Threshold overrides. Defaults: 50% error increase, 20 point score drop, 100ms latency increase')
    }),

    // Log discovery tool
    discover_logs: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Container debug tool
    debug_containers: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Download management tools (DXP-82)
    download_list: z.object({
        status: z.enum(['active', 'completed', 'failed', 'all'])
            .optional()
            .default('active')
            .describe('Filter by status: active (running), completed (successful), failed (errors/cancelled), or all'),
        type: z.enum(['logs', 'database', 'all'])
            .optional()
            .default('all')
            .describe('Filter by download type'),
        limit: z.number()
            .int()
            .positive()
            .optional()
            .default(10)
            .describe('Max results for history queries (1-100)'),
        offset: z.number()
            .int()
            .min(0)
            .optional()
            .default(0)
            .describe('Pagination offset for history')
    }),

    download_status: z.object({
        downloadId: z.string()
            .describe('Download ID to check (from download_list)'),
        monitor: z.boolean().optional().default(false)
            .describe('DXP-3: Auto-monitor download - polls every 10s and shows live progress updates until complete. Returns combined progress report. Default: false (single status check)')
    }),

    download_cancel: z.object({
        downloadId: z.string()
            .optional()
            .describe('Download ID to cancel. Omit to cancel all active downloads')
    }),
    
    // Download configuration
    show_download_config: z.object({
        projectName: z.string().optional().describe('Show config for specific project')
    }),
    
    
    // Project switching
    switch_project: z.object({
        projectName: z.string().describe('Name of the project to switch to')
    }),

    // Connection testing
    test_connection: z.object({
        projectId: z.string().optional(),
        projectName: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        setupMode: z.boolean().optional(),  // Run in setup wizard mode
        autoFix: z.boolean().optional(),     // Auto-install missing dependencies
        skipChecks: z.boolean().optional()   // Skip certain checks
    }),

    health_check: z.object({
        projectId: z.string().optional(),
        projectName: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        debug: z.boolean().optional().describe('Include debug information (process ID, session ID, etc.)')
    }),
    
    // Version information
    get_version: z.object({}),

    
    // AI guidance and best practices
    get_ai_guidance: z.object({
        topic: z.string().optional().describe('Specific topic to get guidance on (e.g., "confirmation", "downloads", "errors", "parameters")')
    }),

    // Permission checking
    // check_permissions removed - merged into test_connection
    
    // New permission checking tool that avoids cached module issue
    verify_access: z.object({
        projectId: z.string().optional(),
        projectName: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        forceRefresh: z.boolean().optional().describe('Force re-check even if cached')
    }),
    
    // Project management
    get_project: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional()
    }),

    update_project: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        // Rename
        renameTo: z.string().optional(),
        // Credentials
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        connectionString: z.string().optional(),
        // Paths
        blobPath: z.string().optional(),
        dbPath: z.string().optional(),
        logPath: z.string().optional(),
        // Settings
        makeDefault: z.boolean().optional().describe('Set this project as default for getCurrentProject() - auto-enabled when providing inline credentials')
    }),

    list_projects: z.object({
        limit: z.number().min(1).max(100).optional().default(20).describe('Max results to return (1-100)'),
        offset: z.number().min(0).optional().default(0).describe('Pagination offset')
    }),

    current_project: z.object({}),

    get_support: z.object({}),
    
    list_monitors: z.object({}),
    
    update_monitoring_interval: z.object({
        deploymentId: z.string().optional(),
        interval: z.number().min(10).max(600)
    }),
    
    stop_monitoring: z.object({
        deploymentId: z.string().optional(),
        all: z.boolean().optional()
    }),
    
    get_monitoring_stats: z.object({}),
    
    
    disable_telemetry: z.object({}),
    
    enable_telemetry: z.object({}),
    
    get_rate_limit_status: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional()
    }),
    
    get_cache_status: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        action: z.enum(['status', 'clear']).optional().default('status')
    }),
    
    // Database operations section removed - all tools are now defined above with proper schemas
    
    // Deployment operations
    list_deployments: z.object({
        limit: z.number().min(1).max(100).optional().default(20),
        offset: z.number().min(0).optional(),
        activeOnly: z.boolean().optional().default(false).describe('Filter to only active deployments (InProgress, AwaitingVerification, Resetting, Completing). Useful for autonomous agents detecting deployment conflicts.'),
        status: z.enum(['InProgress', 'AwaitingVerification', 'Success', 'Failed', 'Canceled', 'Resetting', 'Completing']).optional().describe('Filter by specific deployment status'),
        environmentSlot: z.enum(['Integration', 'Preproduction', 'Production']).optional().describe('Filter by environment slot'),
        format: z.enum(['concise', 'detailed']).optional().default('detailed').describe('Response format: concise (minimal fields for token efficiency) or detailed (all fields)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    start_deployment: z.object({
        sourceEnvironment: environmentSchema,
        targetEnvironment: environmentSchema,
        deploymentType: z.enum(['code', 'content', 'all']).optional(),
        sourceApps: z.array(z.string()).optional(),
        includeBlob: z.boolean().optional(),
        includeDatabase: z.boolean().optional(),
        directDeploy: z.boolean().optional().default(false),
        useMaintenancePage: z.boolean().optional().default(false),
        webhookUrl: z.string().optional().describe('HTTP endpoint to receive deployment events (HTTPS required in production)'),
        webhookHeaders: z.record(z.string()).optional().describe('Custom headers to include in webhook requests (e.g., { "Authorization": "Bearer token" })'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    get_deployment_status: z.object({
        deploymentId: z.string(),
        waitBeforeCheck: z.number().optional().describe('Seconds to wait before checking status (default: 0)'),
        monitor: z.boolean().optional().describe('Enable monitoring mode with AI guidance (default: false)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    monitor_deployment: z.object({
        deploymentId: z.string().describe('Deployment ID to monitor continuously'),
        interval: z.number().optional().describe('Check interval in seconds (default: 30)'),
        maxDuration: z.number().optional().describe('Maximum monitoring duration in minutes (default: 30)'),
        autoComplete: z.boolean().optional().describe('Auto-complete when verification reached (default: false)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    complete_deployment: z.object({
        deploymentId: z.string(),
        monitor: z.boolean().optional().default(true),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    reset_deployment: z.object({
        deploymentId: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Storage operations
    list_storage_containers: z.object({
        environment: environmentSchema,
        limit: z.number().min(1).max(100).optional().default(20).describe('Max results to return (1-100)'),
        offset: z.number().min(0).optional().default(0).describe('Pagination offset'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    generate_storage_sas_link: z.object({
        environment: environmentSchema,
        containerName: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        permissions: z.enum(['Read', 'Write', 'Delete', 'List']).optional().default('Read'),
        expiryHours: z.number().optional().default(24),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Package operations
    

    
    
    // Content operations
    copy_content: z.object({
        sourceEnvironment: environmentSchema,
        targetEnvironment: environmentSchema,
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    // Deployment helper operations

    // Audit operations
    query_audit_log: z.object({
        start_time: z.string().optional().describe('Start time (ISO 8601), e.g., 2025-11-09T00:00:00Z'),
        end_time: z.string().optional().describe('End time (ISO 8601)'),
        tool_name: z.string().optional().describe('Filter by tool name (e.g., "start_deployment")'),
        status: z.enum(['success', 'failure']).optional().describe('Filter by operation status'),
        limit: z.number().int().positive().optional().default(100).describe('Max entries to return (default: 100)'),
        offset: z.number().int().min(0).optional().default(0).describe('Offset for pagination (default: 0)')
    }),

};

// Special handler for project info - now delegated to ProjectTools

/**
 * Handle analytics request
 */
function handleDisableTelemetry(_args: any) {
    try {
        // Disable telemetry for this session
        (telemetry as any).enabled = false;
        
        // Also set environment variable for future sessions in this process
        process.env.OPTIMIZELY_MCP_TELEMETRY = 'false';
        
        return {
            result: {
                content: [{
                    type: 'text',
                    text: `🔒 **Telemetry Disabled**\n\n` +
                          `✅ Anonymous telemetry has been disabled for this session.\n\n` +
                          `**What this means:**\n` +
                          `• No usage data will be collected\n` +
                          `• No performance metrics will be tracked\n` +
                          `• No error reports will be sent\n\n` +
                          `**To make this permanent across all sessions:**\n\n` +
                          `**Option 1:** Add to your Claude Desktop config:\n` +
                          `\`"OPTIMIZELY_MCP_TELEMETRY": "false"\`\n\n` +
                          `**Option 2:** Set environment variable:\n` +
                          `\`export OPTIMIZELY_MCP_TELEMETRY=false\`\n\n` +
                          `**To re-enable:** Use the \`enable_telemetry\` tool.\n\n` +
                          `Thank you for using Jaxon Digital's Optimizely DXP MCP Server! 🚀`
                }]
            }
        };
    } catch (error: any) {
        const errorMessage = ErrorHandler.formatError(error, { tool: 'disable_telemetry' } as any);
        return {
            result: {
                content: [{
                    type: 'text',
                    text: errorMessage
                }]
            }
        };
    }
}

function handleEnableTelemetry(_args: any) {
    try {
        // Enable telemetry for this session
        (telemetry as any).enabled = true;
        
        // Remove the disable flag from environment
        delete process.env.OPTIMIZELY_MCP_TELEMETRY;
        
        return {
            result: {
                content: [{
                    type: 'text',
                    text: `📊 **Telemetry Enabled**\n\n` +
                          `✅ Anonymous telemetry has been re-enabled for this session.\n\n` +
                          `**What we collect (anonymously):**\n` +
                          `• Tool usage patterns (which tools are used most)\n` +
                          `• Performance metrics (operation times)\n` +
                          `• Error categories (no sensitive data)\n\n` +
                          `**Privacy guaranteed:**\n` +
                          `• No personal information\n` +
                          `• No project names or IDs\n` +
                          `• No API keys or secrets\n` +
                          `• No file contents or paths\n\n` +
                          `**To disable again:** Use the \`disable_telemetry\` tool.\n\n` +
                          `Thank you for helping us improve this tool! 🙏`
                }]
            }
        };
    } catch (error: any) {
        const errorMessage = ErrorHandler.formatError(error, { tool: 'enable_telemetry' } as any);
        return {
            result: {
                content: [{
                    type: 'text',
                    text: errorMessage
                }]
            }
        };
    }
}


/**
 * Handle rate limit status request
 */
function handleGetRateLimitStatus(args: any) {
    try {
        // DXP-106/DXP-107: Rate limiter moved to DXPRestClient
        // DXPRestClient already imported at top
        const rateLimiter = DXPRestClient.rateLimiter;
        
        // Get project credentials for the status check
        let projectId = args.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        
        // If project name provided, try to resolve it
        if (args.projectName && !projectId) {
            // ProjectTools already imported at top
            const projectCreds = ProjectTools.getProjectCredentials(args.projectName);
            if (projectCreds) {
                projectId = projectCreds.projectId;
            }
        }
        
        if (!projectId) {
            const defaultCreds = ProjectTools.getProjectCredentials();
            projectId = defaultCreds.projectId;
        }
        
        if (!projectId) {
            return {
                error: `No project ID found. Please provide a projectId parameter or configure environment variables.\n\n📧 Need help? Contact us at support@jaxondigital.com`
            };
        }
        
        const status = rateLimiter.getStatus(projectId);
        const suggestedWait = rateLimiter.getSuggestedWaitTime(projectId);
        
        let statusText = `⚡ **Rate Limit Status**\n\n`;
        statusText += `**Project:** \`${projectId}\`\n\n`;
        
        statusText += `📊 **Usage Quotas**\n`;
        statusText += `• Requests per minute: ${status.requestsLastMinute}/${status.maxRequestsPerMinute}\n`;
        statusText += `• Requests per hour: ${status.requestsLastHour}/${status.maxRequestsPerHour}\n`;
        
        const minutePercent = ((status.requestsLastMinute / (status.maxRequestsPerMinute || 1)) * 100).toFixed(1);
        const hourPercent = ((status.requestsLastHour / (status.maxRequestsPerHour || 1)) * 100).toFixed(1);
        statusText += `• Minute usage: ${minutePercent}%\n`;
        statusText += `• Hour usage: ${hourPercent}%\n\n`;
        
        if (status.isThrottled) {
            const waitTime = Math.ceil(((status.throttleRetryAfter || Date.now()) - Date.now()) / 1000);
            statusText += `🚨 **Currently Throttled**\n`;
            statusText += `• Status: API returned 429 (Too Many Requests)\n`;
            statusText += `• Wait time: ${waitTime} seconds\n`;
            statusText += `• Retry after: ${new Date(status.throttleRetryAfter || Date.now()).toISOString()}\n\n`;
        } else if (status.backoffUntil) {
            const waitTime = Math.ceil((status.backoffUntil - Date.now()) / 1000);
            statusText += `⏳ **Backing Off**\n`;
            statusText += `• Reason: Consecutive failures\n`;
            statusText += `• Wait time: ${waitTime} seconds\n`;
            statusText += `• Retry after: ${new Date(status.backoffUntil).toISOString()}\n\n`;
        } else if (suggestedWait > 0) {
            statusText += `⚠️  **Usage Warning**\n`;
            statusText += `• Status: Approaching rate limits\n`;
            statusText += `• Suggested wait: ${Math.ceil(suggestedWait / 1000)} seconds\n`;
            statusText += `• Recommendation: Space out requests\n\n`;
        } else {
            statusText += `✅ **Status: Good**\n`;
            statusText += `• No rate limiting active\n`;
            statusText += `• Requests can proceed normally\n\n`;
        }
        
        if (status.consecutiveFailures > 0) {
            statusText += `⚠️  **Error History**\n`;
            statusText += `• Consecutive failures: ${status.consecutiveFailures}\n`;
            statusText += `• This triggers exponential backoff\n\n`;
        }
        
        if (status.lastRequest > 0) {
            const lastRequestAge = ((Date.now() - status.lastRequest) / 1000).toFixed(1);
            statusText += `📅 **Last Request**\n`;
            statusText += `• ${lastRequestAge} seconds ago\n`;
            statusText += `• Time: ${new Date(status.lastRequest).toISOString()}\n\n`;
        }
        
        statusText += `🔧 **Rate Limiting Info**\n`;
        statusText += `• Rate limiting helps prevent API abuse\n`;
        statusText += `• Limits are per-project and reset automatically\n`;
        statusText += `• Failed requests don't count against quotas\n`;
        statusText += `• The system uses exponential backoff for failed requests\n\n`;
        
        statusText += `💡 **Tips**\n`;
        statusText += `• Space out requests when approaching limits\n`;
        statusText += `• Use batch operations when possible\n`;
        statusText += `• Check this status if requests are being throttled\n\n`;
        
        statusText += `📧 Need help? Contact us at support@jaxondigital.com`;
        
        return {
            result: {
                content: [{
                    type: 'text',
                    text: statusText
                }]
            }
        };
        
    } catch (error: any) {
        OutputLogger.error('Rate limit status error: ' + error);
        return {
            error: `Failed to get rate limit status: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
        };
    }
}

/**
 * Handle cache status request
 */
function handleGetCacheStatus(_args: any) {
    try {
        // DXP-106/DXP-107: Cache management now integrated within operations, no centralized manager
        return {
            result: {
                content: [{
                    type: 'text',
                    text: `💾 **Cache Status**\n\n` +
                          `⚠️  **Note**: Cache management is now integrated within individual operations (v3.44.0+).\n\n` +
                          `**What Changed**\n` +
                          `• Cache is operation-specific and automatic\n` +
                          `• No manual management required\n` +
                          `• Each operation handles its own caching strategy\n\n` +
                          `**Alternative**\n` +
                          `• Use \`get_rate_limit_status\` to check API request status\n` +
                          `• Individual operations automatically cache when beneficial\n\n` +
                          `📧 Need help? Contact us at support@jaxondigital.com`
                }]
            }
        };

        /* DISABLED - Old centralized cache removed in DXP-101
        const PowerShellHelper = require(path.join(libPath, 'powershell-helper'));
        
        // Get project credentials for the status check
        let projectId = args.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        
        // If project name provided, try to resolve it
        if (args.projectName && !projectId) {
            // ProjectTools already imported at top
            const projectCreds = ProjectTools.getProjectCredentials(args.projectName);
            if (projectCreds) {
                projectId = projectCreds.projectId;
            }
        }
        
        if (!projectId && args.action === 'clear') {
            const defaultCreds = ProjectTools.getProjectCredentials();
            projectId = defaultCreds.projectId;
        }
        
        // Handle clear action
        if (args.action === 'clear') {
            if (!projectId) {
                return {
                    error: `No project ID found for cache clearing. Please provide a projectId parameter.\n\n📧 Need help? Contact us at support@jaxondigital.com`
                };
            }
            
            PowerShellHelper.clearCache(projectId);
            
            return {
                result: {
                    content: [{
                        type: 'text',
                        text: `✅ **Cache Cleared**\n\n` +
                              `**Project:** \`${projectId}\`\n\n` +
                              `All cached entries for this project have been removed.\n\n` +
                              `📧 Need help? Contact us at support@jaxondigital.com`
                    }]
                }
            };
        }
        
        // Get cache statistics
        const stats = PowerShellHelper.getCacheStats();
        
        let statusText = `💾 **Cache Status**\n\n`;
        
        statusText += `📊 **Performance Metrics**\n`;
        statusText += `• Hit Rate: ${stats.hitRate} (${stats.hits} hits, ${stats.misses} misses)\n`;
        statusText += `• Total Entries: ${stats.entries}/${stats.maxEntries || 1000}\n`;
        statusText += `• Cache Size: ${stats.sizeMB} MB / ${stats.maxSizeMB} MB\n`;
        statusText += `• Operations: ${stats.sets} sets, ${stats.deletes} deletes\n\n`;
        
        const efficiency = stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100) : 0;
        
        if (efficiency >= 70) {
            statusText += `✅ **Cache Performance: Excellent**\n`;
            statusText += `• High hit rate indicates good caching efficiency\n`;
            statusText += `• Frequently accessed data is being cached effectively\n\n`;
        } else if (efficiency >= 40) {
            statusText += `⚠️  **Cache Performance: Good**\n`;
            statusText += `• Moderate hit rate - caching is helping performance\n`;
            statusText += `• Consider using operations that benefit from caching more frequently\n\n`;
        } else if (stats.hits + stats.misses > 10) {
            statusText += `🔄 **Cache Performance: Low**\n`;
            statusText += `• Low hit rate - cache may need tuning\n`;
            statusText += `• Operations may not be benefiting from caching\n\n`;
        } else {
            statusText += `📈 **Cache Performance: Starting**\n`;
            statusText += `• Not enough data to determine efficiency\n`;
            statusText += `• Performance will improve with usage\n\n`;
        }
        
        if (stats.entries > 0) {
            statusText += `🔧 **Cache Details**\n`;
            statusText += `• Cached operations include: list_deployments, get_deployment_status, list_storage_containers\n`;
            statusText += `• Cache automatically expires based on data type\n`;
            statusText += `• Write operations automatically invalidate related cache entries\n`;
            statusText += `• Cache is persistent across sessions\n\n`;
        }
        
        statusText += `💡 **How Caching Helps**\n`;
        statusText += `• Reduces API calls to Optimizely DXP\n`;
        statusText += `• Improves response times for repeated operations\n`;
        statusText += `• Respects rate limits by serving cached results\n`;
        statusText += `• Automatically invalidates when data changes\n\n`;
        
        statusText += `🔄 **Cache Management**\n`;
        statusText += `• Use \`get_cache_status\` with \`action: "clear"\` to clear project cache\n`;
        statusText += `• Cache automatically cleans expired entries\n`;
        statusText += `• Size and entry limits prevent unlimited growth\n\n`;
        
        if (projectId) {
            statusText += `**Current Project:** \`${projectId}\`\n\n`;
        }
        
        statusText += `📧 Need help? Contact us at support@jaxondigital.com`;

        return {
            result: {
                content: [{
                    type: 'text',
                    text: statusText
                }]
            }
        };
        */ // End DISABLED

    } catch (error: any) {
        OutputLogger.error('Cache status error: ' + error);
        return {
            error: `Failed to get cache status: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
        };
    }
}

// Project resolution wrapper for tools that require credentials
function withProjectResolution(toolHandler: any) {
    return async (args: any) => {
        // Determine if we need to resolve project credentials
        const projectName = args.projectName || args.project; // Handle both parameter names
        const needsResolution =
            // Missing credentials (original behavior)
            (!args.connectionString && (!args.apiKey || !args.apiSecret || !args.projectId)) ||
            // OR explicit project name specified (DXP-125: allow project switching)
            (projectName !== undefined);

        if (needsResolution) {
            const projects = ProjectTools.getConfiguredProjects();

            if (projects.length === 0) {
                return ResponseBuilder.error('No projects configured. Run "setup_wizard" to configure your first project.');
            }

            let projectConfig = null;

            if (projectName) {
                // Find project by name (exact match, case-insensitive)
                OutputLogger.debug(`Searching for "${projectName}" (case-insensitive)...`);
                projectConfig = projects.find(p => {
                    const matches = p.name && p.name.toLowerCase() === projectName.toLowerCase();
                    OutputLogger.debug(`Comparing "${p.name}" === "${projectName}" -> ${matches}`);
                    return matches;
                });
                if (!projectConfig) {
                    const availableNames = projects.map(p => p.name).filter(Boolean).join(', ') || 'None';
                    return ResponseBuilder.error(`Project "${projectName}" not found. Available projects: ${availableNames}`);
                }
            } else {
                // Use default project if no project specified
                OutputLogger.debug(`No project specified, using default...`);
                projectConfig = projects.find(p => p.isDefault) || projects[0];
                if (!projectConfig) {
                    return ResponseBuilder.error('No default project configured. Please specify a project name.');
                }
            }

            OutputLogger.debug(`Selected project:`, {
                name: projectConfig.name,
                id: projectConfig.projectId || (projectConfig as any).id
            });

            // Add resolved project credentials to args (handling both DXP and self-hosted)
            // DXP-125: ALWAYS override credentials when projectName is explicitly specified
            if (projectConfig.connectionString) {
                // Self-hosted project
                args.connectionString = projectConfig.connectionString;
                args.projectName = projectConfig.name;
                args.isSelfHosted = true;
                args.projectType = 'self-hosted';
            } else if (projectConfig.isSelfHosted) {
                // Handle case where isSelfHosted flag is set but connectionString might be missing
                args.isSelfHosted = true;
                args.projectType = 'self-hosted';
                args.connectionString = projectConfig.connectionString;
                args.projectName = projectConfig.name;
            } else {
                // DXP project
                args.projectId = projectConfig.projectId || (projectConfig as any).id;
                args.apiKey = projectConfig.apiKey;
                args.apiSecret = projectConfig.apiSecret;
                args.projectName = projectConfig.name;
                args.projectType = projectConfig.projectType || 'dxp-paas';
            }
        }

        // IMPORTANT: Preserve the environment from the original request
        // The environment is not stored in project config, it's specified per operation

        return toolHandler(args);
    };
}

// DXP-124-3: Audit logging wrapper for deployment tools
// Wraps tool handlers to automatically log all invocations to audit trail
function withAuditLogging(operation: string, operation_type: string, toolHandler: any) {
    return async (args: any) => {
        // Use AuditLogger.wrapTool for automatic logging with duration tracking
        return await auditLogger.wrapTool(
            operation,
            operation_type,
            args,
            async () => await toolHandler(args),
            {
                user: { id: 'mcp-client' }, // MCP doesn't provide user context
                environment: args.environment ? { name: args.environment } : {},
                metadata: {
                    project_id: args.projectId,
                    project_name: args.projectName
                }
            }
        );
    };
}

// New verify_access handler that avoids cached module issues
async function handleVerifyAccess(args: any) {
    // Use the unified PermissionChecker for most accurate results
    return await PermissionChecker.verifyAccess(args);
}

// check_permissions removed - functionality merged into test_connection

// Handle get_version command
async function handleGetVersion(args: any) {
    try {
        // packageJson already imported at top
        const currentVersion = packageJson.version;
        
        let versionText = `📦 **Jaxon Optimizely DXP MCP Server**\n\n`;
        versionText += `**Current Version**: v${currentVersion}\n`;
        versionText += `**Released**: ${(packageJson as any).publishedAt || 'Unknown'}\n\n`;
        
        // Check for updates (with error handling)
        try {
            // VersionChecker already imported at top
            const updateInfo = await VersionChecker.checkForUpdates();
            
            if (updateInfo && updateInfo.updateAvailable) {
                versionText += `⚠️ **Update Available**: v${updateInfo.latestVersion}\n`;
                versionText += `📅 Released: ${(updateInfo as any).publishedAt || 'Recently'}\n\n`;
                versionText += `**To Update**:\n`;
                versionText += `\`\`\`bash\n`;
                versionText += `npm install -g ${packageJson.name}@latest\n`;
                versionText += `\`\`\`\n\n`;
                versionText += `Then restart Claude Desktop or your MCP client.\n`;
            } else if (updateInfo) {
                versionText += `✅ **You are on the latest version!**\n`;
            } else {
                // updateInfo is null, likely due to network issues
                versionText += `ℹ️ **Update check unavailable** (offline or timeout)\n`;
            }
        } catch (updateError) {
            // If update check fails, just show current version
            OutputLogger.error('Version check error: ' + updateError);
            versionText += `ℹ️ **Update check failed** - showing current version only\n`;
        }
        
        versionText += `\n**System Information**:\n`;
        versionText += `• Node.js: ${process.version}\n`;
        versionText += `• Platform: ${process.platform}\n`;
        versionText += `• Architecture: ${process.arch}\n`;

        // DXP-66: Build structured data for automation tools
        const structuredData = {
            currentVersion: currentVersion,
            packageName: packageJson.name,
            updateAvailable: false,
            latestVersion: currentVersion,
            system: {
                nodeVersion: process.version,
                platform: process.platform,
                architecture: process.arch
            }
        };

        // Add update info if available
        try {
            // VersionChecker already imported at top
            const updateInfo = await VersionChecker.checkForUpdates();
            if (updateInfo && updateInfo.updateAvailable) {
                structuredData.updateAvailable = true;
                structuredData.latestVersion = updateInfo.latestVersion;
            }
        } catch (e) {
            // Ignore update check errors for structured data
        }

        return ResponseBuilder.successWithStructuredData(
            structuredData,
            ResponseBuilder.addFooter(versionText)
        );
    } catch (error: any) {
        OutputLogger.error('Error in handleGetVersion: ' + error);
        const errorMessage = ErrorHandler.formatError(error, { tool: 'get_version', args } as any);
        return {
            result: {
                content: [{
                    type: 'text',
                    text: errorMessage
                }]
            }
        };
    }
}

// Handle debug_info command
async function handleDebugInfo(args: any) {
    try {
        const sessionId = process.env.MCP_SESSION_ID || 'no-session';
        const uptime = Math.floor(process.uptime());
        const uptimeHours = Math.floor(uptime / 3600);
        const uptimeMinutes = Math.floor((uptime % 3600) / 60);
        const uptimeSeconds = uptime % 60;

        let debugText = `🔧 **MCP Server Debug Information**\n\n`;
        debugText += `**Process Information**:\n`;
        debugText += `• Process ID: ${process.pid}\n`;
        debugText += `• Session ID: ${sessionId}\n`;
        debugText += `• Uptime: ${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s\n`;
        debugText += `• Memory Usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB\n\n`;

        debugText += `**Runtime Environment**:\n`;
        debugText += `• Node.js: ${process.version}\n`;
        debugText += `• Platform: ${process.platform}\n`;
        debugText += `• Architecture: ${process.arch}\n`;
        debugText += `• Working Directory: ${process.cwd()}\n\n`;

        debugText += `**Environment Variables** (relevant):\n`;
        if (process.env.MCP_SESSION_ID) debugText += `• MCP_SESSION_ID: ${process.env.MCP_SESSION_ID}\n`;
        if (process.env.NODE_ENV) debugText += `• NODE_ENV: ${process.env.NODE_ENV}\n`;
        if (process.env.DEBUG) debugText += `• DEBUG: ${process.env.DEBUG}\n`;

        return {
            result: {
                content: [{
                    type: 'text',
                    text: ResponseBuilder.addFooter(debugText)
                }]
            }
        };
    } catch (error: any) {
        OutputLogger.error('Error in handleDebugInfo: ' + error);
        const errorMessage = ErrorHandler.formatError(error, { tool: 'test_debug', args } as any);
        return {
            result: {
                content: [{
                    type: 'text',
                    text: errorMessage
                }]
            }
        };
    }
}

// Command handler map
const commandHandlers = {
    // AI-Friendly Tools - Goal-oriented interfaces for AI agents
    
    // Simple Commands - Dead Simple with Smart Defaults
    'status': (args: any) => SimpleTools.handleStatus(args),
    'quick': (args: any) => SimpleTools.handleQuick(args),
    
    // Database export tools - Consolidated (DXP-81)
    // DXP-124-4: Database tools with audit logging
    'db_export': withProjectResolution(withAuditLogging('db_export', 'database', (args: any) => DatabaseSimpleTools.handleExportDatabase(args))),
    'db_export_status': withProjectResolution(withAuditLogging('db_export_status', 'database', (args: any) => DatabaseSimpleTools.handleCheckExportStatus(args))),
    'db_export_download': withProjectResolution(withAuditLogging('db_export_download', 'database', (args: any) => DatabaseSimpleTools.handleDownloadDatabaseExport(args))),
    'check_download_status': (args: any) => (DatabaseSimpleTools as any).handleCheckDownloadStatus(args),
    'test_export_query': withProjectResolution((args: any) => (DatabaseSimpleTools as any).testExportQuery(args)),
    // REMOVED: export_database - renamed to db_export
    // REMOVED: check_export_status - renamed to db_export_status
    // REMOVED: download_database_export - renamed to db_export_download
    // REMOVED: list_exports - relies on broken queryPaaSExports (DXP-49)
    // REMOVED: check_download_capabilities - embedded in db_export preview mode (DXP-81)
    
    
    // Blob Download Tools
    'download_blobs': withProjectResolution((args: any) => BlobDownloadTools.handleDownloadBlobs(args)),

    // Log Download Tools
    // DXP-124-4: Log download with audit logging
    'download_logs': withProjectResolution(withAuditLogging('download_logs', 'log', (args: any) => LogDownloadTools.handleDownloadLogs(args))),
    'discover_logs': withProjectResolution((args: any) => LogDiscoveryTools.discoverLogContainers(args)),
    // DXP-110: Streaming log analysis (2x faster than download + analyze)
    'analyze_logs_streaming': withProjectResolution((args: any) => LogAnalysisTools.handleAnalyzeLogsStreaming(args)),
    // DXP-112: Compare baseline vs slot logs for deployment decisions
    'compare_logs': (args: any) => LogAnalysisTools.handleCompareLogs(args),
    // DXP-101: debug_containers removed (used PowerShell)

    // Download Management (DXP-82 - Consolidated tools)
    'download_list': (args: any) => DownloadManagementTools.handleDownloadList(args),
    'download_status': (args: any) => DownloadManagementTools.handleDownloadStatus(args),
    'download_cancel': (args: any) => DownloadManagementTools.handleDownloadCancel(args),
    
    // Download Configuration
    'show_download_config': (args: any) => DownloadConfigTools.handleShowDownloadConfig(args),
    
    // Project Switching
    'switch_project': (args: any) => ProjectSwitchTool.handleSwitchProject(args),
    
    // Setup & Connection Tools
    'test_connection': withProjectResolution((args: any) => PermissionChecker.verifyAccess(args)),
    'health_check': async (args: any) => {
        console.error('[HEALTH_CHECK] Called with args:', args);
        if (args?.debug) {
            console.error('[HEALTH_CHECK] Routing to handleDebugInfo');
            return handleDebugInfo(args);
        }
        // DXP-107: Use PermissionChecker.verifyAccess instead of removed ConnectionTestTools
        console.error('[HEALTH_CHECK] Routing to PermissionChecker.verifyAccess');
        const result = await PermissionChecker.verifyAccess(args);
        console.error('[HEALTH_CHECK] Completed successfully');
        return result;
    },
    'get_version': handleGetVersion,
    'get_ai_guidance': async (args: any) => AIGuidanceTools.getAIGuidance(args), // Direct handler, no credentials needed
    // 'check_permissions': removed - merged into test_connection
    'verify_access': handleVerifyAccess, // Direct handler, no withProjectResolution to avoid cached module
    'get_project': (args: any) => ProjectTools.getProject(args),
    'update_project': (args: any) => ProjectTools.updateProject(args),
    'list_projects': (args: any) => ProjectTools.listProjects(args),
    'current_project': () => ProjectTools.showCurrentProject(),
    'get_support': (args: any) => ProjectTools.handleGetSupport(args),
    'list_monitors': (args: any) => MonitoringTools.listMonitors(args),
    'update_monitoring_interval': (args: any) => (MonitoringTools as any).updateMonitoringInterval(args),
    'stop_monitoring': (args: any) => (MonitoringTools as any).stopMonitoring(args),
    'get_monitoring_stats': (args: any) => MonitoringTools.getMonitoringStats(args),
    'disable_telemetry': handleDisableTelemetry,
    'enable_telemetry': handleEnableTelemetry,
    'get_rate_limit_status': handleGetRateLimitStatus,
    'get_cache_status': handleGetCacheStatus,
    // Legacy database tools are now handled above as aliases
    // DXP-124-3: Deployment tools with audit logging
    'list_deployments': withProjectResolution(withAuditLogging('list_deployments', 'deployment', (args: any) => DeploymentTools.handleListDeployments(args))),
    'start_deployment': withProjectResolution(withAuditLogging('start_deployment', 'deployment', (args: any) => DeploymentTools.handleStartDeployment(args))),
    'get_deployment_status': withProjectResolution((args: any) => DeploymentTools.handleGetDeploymentStatus(args)),
    'monitor_deployment': withProjectResolution((args: any) => DeploymentTools.handleMonitorDeployment(args)),
    'complete_deployment': withProjectResolution(withAuditLogging('complete_deployment', 'deployment', (args: any) => DeploymentTools.handleCompleteDeployment(args))),
    'reset_deployment': withProjectResolution(withAuditLogging('reset_deployment', 'deployment', (args: any) => DeploymentTools.handleResetDeployment(args))),
    'list_storage_containers': withProjectResolution((args: any) => StorageTools.handleListStorageContainers(args)),
    'generate_storage_sas_link': withProjectResolution((args: any) => StorageTools.handleGenerateStorageSasLink(args)),
    'copy_content': withProjectResolution((args: any) => ContentTools.handleCopyContent(args)),

    // Audit operations
    'query_audit_log': async (args: any) => {
        const result = await auditLogger.query({
            startTime: args.start_time,
            endTime: args.end_time,
            toolName: args.tool_name,
            status: args.status,
            limit: args.limit,
            offset: args.offset
        });

        return {
            total: result.total,
            entries: result.entries,
            hasMore: result.hasMore,
            count: result.entries.length,
            limit: args.limit || 100,
            offset: args.offset || 0
        };
    },
};

// Tool definitions
const toolDefinitions = Object.keys(schemas).sort((a, b) => {
    return a.localeCompare(b);
}).map(name => {
    const descriptions = {
        // Simple Commands
        'deploy': '🚀 Deploy code from source to target environment. ASYNC: 5-30min. Auto-monitors progress with real-time status updates. When deployment reaches "AwaitingVerification" status, test the slot URL (provided in response), then call complete_deployment() to finalize. Returns deploymentId for tracking. Required: sourceEnvironment, targetEnvironment. Use monitor_deployment() for background polling.',
        'status': '📊 Show current deployment status and environment health. REAL-TIME: <1s. Returns deployment states (InProgress, AwaitingVerification, Succeeded, Failed), progress percentage, and error details. Use this to check if deployments need completion or investigation. Optional: environment, project. Returns active deployment info and environment health metrics.',
        'quick': '⚡ Fast status check for active deployments only. REAL-TIME: <1s. Returns only critical issues and in-progress deployments without detailed logs. Use this for quick health checks before starting new operations. Returns filtered deployment summary. Optional: project.',

        // Database Export Operations
        'db_export': '💾 Start database export from specified environment. ASYNC: 10-60min depending on database size. Set autoMonitor=true to automatically poll status every 30s. Set autoDownload=true to automatically download when export completes. Returns exportId for tracking. Required: environment, database (epicms or epicommerce). Use db_export_status() to check progress. Agent workflow: start export → monitor status → download when complete.',
        'db_export_status': '📊 Check database export progress. REAL-TIME: <1s. Returns progress percentage, estimated time remaining, and download URL when export completes. Set monitor=true to poll every 30s until complete. Set autoDownload=true to automatically download when ready. Required: exportId, environment. Returns status and download URL when ready. Use db_export_download() with the URL to retrieve file.',
        'db_export_download': '📥 Download completed database export to local storage. BACKGROUND: returns immediately with download ID, actual download continues in background. Large files (>1GB) may take 5-20min. Use download_status() to monitor download progress and get local file path when complete. Required: downloadUrl. Optional: downloadPath, background (default true). Returns downloadId for tracking.',

        // Storage Downloads
        'download_blobs': '📦 Download files from Azure blob storage container to local path. ASYNC/BACKGROUND: returns immediately with download ID, continues in background. Supports date filtering to download specific time ranges. Use download_status() to monitor progress. Required: container, environment. Optional: downloadPath, dateFilter. Returns downloadId and estimated file count/size.',

        // Log Operations
        'download_logs': '📊 Download application logs from environment to local storage. BACKGROUND: returns immediately, download continues in background. Supports date filtering (dateFilter: "2025/10/14", "past-7-days") and log type (http, application, all). Use this when you need logs for offline analysis. For quick online analysis, use analyze_logs_streaming() instead (2x faster). Required: environment. Returns downloadId for monitoring with download_status().',
        'discover_logs': '🔎 Discover available log containers across all environments. REAL-TIME: <2s. Returns container names, log types available (http, application), and environment availability. Use this before download_logs() or analyze_logs_streaming() to understand what logs exist. Useful for multi-environment projects to find which environments have logging enabled. Optional: project. Returns container inventory.',
        'analyze_logs_streaming': '📊 Stream and analyze logs directly without downloading. FAST: 15-30sec vs 40-60sec for download+analyze. Returns structured health data: error count, performance metrics (p95/p99 response times), AI agent detection. Use this for deployment verification, health checks, or real-time diagnostics. Set slot=true when analyzing deployment slots. Required: environment. Optional: minutesBack (default 60), logType (http/application/all), slot. Returns health score, errors, performance, recommendations.',
        'compare_logs': '🔍 Compare baseline vs slot logs to make deployment decisions. ANALYSIS: <5s. Takes output from two analyze_logs_streaming() calls (baseline=production, slot=deployment slot). Returns safety recommendation (proceed/investigate/abort) with detailed reasoning based on error rate changes, performance degradation, and health score delta. Use in deployment workflow: analyze baseline → deploy → analyze slot → compare → decide to complete or reset. Required: baseline, slot objects. Returns decision and supporting metrics.',

        // Download Management
        'download_list': '📥 List downloads with flexible filtering and pagination. REAL-TIME: <1s. Filter by status (active/completed/failed/all) to monitor ongoing downloads or review history. Filter by type (logs/database/all) to track specific operations. Use pagination (limit, offset) for large download histories. Returns download IDs, status, progress percentage, file info, and start/completion times. Use this to find downloadId for download_status() or download_cancel() calls. All parameters optional.',
        'download_status': '📊 Get real-time status of specific download. REAL-TIME: <1s. Returns current progress percentage, download speed (MB/s), estimated time remaining, and local file path when download completes. Poll this every 5-10s to track long-running downloads. Download completes when status="completed" and file path is provided. Required: downloadId. Returns progress, speed, ETA, file path.',
        'download_cancel': '❌ Cancel active download(s) immediately. INSTANT: <1s. Call with downloadId to cancel specific download, or call without parameters to cancel all active downloads. Database downloads cannot be cancelled (Azure streaming limitation). Returns count of successfully cancelled downloads. Use download_list() to verify cancellation. Optional: downloadId. Returns cancelled count.',

        // Configuration
        'show_download_config': '📁 Show download directory configuration and disk space. REAL-TIME: <1s. Returns configured download path, available disk space, and write permissions status. Use this before starting large downloads to ensure sufficient space. Checks both configuration validity and file system permissions. Optional: project. Returns path, free space (GB), permissions.',

        // Project Management
        'switch_project': '🔄 Switch active project context for multi-project setups. INSTANT: <1s. Changes default credentials and project ID for all subsequent tool calls. Use this before operations when managing multiple Optimizely projects. Project context persists for entire session. Required: projectName. Returns new active project details. Use list_projects() to see available projects.',

        // System & Connection
        'test_connection': '🔍 Test API connection and verify credentials. REAL-TIME: 2-5s. Validates API key/secret, checks environment accessibility (Integration, Preproduction, Production), and returns permission levels. Use this after configuration changes or when troubleshooting connection issues. Returns accessible environments and detected project info. Optional: project. Use verify_access() for detailed permission checks.',
        'debug_info': '🔧 Show detailed process and system diagnostics. REAL-TIME: <1s. Returns process ID, memory usage, Node.js version, environment variables (secrets masked), and active configuration. Use for troubleshooting performance issues or configuration problems. No parameters. Returns full system state snapshot.',
        'health_check': '🏥 Check MCP server overall health status. REAL-TIME: 1-2s. Returns telemetry status, API rate limit info, active background monitors count, and system resource usage. Use this to verify server is operating normally before critical operations. No parameters. Returns health metrics and component status.',
        'get_version': '📌 Get current MCP server version and update availability. REAL-TIME: <1s. Checks local version against NPM registry for updates. Use this to verify you have latest features and bug fixes. Returns current version, latest available version, and update available flag. Suggests npm update command if outdated.',
        'get_ai_guidance': '🤖 Get AI-powered tool recommendations for natural language tasks. ANALYSIS: <1s. Analyzes task description and suggests which MCP tool to use with recommended parameters. Use when uncertain which tool fits your workflow. Returns recommended tool name, suggested parameters, and reasoning. Required: taskDescription (natural language).',
        'verify_access': '🔑 Verify API credentials and environment permissions. REAL-TIME: 2-5s. Checks which environments (Integration, Preproduction, Production) are accessible with current credentials. Returns detailed permission levels (read/write/deploy) for each environment. Use before deployment operations to confirm access. Optional: project. Returns environment access matrix.',
        'get_project': '📋 Get detailed project configuration. REAL-TIME: <1s. Returns project ID, name, configured environments, hosting type (DXP/self-hosted), and credential validation status. Use to inspect project settings or troubleshoot configuration issues. Required: projectName. Returns full project config object.',
        'update_project': '✏️ Update project configuration settings. INSTANT: <1s. Modifies stored credentials, project name, or environment settings. Changes persist for session. Use with caution - invalid credentials will break subsequent operations. Required: projectName, updates (object with fields to change). Returns updated project config. Test with test_connection() after updating.',
        'list_projects': '📂 List all configured projects in multi-project setup. REAL-TIME: <1s. Returns project names, IDs, hosting types (DXP/self-hosted), and active status. Use to discover available projects before switch_project() call. No parameters. Returns array of project summaries.',
        'current_project': '📌 Show currently active project context. INSTANT: <1s. Returns name, ID, and environment access for the project currently in use. Use to confirm project context before critical operations. No parameters. Returns active project info.',
        'get_support': '💬 Get support contact information and documentation. INSTANT: <1s. Returns support email, documentation URLs, API reference links, and GitHub issues page. Use when you need help or want to report issues. No parameters. Returns support resources object.',

        // Monitoring
        'list_monitors': '📡 List active background monitors tracking deployments. REAL-TIME: <1s. Shows all monitors polling deployment status, including monitor IDs, associated deployment IDs, current status, and update count. Use to discover active monitors for stop_monitoring() or update_monitoring_interval() calls. No parameters. Returns array of active monitor details.',
        'update_monitoring_interval': '⏱️ Change polling frequency for specific monitor. INSTANT: <1s. Adjusts how often monitor checks deployment status. Valid range: 10-600 seconds. Lower intervals (10-30s) for urgent deployments, higher intervals (60-300s) for long-running operations to reduce API calls. Required: monitorId, intervalSeconds. Returns updated monitor configuration.',
        'stop_monitoring': '🛑 Stop background monitoring for deployment. INSTANT: <1s. Stops polling immediately and returns final deployment status at time of stop. Monitor is removed from active monitors list. Use when deployment completes or when manual monitoring is preferred. Required: monitorId. Returns final deployment status and monitor summary.',
        'get_monitoring_stats': '📈 Get aggregate statistics for all monitors. REAL-TIME: <1s. Returns total monitor count, active monitors, average update frequency, and average monitor duration. Use to understand monitoring load and system activity. No parameters. Returns monitoring statistics summary.',

        // System Settings
        'disable_telemetry': '🔇 Disable anonymous usage telemetry collection. INSTANT: <1s. Stops collecting tool usage analytics and error data. Telemetry helps improve MCP server but is fully optional. Change persists for session. No parameters. Returns confirmation of disabled telemetry.',
        'enable_telemetry': '🔔 Enable anonymous usage telemetry collection. INSTANT: <1s. Resumes collecting tool usage patterns and error data for product improvement. No personal data collected, only tool names and error types. Change persists for session. No parameters. Returns confirmation of enabled telemetry.',
        'get_rate_limit_status': '⏳ View current API rate limit status. REAL-TIME: <1s. Shows requests remaining (per minute and hourly), reset times, and current usage percentage. Optimizely API limits: 30/min, 500/hour per project. Use before batch operations to avoid hitting limits. Optional: project. Returns rate limit metrics and reset timestamps.',
        'get_cache_status': '💾 View cache performance metrics. REAL-TIME: <1s. NOTE: Cache is now operation-specific (no central management). Shows cache hit/miss rates for different operation types. Use to understand caching effectiveness. No parameters. Returns cache statistics by operation type.',

        // Deployment Operations
        'list_deployments': '📋 List recent deployments with filtering and pagination. REAL-TIME: <2s. Returns deployment IDs, status (InProgress, AwaitingVerification, Succeeded, Failed), source/target environments, and timestamps. Set activeOnly=true to show only in-progress/awaiting deployments. Use pagination (limit, offset) for large deployment histories. All parameters optional. Returns deployment history array. Use get_deployment_status() for detailed info on specific deployment.',
        'start_deployment': '🚀 Start new deployment from source to target environment. ASYNC: 5-30min. Initiates deployment and auto-monitors progress with real-time updates. CODE deployments flow upward (Integration→Preproduction→Production). CONTENT deployments flow downward (Production→Preproduction→Integration). Returns deploymentId immediately. Set includeBlob=true for static files, includeDB=true for database sync. When status reaches "AwaitingVerification", use get_deployment_status() to get slot URL for testing, then complete_deployment() to finalize. Required: sourceEnvironment, targetEnvironment.',
        'get_deployment_status': '📊 Get detailed deployment status and progress. REAL-TIME: <2s. Returns current status (InProgress, AwaitingVerification, Succeeded, Failed, Reset), progress percentage, and slot validation URL when status is AwaitingVerification. Set monitor=true to poll every 30s until reaches AwaitingVerification. Set waitBeforeCheck (seconds) to pause before checking status. Required: deploymentId. Agent workflow: After start_deployment() → poll status until AwaitingVerification → test slot URL → complete_deployment().',
        'monitor_deployment': '🔄 Start background monitor for deployment. INSTANT: returns immediately with monitorId. Polls deployment status every 30s (configurable with interval parameter) and emits progress updates via events. Monitor runs in background until deployment reaches terminal state (Succeeded, Failed) or is manually stopped. Valid interval: 10-600 seconds. Required: deploymentId. Returns monitorId for use with stop_monitoring() or update_monitoring_interval(). Use list_monitors() to see all active monitors.',
        'complete_deployment': '✅ Finalize deployment after verification. ASYNC: 2-15min. **For AI Agents**: Subscribe to deployment://{deploymentId} resource for real-time completion events (preferred method). Alternatively, set monitor=true (default) for background polling fallback. Deployment transitions: AwaitingVerification → Completing → Succeeded/Failed. After completing, monitor automatically tracks progress and emits events. Production deployments take 2-15min, other environments <1min. Required: deploymentId. Optional: monitor (default true).',
        'reset_deployment': '↩️ Rollback deployment to previous state. ASYNC: 5-15min. Reverses all changes made by deployment, restoring previous code and optionally database. Use when deployment verification fails or errors detected. Set resetWithDbRollback=true to also rollback database changes. Deployment transitions to "Reset" status when complete. Required: deploymentId. Agent workflow: If deployment verification fails → reset_deployment() → investigate logs with analyze_logs_streaming().',

        // Storage Operations
        'list_storage_containers': '📦 List Azure blob storage containers for environment. REAL-TIME: 1-3s. Returns container names, types (logs, blobs, websitelogs), and creation dates. Use this to discover available containers before download_blobs() or generate_storage_sas_link() calls. Containers vary by environment and project configuration. Required: environment. Optional: project. Returns array of container details.',
        'generate_storage_sas_link': '🔗 Generate temporary Shared Access Signature URL for storage container. INSTANT: <1s. Returns time-limited URL for direct Azure Storage access (read or write). Default: 24 hour expiration, read-only. Set retentionHours for custom expiration (1-168 hours). Set writable=true for write access. Use for external tools, scripts, or direct blob access. Required: container, environment. Returns SAS URL string. URL expires after specified retention period.',

        // Content Operations
        'copy_content': '📋 Copy database and/or blob content between environments. ASYNC: 30-90min depending on content size. Use for refreshing staging/test environments with production data or promoting content changes. Set includeBlob=true to copy static files/media (slower). Set includeDB=true to copy CMS/Commerce databases. CONTENT typically flows downward (Production→Preproduction→Integration). This is a heavy operation - verify target environment before starting. Required: sourceEnvironment, targetEnvironment. Returns operation ID for tracking. Use status() tool to monitor progress.',

        // Audit Operations
        'query_audit_log': '📊 Query audit trail for MCP tool invocations. REAL-TIME: <1s. Returns filtered audit entries with operation details, timestamps, status, and parameters (sensitive data redacted). Use to review deployment history, troubleshoot errors, or track tool usage patterns. Filter by time range (start_time, end_time), tool name (e.g., "start_deployment"), or status (success/failure). Supports pagination (limit, offset) for large audit trails. All parameters optional. Returns { total, entries[], hasMore, count, limit, offset }. Default limit: 100 entries.',
    };
    
    return {
        name,
        description: (descriptions as any)[name],
        inputSchema: (schemas as any)[name]
    };
});

// Server instance - will be created in main()
let server;

// Handler setup function - will be called from main() after server creation
function setupHandlers(server: any) {
    // Handle tools/list request - Filter by environment (DXP-23)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // Get current project to determine hosting type
        // ProjectTools already imported at top
        const currentProject = ProjectTools.getCurrentProject();

        // Pass project info for hosting type detection
        const projectArgs = currentProject ? {
            projectId: currentProject.projectId,
            apiKey: currentProject.apiKey,
            apiSecret: currentProject.apiSecret,
            connectionString: currentProject.connectionString
        } : {};

        // DXP-89: Get hosting type to determine filtering behavior
        const currentHosting = HostingDetector.detectHostingType(projectArgs);

        // For unknown hosting, show ALL tools (user can configure credentials inline or via environment)
        // For known hosting types, filter to only show compatible tools
        let availableToolNames;
        if (currentHosting === 'unknown') {
            // Show all tools - users can provide credentials inline or configure project
            // Tool execution will validate and provide clear error messages if needed
            availableToolNames = Object.keys(schemas);
        } else {
            // Filter based on hosting type capabilities (DXP-23)
            availableToolNames = ToolAvailabilityMatrix.getAvailableTools(projectArgs)
                .map(t => t.name);
        }

        // Filter tool definitions to only include available tools
        const filteredTools = toolDefinitions
            .filter(tool => availableToolNames.includes(tool.name))
            .map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: zodToJsonSchema(tool.inputSchema)
            }));

        return {
            tools: filteredTools
        };
    });

    // DXP-136: Handle resources/list request - return active resources
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        try {
            const resourceManager = getGlobalResourceManager();
            const resources = resourceManager.listResources();

            console.error(`[MCP SERVER] Listing ${resources.length} active resources`);

            return {
                resources: resources.map(r => ({
                    uri: r.uri,
                    name: r.name,
                    description: r.description,
                    mimeType: r.mimeType
                }))
            };
        } catch (error: any) {
            console.error('[MCP SERVER] Error listing resources:', error.message);
            return {
                resources: []
            };
        }
    });

    // DXP-136: Handle resources/read request - read resource contents
    server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
        try {
            const { uri } = request.params;
            const resourceManager = getGlobalResourceManager();

            console.error(`[MCP SERVER] Reading resource: ${uri}`);

            const contents = resourceManager.readResource(uri);

            return {
                contents: [{
                    uri: uri,
                    mimeType: 'application/json',
                    text: contents
                }]
            };
        } catch (error: any) {
            console.error(`[MCP SERVER] Error reading resource:`, error.message);
            throw new Error(`Failed to read resource: ${error.message}`);
        }
    });

    // DXP-134: Handle resources/subscribe request - subscribe to resource updates
    server.setRequestHandler(SubscribeRequestSchema, async (request: any) => {
        try {
            const { uri } = request.params;
            const resourceManager = getGlobalResourceManager();

            console.error(`[MCP SERVER] Subscribing to resource: ${uri}`);

            // Attempt to subscribe (returns false if resource doesn't exist)
            const subscribed = resourceManager.subscribe(uri);

            if (!subscribed) {
                throw new Error(`Resource not found: ${uri}`);
            }

            return {};
        } catch (error: any) {
            console.error(`[MCP SERVER] Error subscribing to resource:`, error.message);
            throw new Error(`Failed to subscribe to resource: ${error.message}`);
        }
    });

    // DXP-134: Handle resources/unsubscribe request - unsubscribe from resource updates
    server.setRequestHandler(UnsubscribeRequestSchema, async (request: any) => {
        try {
            const { uri } = request.params;
            const resourceManager = getGlobalResourceManager();

            console.error(`[MCP SERVER] Unsubscribing from resource: ${uri}`);

            // Unsubscribe (returns false if subscription didn't exist)
            resourceManager.unsubscribe(uri);

            return {};
        } catch (error: any) {
            console.error(`[MCP SERVER] Error unsubscribing from resource:`, error.message);
            throw new Error(`Failed to unsubscribe from resource: ${error.message}`);
        }
    });

    // Handle prompts/list request - Claude Code expects this
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        try {
            // Combine prompts from all modules
            const databasePrompts = DatabaseExportPrompts.getPromptDefinitions();
            const deploymentPrompts = DeploymentWorkflowPrompts.getPromptDefinitions();
            const autonomousPrompts = AutonomousDeploymentPrompts.getPromptDefinitions();
            const downloadPrompts = DownloadPrompts.getPromptDefinitions();
            const promptDefinitions = [...databasePrompts, ...deploymentPrompts, ...autonomousPrompts, ...downloadPrompts];

            console.error('\n🎯 [PROMPT SYSTEM] prompts/list called - returning', promptDefinitions.length, 'prompt(s)');
            console.error('   Available prompts:', promptDefinitions.map(p => p.name).join(', '));
            return {
                prompts: promptDefinitions
            };
        } catch (error: any) {
            console.error('❌ [PROMPT SYSTEM] Error getting prompt definitions:', error);
            return {
                prompts: []
            };
        }
    });

    // Handle prompts/get request - returns specific prompt with messages
    server.setRequestHandler(GetPromptRequestSchema, async (request: any) => {
        try {
            const { name, arguments: promptArgs = {} } = request.params;

            console.error('\n🔥 [PROMPT SYSTEM] prompts/get called!');
            console.error('   Prompt name:', name);
            console.error('   Arguments:', JSON.stringify(promptArgs));
            console.error('   THIS MEANS CLAUDE IS USING THE PROMPT!');

            let messages;
            let description;

            // Route to appropriate prompt handler
            const autonomousPromptNames = ['baseline-analysis', 'start-deployment', 'monitor-deployment',
                                          'get-slot-url', 'slot-analysis', 'deployment-decision'];
            const databasePromptNames = ['export-database', 'database_export_workflow'];
            const downloadPromptNames = ['download_confirmation_required', 'incremental_download_explanation'];

            if (databasePromptNames.includes(name)) {
                messages = DatabaseExportPrompts.getPromptMessages(name, promptArgs);
                description = `Database export workflow prompt: ${name}`;
            } else if (name === 'deployment-workflow') {
                messages = DeploymentWorkflowPrompts.getPromptMessages(name, promptArgs);
                description = `Deployment monitoring workflow prompt: ${name}`;
            } else if (downloadPromptNames.includes(name)) {
                messages = DownloadPrompts.getPromptMessages(name, promptArgs);
                description = `Download guidance prompt: ${name}`;
            } else if (autonomousPromptNames.includes(name)) {
                messages = AutonomousDeploymentPrompts.getPromptMessages(name, promptArgs);
                description = `Autonomous deployment phase prompt: ${name}`;
            } else {
                throw new Error(`Unknown prompt: ${name}`);
            }

            console.error('   ✅ Returning', messages.length, 'message(s) for workflow guidance');

            return {
                description: description,
                messages: messages
            };
        } catch (error: any) {
            console.error('❌ [PROMPT SYSTEM] Error getting prompt messages:', error);
            console.error('   Error details:', error.message);
            console.error('   Error stack:', error.stack);
            throw error; // Re-throw the original error with full details
        }
    });

    // Handle tools/call request
    server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    // DXP-34 FIX: Use simple destructuring pattern like working log-analyzer-mcp
    // Changed from: const { name: toolName, arguments: args } = request.params;
    // The destructuring alias was causing toolName to be undefined in some MCP environments
    const { name, arguments: args } = request.params;
    const toolName = name; // Explicit assignment for clarity

    // DXP-34: Debug logging for tool name tracking
    if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
        console.error(`[DXP-34 DEBUG] Tool request received:`, {
            toolName: toolName,
            hasToolName: !!toolName,
            typeOfToolName: typeof toolName,
            requestParams: Object.keys(request.params || {})
        });
    }

    // DXP-34: Validate tool name is present
    if (!toolName) {
        console.error('[DXP-34 ERROR] Tool request received without tool name!', {
            request: JSON.stringify(request.params)
        });
        throw new Error('Tool name is required but was not provided');
    }

    // Validate input with Zod schema
    const schema = (schemas as any)[toolName];
    if (!schema) {
        throw new Error(`Unknown tool: ${toolName}`);
    }

    let validatedArgs;
    try {
        // Fix for Claude Desktop using backticks in parameter names and values
        let processedArgs = args;

        // Check if args is an object with backtick-wrapped keys
        if (typeof args === 'object' && args !== null) {
            const keys = Object.keys(args);
            // Check if any key has backticks
            if (keys.some(key => key.includes('`'))) {
                console.error('[BACKTICK FIX] Detected backticks in object keys, attempting to fix...');
                console.error('[BACKTICK FIX] Original keys:', keys);
                processedArgs = {};

                // Copy properties, removing backticks from keys
                for (const key of keys) {
                    // Remove backticks from the key
                    const cleanKey = key.replace(/`/g, '');
                    let value = args[key];

                    // Also clean the value if it's a string with backticks
                    if (typeof value === 'string' && value.includes('`')) {
                        value = value.replace(/`/g, '');
                    }

                    processedArgs[cleanKey] = value;
                }

                console.error('[BACKTICK FIX] Fixed keys:', Object.keys(processedArgs));
                console.error('[BACKTICK FIX] Fixed args:', processedArgs);
            }
        }
        // Original string-based fix (keep for backward compatibility)
        else if (typeof args === 'string' && args.includes('`')) {
            console.error('[BACKTICK FIX] Detected backticks in string parameters, attempting to fix...');
            console.error('[BACKTICK FIX] Original args:', args);
            try {
                // First, replace backticked keys: `key`: -> "key":
                let fixed = args.replace(/`(\w+)`:/g, '"$1":');
                // Then, replace backticked values: : `value` -> : "value"
                fixed = fixed.replace(/:\s*`([^`]+)`/g, ': "$1"');
                console.error('[BACKTICK FIX] After fixing:', fixed);
                processedArgs = JSON.parse(fixed);
                console.error('[BACKTICK FIX] Successfully fixed malformed JSON');
            } catch (fixError) {
                console.error('[BACKTICK FIX] Failed to fix malformed JSON:', (fixError as any).message);
                processedArgs = args;
            }
        }

        validatedArgs = schema.parse(processedArgs);
    } catch (error: any) {
        return {
            content: [{
                type: 'text',
                text: `❌ Invalid arguments: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
            }],
            isError: true
        };
    }

    // Check tool availability for current environment (DXP-23)
    if (!ToolAvailabilityMatrix.isToolAvailable(toolName, validatedArgs)) {
        const restrictionMessage = ToolAvailabilityMatrix.getRestrictionMessage(toolName, validatedArgs);
        const hostingName = HostingDetector.getHostingTypeName(validatedArgs);

        return {
            content: [{
                type: 'text',
                text: `❌ Tool Not Available in ${hostingName}\n\n${restrictionMessage}\n\n📧 Need help? Contact support@jaxondigital.com`
            }],
            isError: true
        };
    }
    
    // Auto-register project when credentials are provided inline (BEFORE credential injection)
    // This ensures API keys are saved even when used with get_project or update_project
    if (validatedArgs.projectName && validatedArgs.projectId && 
        validatedArgs.apiKey && validatedArgs.apiSecret) {
        // Check if this is a new project or update
        const existingProjects = ProjectTools.getConfiguredProjects();
        const isNewProject = !existingProjects.find(p => 
            p.projectId === validatedArgs.projectId || 
            p.name === validatedArgs.projectName
        );
        
        // Add or update the API key configuration
        ProjectTools.addConfiguration({
            name: validatedArgs.projectName,
            projectId: validatedArgs.projectId,  // Fixed: was 'id', should be 'projectId'
            apiKey: validatedArgs.apiKey,
            apiSecret: validatedArgs.apiSecret,
            environments: ['Integration', 'Preproduction', 'Production'],
            isDefault: false
        });
        
        // Log registration for debugging (to stderr)
        if (isNewProject) {
            // console.error(`Registered new project: ${validatedArgs.projectName}`);
        } else {
            // console.error(`Updated project: ${validatedArgs.projectName}`);
        }
    }
    
    // Handle project switching and credential injection
    // First check if a project name was provided (for easier switching)
    if (validatedArgs.projectName && !validatedArgs.projectId) {
        const projectCreds = ProjectTools.getProjectCredentials(validatedArgs.projectName);
        if (projectCreds) {
            validatedArgs.projectId = projectCreds.projectId;
            validatedArgs.apiKey = projectCreds.apiKey;
            validatedArgs.apiSecret = projectCreds.apiSecret;
            // Remember this project for subsequent calls in the session
            ProjectTools.setLastUsedProject(validatedArgs.projectName);
        }
    }
    
    // Inject environment credentials if not provided and no inline credentials
    if (!validatedArgs.projectId && !validatedArgs.apiKey && !validatedArgs.apiSecret) {
        const defaultCreds = ProjectTools.getProjectCredentials();
        validatedArgs.projectId = defaultCreds.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        validatedArgs.apiKey = defaultCreds.apiKey || process.env.OPTIMIZELY_API_KEY;
        validatedArgs.apiSecret = defaultCreds.apiSecret || process.env.OPTIMIZELY_API_SECRET;
    }

    // CRITICAL FIX: Always inject project name when we have credentials but no project name
    // This must happen OUTSIDE the credential injection block to ensure it always runs
    if ((validatedArgs.projectId || validatedArgs.apiKey) && !validatedArgs.project && !validatedArgs.projectName) {
        const defaultCreds = ProjectTools.getProjectCredentials();
        console.error('[DEBUG] Project injection - defaultCreds:', JSON.stringify(defaultCreds, null, 2));
        if (defaultCreds.name) {
            console.error('[DEBUG] Injecting project name:', defaultCreds.name);
            validatedArgs.project = defaultCreds.name;
            validatedArgs.projectName = defaultCreds.name;
        } else {
            console.error('[DEBUG] No project name in defaultCreds!');
        }
    }

    // Final debug check
    if (toolName === 'db_export') {
        console.error('\n🔍 [DB_EXPORT] Tool called directly');
        console.error('   Args:', JSON.stringify({
            project: validatedArgs.project,
            projectName: validatedArgs.projectName,
            projectId: validatedArgs.projectId,
            hasApiKey: !!validatedArgs.apiKey,
            hasApiSecret: !!validatedArgs.apiSecret
        }, null, 2));
    }
    
    // If still missing apiKey or apiSecret, try to get from configured projects
    if (!validatedArgs.apiKey || !validatedArgs.apiSecret) {
        const projectCreds = ProjectTools.getProjectCredentials(validatedArgs.projectId);
        if (projectCreds) {
            validatedArgs.apiKey = validatedArgs.apiKey || projectCreds.apiKey;
            validatedArgs.apiSecret = validatedArgs.apiSecret || projectCreds.apiSecret;
        }
    }
    
    // Log which project is being used (to stderr to avoid polluting stdout)
    if (validatedArgs.projectId && toolName !== 'get_project' && toolName !== 'update_project') {
        // console.error(`Using project: ${validatedArgs.projectId}`);
    }
    
    // Tools that use withProjectResolution wrapper (they handle credentials internally)
    const toolsWithProjectResolution = [
        'backup', 'backup_status', 'list_backups', 
        'deploy', 'status', 'rollback', 'quick',
        'switch_project',
        'test_connection', 'health_check',
        'download_blobs', 'download_logs', 'list_storage_containers',
        'db_export', 'db_export_status'
    ];
    
    
    // Check for missing credentials (except for project management tools and tools with project resolution)
    const shouldCheckCredentials = (toolName !== 'get_project' &&
                                   toolName !== 'update_project' &&
        toolName !== 'list_projects' &&  // list_projects doesn't need credentials
        toolName !== 'current_project' &&  // current_project doesn't need credentials
        toolName !== 'list_api_keys' &&
        toolName !== 'get_ai_guidance' &&  // AI guidance doesn't need credentials
        !toolsWithProjectResolution.includes(toolName));
    
    if (shouldCheckCredentials) {
        const missingCreds = [];
        const hasProjectName = !!validatedArgs.projectName;
        if (!validatedArgs.projectId) missingCreds.push('Project ID');
        if (!validatedArgs.apiKey) missingCreds.push('API Key');
        if (!validatedArgs.apiSecret) missingCreds.push('API Secret');
        
        // Only show missing credentials error if we're actually missing required fields
        if (missingCreds.length > 0) {
            // Add project name suggestion if other credentials are missing
            if (!hasProjectName) {
                missingCreds.unshift('Project Name (strongly recommended for easy reference)');
            }
            return {
                content: [{
                    type: 'text',
                    text: `❌ **Connection Error**\n\n` +
                          `The following credentials are required but not provided:\n` +
                          missingCreds.map(c => `• ${c}`).join('\n') + `\n\n` +
                          `**How to fix this:**\n\n` +
                          `**Option 1:** Pass ALL credentials as parameters to this tool:\n` +
                          `• projectName: "Your Project Name" (e.g., "Production", "Staging", "ClientA")\n` +
                          `• projectId: "your-uuid"\n` +
                          `• apiKey: "your-key"\n` +
                          `• apiSecret: "your-secret"\n\n` +
                          `**Why Project Name is Important:**\n` +
                          `Once you provide a project name, the project is auto-registered and you can reference it by name in future commands!\n\n` +
                          `**Option 2:** Configure environment variables in Claude Desktop:\n` +
                          `Run the \`get_project\` tool for detailed setup instructions.\n\n` +
                          `💡 **Tip:** Use \`list_api_keys\` to see all registered API key configurations.`
                }],
                isError: true
            };
        }
    }
    
    // Execute tool using handler map
    const startTime = Date.now();
    
    try {
        const handler = (commandHandlers as any)[toolName];
        if (!handler) {
            throw new Error(`Tool ${toolName} not implemented`);
        }
        
        // Track tool usage (legacy format for existing metrics)
        telemetry.trackToolUsage(toolName, {
            environment: validatedArgs.environment,
            hasCredentials: !!(validatedArgs.apiKey && validatedArgs.projectId)
        });
        
        console.error(`[HANDLER CALL] Calling ${toolName} with args:`, {
            hasConnectionString: !!validatedArgs.connectionString,
            hasApiKey: !!validatedArgs.apiKey,
            containerName: validatedArgs.containerName
        });
        const result = await handler(validatedArgs);
        const duration = Date.now() - startTime;
        console.error(`[HANDLER DONE] ${toolName} completed in ${duration}ms`);

        // DXP-34: Debug logging before telemetry call
        if (process.env.DEBUG || process.env.TELEMETRY_DEBUG) {
            console.error(`[DXP-34 DEBUG] Before trackToolCall:`, {
                toolName: toolName,
                hasToolName: !!toolName,
                typeOfToolName: typeof toolName,
                duration: duration,
                success: !result.error
            });
        }

        // DXP-34 SIMPLIFIED: Use ONLY trackToolDirect to eliminate complexity
        telemetry.trackToolDirect(toolName, duration, !result.error);
        
        // Flush telemetry to ensure events are sent in short-lived MCP sessions
        // This is critical for MCP because the process doesn't exit normally
        telemetry.flush().catch(() => {
            // Silently ignore flush errors
        });
        
        // Handle response format
        if (result.error) {
            // Track error (legacy format)
            telemetry.trackError(new Error(result.error), {
                tool: toolName,
                operation: 'tool_execution',
                environment: validatedArgs.environment
            });
            
            return {
                content: [{ 
                    type: 'text', 
                    text: result.error || 'An error occurred' 
                }],
                isError: true
            };
        }
        
        // DXP-34 SIMPLIFIED: Removed complex deployment tracking
        
        // Format successful response
        // Debug logging for db_export status checking
        if (toolName === 'db_export' && validatedArgs.exportId) {
            console.error('[EXPORT_STATUS DEBUG] Result structure:', {
                hasResult: !!result,
                hasResultResult: !!result?.result,
                hasResultContent: !!result?.content,
                resultKeys: Object.keys(result || {}),
                resultResultKeys: Object.keys(result?.result || {}),
                contentType: typeof result?.result?.content?.[0]?.text,
                contentValue: result?.result?.content?.[0]?.text?.substring?.(0, 100)
            });
        }

        // DXP-66: Format response for both AI assistants and automation tools
        // Use structuredContent for automation tools, content.text for AI assistants
        let finalText;
        let structuredData = null;

        if (result.data && result.message) {
            // Structured response with data - return BOTH text message and structured data
            finalText = result.message; // Human-readable message for AI
            structuredData = {
                success: !result.error,
                data: result.data
                // Note: message is already in content[0].text, no need to duplicate it here
            };
        } else if (result.result?.content?.[0]?.text) {
            // Nested MCP format response
            finalText = result.result.content[0].text;
        } else if (result.content?.[0]?.text) {
            // Direct MCP format response
            finalText = result.content[0].text;
        } else if (typeof result === 'string') {
            // Plain string response
            finalText = result;
        } else {
            // Fallback: stringify the entire result
            finalText = JSON.stringify(result, null, 2);
        }

        // Build response with both text content and structured data
        const response = {
            content: [{
                type: 'text',
                text: finalText
            }]
        };

        // Add structuredContent if we have structured data (MCP protocol feature)
        if (structuredData) {
            (response as any).structuredContent = structuredData;
        }

        return response;
        
    } catch (error: any) {
        console.error(`[CATCH] Caught error in tool ${toolName}:`, error.message);
        console.error(`[CATCH] Error stack:`, error.stack);
        OutputLogger.error(`Error executing tool ${toolName}: ` + error);
        
        // Track error
        const duration = Date.now() - startTime;
        
        // DXP-34 SIMPLIFIED: Use ONLY trackToolDirect for error tracking too
        telemetry.trackToolDirect(toolName, duration, false);
        
        return {
            content: [{ 
                type: 'text', 
                text: `❌ Error: ${error.message}` 
            }],
            isError: true
        };
    }
    });
}

/**
 * Start HTTP server for n8n integration
 * DXP-89: Add HTTP Streamable transport support
 * Production hardening: size limits, timeouts, error handling, graceful shutdown
 */
async function startHttpServer(server: any, port = 3001) {
    // express already imported at top
    // packageJson already imported at top
    // RateLimiter already imported at top

    const app = express();

    // DXP-89 Hardening: Security headers (OWASP recommendations)
    app.use((_req, res, next) => {
        // Prevent MIME type sniffing
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // Prevent clickjacking
        res.setHeader('X-Frame-Options', 'DENY');
        // Enable XSS protection
        res.setHeader('X-XSS-Protection', '1; mode=block');
        // Content Security Policy (restrict to same origin)
        res.setHeader('Content-Security-Policy', "default-src 'self'");
        // Remove Express signature
        res.removeHeader('X-Powered-By');
        next();
    });

    // DXP-89 Hardening: Request size limit (DoS protection)
    app.use(express.json({ limit: '10mb' }));

    // DXP-89 Hardening: Request timeout (prevent hung connections)
    app.use((req, res, next) => {
        req.setTimeout(120000); // 2 minutes
        res.setTimeout(120000);
        next();
    });

    // DXP-89 Hardening: Request logging (sanitized)
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            const ip = req.ip || req.connection.remoteAddress;
            console.error(`[HTTP] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms) - ${ip}`);
        });
        next();
    });

    // DXP-108: IP whitelist for trusted internal callers
    const TRUSTED_IPS = [
        '127.0.0.1',                    // localhost
        '::1',                          // localhost IPv6
        /^172\.\d+\.\d+\.\d+$/,        // Docker network (172.x.x.x)
        /^10\.\d+\.\d+\.\d+$/           // Private network (10.x.x.x)
    ];

    function isTrustedIp(clientIp: any) {
        if (!clientIp || clientIp === 'unknown') return false;
        return TRUSTED_IPS.some(pattern =>
            typeof pattern === 'string' ? clientIp === pattern : pattern.test(clientIp)
        );
    }

    // DXP-89 Hardening: Rate limiting (per-IP, except trusted internal IPs)
    const rateLimiter = new RateLimiter({
        maxRequestsPerMinute: 30,
        maxRequestsPerHour: 500,
        debug: process.env.DEBUG === 'true'
    });

    app.use((req, res, next) => {
        let clientIp = req.ip || req.connection.remoteAddress || 'unknown';

        // DXP-109: Strip IPv6-mapped IPv4 prefix (::ffff:x.x.x.x -> x.x.x.x)
        if (clientIp.startsWith('::ffff:')) {
            clientIp = clientIp.substring(7);
        }

        // DXP-108: Skip rate limiting for trusted internal IPs
        if (isTrustedIp(clientIp)) {
            return next();
        }

        // Apply rate limiting only for external IPs
        const rateCheck = rateLimiter.checkRateLimit(clientIp);

        if (!rateCheck.allowed) {
            const retryAfterSeconds = Math.ceil((rateCheck.waitTime || 0) / 1000);
            res.setHeader('Retry-After', retryAfterSeconds);
            return res.status(429).json({
                jsonrpc: '2.0',
                error: {
                    code: -32000,
                    message: `Rate limit exceeded. Please retry after ${retryAfterSeconds} seconds.`,
                    data: {
                        reason: rateCheck.reason,
                        retryAfter: retryAfterSeconds
                    }
                }
            });
        }

        rateLimiter.recordRequest(clientIp);
        next();
    });

    // Health check endpoint (GET only)
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            service: 'optimizely-dxp-mcp',
            version: packageJson.version,
            mode: 'http',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid
        });
    });

    // DXP-89 Hardening: Reject non-GET requests to health endpoint
    app.all('/health', (_req, res) => {
        res.status(405).json({
            error: 'Method Not Allowed',
            allowed: ['GET']
        });
    });

    // MCP endpoint (POST only)
    app.post('/mcp', async (req, res): Promise<void> => {
        // DXP-89 Hardening: Validate Content-Type
        const contentType = req.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            res.status(415).json({
                jsonrpc: '2.0',
                error: {
                    code: -32700,
                    message: 'Unsupported Media Type: Content-Type must be application/json'
                }
            });
            return;
        }
        try {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true,
                strictHeaders: false  // DXP-100: Allow n8n MCP Client Tool (doesn't send proper Accept headers)
            } as any);

            // Clean up transport on response close
            res.on('close', () => {
                try {
                    transport.close();
                } catch (error: any) {
                    // Ignore close errors
                }
            });

            // Connect server to transport and handle request
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error: any) {
            console.error('[MCP SERVER] HTTP request error:', error);
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                        // DXP-89 Hardening: Only expose error details in development
                        ...(process.env.NODE_ENV === 'development' && { data: error.message })
                    }
                });
            }
        }
    });

    // DXP-89 Hardening: Reject non-POST requests to MCP endpoint
    app.all('/mcp', (_req, res) => {
        res.status(405).json({
            error: 'Method Not Allowed',
            allowed: ['POST']
        });
    });

    // DXP-89 Hardening: Catch-all for undefined routes (404)
    app.use((req, res) => {
        res.status(404).json({
            error: 'Not Found',
            message: `Route ${req.method} ${req.path} not found`,
            availableEndpoints: ['GET /health', 'POST /mcp']
        });
    });

    // DXP-89 Hardening: Malformed JSON error handler
    app.use((err: any, _req: any, res: any, next: any) => {
        if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
            return res.status(400).json({
                jsonrpc: '2.0',
                error: {
                    code: -32700,
                    message: 'Parse error: Invalid JSON'
                }
            });
        }
        next(err);
    });

    // DXP-89 Hardening: Bind appropriately for environment
    // Docker: 0.0.0.0 (allow host access), Local: localhost (security)
    const host = process.env.DXP_MCP_HOST || '0.0.0.0';
    return new Promise((resolve, reject) => {
        const httpServer = app.listen(port, host, () => {
            console.error(`[MCP SERVER] HTTP Streamable transport enabled`);
            console.error(`[MCP SERVER] Server listening on http://${host}:${port}`);
            console.error(`[MCP SERVER] MCP endpoint: POST http://${host}:${port}/mcp`);
            console.error(`[MCP SERVER] Health check: GET http://${host}:${port}/health`);
            console.error(`[MCP SERVER] Ready for n8n integration`);
            resolve(httpServer);
        });

        // DXP-89 Hardening: Handle listen errors (e.g., port in use)
        httpServer.on('error', (err) => {
            reject(err);
        });
    });
}

// Main function
async function main() {
    // packageJson already imported at top

    // Generate and set session ID at startup if not already set
    if (!process.env.MCP_SESSION_ID) {
        process.env.MCP_SESSION_ID = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        console.error(`[MCP SERVER] Session ID generated: ${process.env.MCP_SESSION_ID}`);
    }

    // Create server instance
    server = new Server(
        {
            name: Config.PROJECT.NAME,
            version: packageJson.version
        },
        {
            capabilities: {
                tools: {},
                resources: {
                    subscribe: true,
                    listChanged: true
                },
                prompts: {
                    listChanged: true
                }
            }
        }
    );

    // DXP-136: Initialize event system for MCP Resources
    try {
        // Initialize notification sender with server instance
        initializeNotificationSender(server);

        // Initialize resource handlers (sets up event listeners)
        DeploymentResourceHandler.initialize();
        ExportResourceHandler.initialize();
        DownloadResourceHandler.initialize();

        console.error('[MCP SERVER] Event system initialized - resources enabled');
    } catch (error: any) {
        console.error('[MCP SERVER] Failed to initialize event system:', error.message);
        // Continue without events - server should still work
    }

    // DXP-140: Initialize webhook system for Phase 2
    try {
        const webhookManager = getGlobalWebhookManager();
        webhookManager.initialize();
        console.error('[MCP SERVER] Webhook system initialized - HTTP delivery enabled');
    } catch (error: any) {
        console.error('[MCP SERVER] Failed to initialize webhook system:', error.message);
        // Continue without webhooks - server should still work
    }

    // Setup handlers after server creation
    setupHandlers(server);

    // DXP-89: Detect transport mode (stdio for Claude Desktop, http for n8n)
    const transportMode = process.env.DXP_MCP_MODE || 'stdio';

    // DXP-89 Hardening: Validate transport mode
    if (transportMode !== 'stdio' && transportMode !== 'http') {
        throw new Error(`Invalid DXP_MCP_MODE: "${transportMode}". Must be 'stdio' or 'http'.`);
    }

    // DXP-89 Hardening: Validate port number
    const httpPort = parseInt(process.env.DXP_MCP_PORT || '3001', 10);
    if (isNaN(httpPort) || httpPort < 1 || httpPort > 65535) {
        throw new Error(`Invalid DXP_MCP_PORT: "${process.env.DXP_MCP_PORT}". Must be 1-65535.`);
    }

    if (transportMode === 'http') {
        // HTTP mode for n8n integration
        console.error(`[MCP SERVER] Starting in HTTP mode (n8n integration)`);

        // DXP-89 Hardening: Better error handling for port-in-use
        let httpServerInstance;
        try {
            httpServerInstance = await startHttpServer(server, httpPort);
        } catch (error: any) {
            if (error.code === 'EADDRINUSE') {
                console.error(`[MCP SERVER] ERROR: Port ${httpPort} is already in use`);
                console.error(`[MCP SERVER] Try: DXP_MCP_PORT=8080 npm start`);
                process.exit(1);
            }
            throw error;
        }

        // DXP-89 Hardening: Graceful shutdown on SIGTERM/SIGINT
        const gracefulShutdown = (signal: any) => {
            console.error(`[MCP SERVER] ${signal} received, shutting down gracefully...`);
            if (httpServerInstance) {
                (httpServerInstance as any).close(() => {
                    console.error('[MCP SERVER] HTTP server closed');
                    process.exit(0);
                });
                // Force shutdown after 10 seconds if graceful shutdown hangs
                setTimeout(() => {
                    console.error('[MCP SERVER] Force shutdown after timeout');
                    process.exit(1);
                }, 10000);
            } else {
                process.exit(0);
            }
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Initialize telemetry AFTER server starts
        telemetry.initialize();

        // Success message already printed by startHttpServer
        OutputLogger.success(`Jaxon Optimizely DXP MCP Server v${packageJson.version} ready`);
    } else {
        // Default stdio mode for Claude Desktop
        console.error(`[MCP SERVER] Starting in stdio mode (Claude Desktop)`);

        const transport = new StdioServerTransport();

        // Add error handlers for pipe/connection errors (when client disconnects)
        // This prevents the server from crashing when Claude Desktop times out or closes
        const isClientDisconnectError = (err: any) => {
            return err.code === 'EPIPE' ||
                   err.code === 'ECONNRESET' ||
                   err.code === 'ERR_STREAM_WRITE_AFTER_END' ||
                   err.code === 'ERR_STREAM_DESTROYED';
        };

        process.stdout.on('error', (err) => {
            if (isClientDisconnectError(err)) {
                // Client disconnected - this is normal during timeouts or when user closes Claude
                // Don't crash, just exit gracefully (no logging as stdout may be broken)
                process.exit(0);
            } else {
                // Other errors should be logged
                try {
                    console.error('[MCP SERVER] Stdout error:', err);
                } catch (e) {
                    // Can't log, just exit
                    process.exit(1);
                }
            }
        });

        process.stdin.on('error', (err) => {
            if (isClientDisconnectError(err)) {
                // Client disconnected - exit gracefully
                process.exit(0);
            } else {
                try {
                    console.error('[MCP SERVER] Stdin error:', err);
                } catch (e) {
                    process.exit(1);
                }
            }
        });

        await server.connect(transport);

        // NOW we can log safely after connection is established
        OutputLogger.success(`Jaxon Optimizely DXP MCP Server v${packageJson.version} ready`);

        // Initialize telemetry AFTER connection
        telemetry.initialize();
    }

    // Load completed downloads from persistent storage (survives server restarts)
    await DatabaseSimpleTools.loadCompletedDownloads();

    // Check what projects are configured
    try {
        // ProjectTools already imported at top
        const projects = ProjectTools.getConfiguredProjects();
        if (projects.length > 0) {
            const current = ProjectTools.getCurrentProject();
            if (current && current.isSelfHosted) {
                OutputLogger.success(`Self-hosted project detected: ${current.name}`);
            } else if (current) {
                OutputLogger.success(`DXP project detected: ${current.name}`);
            }
        }
    } catch (error: any) {
        // Ignore project detection errors at startup
    }

    // Run version check after connection (if not local development)
    if (shouldCheckVersion) {
        (async () => {
            const updateInfo = await VersionChecker.checkForUpdates();
            const notification = VersionChecker.formatUpdateNotification(updateInfo);
            if (notification) {
                OutputLogger.debug(notification);
            }
        })();
    } else {
        OutputLogger.debug('Running in local development mode - skipping version check');
    }
}

// Only run main if this is the main module (not when required)
if (require.main === module) {
    // Add global error handlers for client disconnect errors
    // This catches any disconnect errors that escape local handlers
    const isClientDisconnectError = (error: any) => {
        return error?.code === 'EPIPE' ||
               error?.code === 'ECONNRESET' ||
               error?.code === 'ERR_STREAM_WRITE_AFTER_END' ||
               error?.code === 'ERR_STREAM_DESTROYED';
    };

    process.on('uncaughtException', (error) => {
        if (isClientDisconnectError(error)) {
            // Client disconnected - exit gracefully without logging
            // (stdout may be broken, so logging could cause another error)
            process.exit(0);
        } else {
            // Other uncaught exceptions should be logged and crash
            try {
                console.error('[MCP SERVER] Uncaught exception:', error);
            } catch (e) {
                // Can't log, just exit with error code
            }
            process.exit(1);
        }
    });

    process.on('unhandledRejection', (reason, _promise) => {
        // Check if the rejection is due to client disconnect
        if (isClientDisconnectError(reason)) {
            process.exit(0);
        }
        try {
            console.error('[MCP SERVER] Unhandled promise rejection:', reason);
        } catch (e) {
            // Can't log, continue
        }
        // Don't exit on unhandled rejections - just log them
    });

    // Handle errors
    main().catch((error) => {
        console.error('❌ Failed to start MCP server');
        console.error('Error:', error.message || error);
        if (error.stack) {
            console.error('Stack:', error.stack);
        }
        process.exit(1);
    });
}

// Export for testing
module.exports = {
    commandHandlers
};