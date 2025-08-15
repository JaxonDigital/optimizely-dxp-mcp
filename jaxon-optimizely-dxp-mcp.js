#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server
 * Built with official @modelcontextprotocol for full Claude compatibility
 * 
 * Built by Jaxon Digital - Optimizely Gold Partner
 * https://www.jaxondigital.com
 */

// Load environment variables from .env file if it exists
const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
}

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
    ListToolsRequestSchema,
    CallToolRequestSchema 
} = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');

// Import existing modules
const libPath = path.join(__dirname, 'lib');
const Config = require(path.join(libPath, 'config'));
const { 
    DatabaseTools, 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools,
    ContentTools,
    DeploymentHelperTools 
} = require(path.join(libPath, 'tools'));
const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
const MonitoringTools = require(path.join(libPath, 'tools', 'monitoring-tools'));
const VersionChecker = require(path.join(libPath, 'version-check'));
const { getTelemetry } = require(path.join(libPath, 'telemetry'));

// Initialize telemetry
const telemetry = getTelemetry();

// Check for updates on startup (async, non-blocking)
(async () => {
    const updateInfo = await VersionChecker.checkForUpdates();
    const notification = VersionChecker.formatUpdateNotification(updateInfo);
    if (notification) {
        console.error(notification);
    }
})();

// Define Zod schemas for each tool
const schemas = {
    // Project management
    get_project_info: z.object({
        projectId: z.string().optional(),
        projectName: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    list_projects: z.object({}),
    
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
    
    get_analytics: z.object({}),
    
    get_rate_limit_status: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional()
    }),
    
    get_cache_status: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        action: z.enum(['status', 'clear']).optional().default('status')
    }),
    
    // Database operations
    export_database: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        databaseName: z.enum(['epicms', 'epicommerce']),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    check_export_status: z.object({
        exportId: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        databaseName: z.enum(['epicms', 'epicommerce']),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Deployment operations
    list_deployments: z.object({
        limit: z.number().min(1).max(100).optional().default(20),
        offset: z.number().min(0).optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    start_deployment: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        deploymentType: z.enum(['code', 'content', 'all']).optional(),
        sourceApps: z.array(z.string()).optional(),
        includeBlob: z.boolean().optional(),
        includeDatabase: z.boolean().optional(),
        directDeploy: z.boolean().optional().default(false),
        useMaintenancePage: z.boolean().optional().default(false),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    get_deployment_status: z.object({
        deploymentId: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    complete_deployment: z.object({
        deploymentId: z.string(),
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
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    generate_storage_sas_link: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        containerName: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        permissions: z.enum(['Read', 'Write', 'Delete', 'List']).optional().default('Read'),
        expiryHours: z.number().optional().default(24),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Package operations
    upload_deployment_package: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        packagePath: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    deploy_package_and_start: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        packagePath: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        directDeploy: z.boolean().optional().default(true),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Logging operations
    get_edge_logs: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        hours: z.number().optional().default(1),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Content operations
    copy_content: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Deployment helper operations
    analyze_package: z.object({
        packagePath: z.string()
    }),
    
    prepare_deployment_package: z.object({
        sourcePath: z.string(),
        outputPath: z.string().optional(),
        excludePatterns: z.array(z.string()).optional()
    }),
    
    generate_sas_upload_url: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    split_package: z.object({
        packagePath: z.string(),
        chunkSizeMB: z.number().optional().default(50)
    })
};

// Special handler for project info - now delegated to ProjectTools
function handleProjectInfo(args) {
    return ProjectTools.getProjectInfo(args);
}

// Legacy project info handler (for reference)
function handleProjectInfoLegacy() {
    const projectId = process.env.OPTIMIZELY_PROJECT_ID;
    const projectName = process.env.OPTIMIZELY_PROJECT_NAME;
    const hasApiKey = !!process.env.OPTIMIZELY_API_KEY;
    const hasApiSecret = !!process.env.OPTIMIZELY_API_SECRET;
    const isConfigured = projectId && hasApiKey && hasApiSecret;
    
    let infoText = `📊 **Optimizely DXP Project Information**\n\n`;
    
    if (isConfigured) {
        if (projectName) {
            infoText += `✅ **Active Project: ${projectName}**\n\n`;
        } else {
            infoText += `✅ **Project is configured and ready!**\n\n`;
        }
        
        infoText += `**Project Details:**\n`;
        
        if (projectName) {
            infoText += `• Name: **${projectName}**\n`;
        }
        
        infoText += `• Project ID: \`${projectId}\`\n` +
                   `• API Key: ✅ Configured\n` +
                   `• API Secret: ✅ Configured\n`;
    } else {
        infoText += `⚠️ **Configuration Required**\n\n` +
                   `**Current Status:**\n` +
                   `• Project ID: ${projectId ? `\`${projectId}\`` : '❌ Not configured'}\n` +
                   `• API Key: ${hasApiKey ? '✅ Configured' : '❌ Not configured'}\n` +
                   `• API Secret: ${hasApiSecret ? '✅ Configured' : '❌ Not configured'}\n\n`;
        
        if (!projectId || !hasApiKey || !hasApiSecret) {
            infoText += `**To configure, you have two options:**\n\n` +
                       `**Option 1: Pass credentials with each tool call**\n` +
                       `When using any tool, provide:\n` +
                       `• projectId: "your-project-id"\n` +
                       `• apiKey: "your-api-key"\n` +
                       `• apiSecret: "your-api-secret"\n\n` +
                       `**Option 2: Configure environment variables (recommended)**\n` +
                       `Edit your MCP client config and add:\n\n` +
                       `\`\`\`json\n` +
                       `"env": {\n` +
                       `  "OPTIMIZELY_PROJECT_ID": "your-project-id",\n` +
                       `  "OPTIMIZELY_API_KEY": "your-api-key",\n` +
                       `  "OPTIMIZELY_API_SECRET": "your-api-secret"\n` +
                       `}\n` +
                       `\`\`\`\n\n` +
                       `Then restart your MCP client.\n`;
        }
    }
    
    infoText += `\nBuilt by Jaxon Digital - Optimizely Gold Partner`;
    
    return {
        result: {
            content: [{
                type: 'text',
                text: infoText
            }]
        }
    };
}

/**
 * Handle analytics request
 */
function handleGetAnalytics(args) {
    try {
        const report = telemetry.getAnalyticsReport();
        
        if (!report) {
            return {
                result: {
                    content: [{
                        type: 'text',
                        text: `📊 **Analytics Report**\n\n` +
                              `❌ **Telemetry Disabled**\n\n` +
                              `Analytics are currently disabled. To enable:\n\n` +
                              `**Option 1:** Set environment variable:\n` +
                              `\`OPTIMIZELY_MCP_TELEMETRY=true\`\n\n` +
                              `**Option 2:** Add to Claude Desktop config:\n` +
                              `\`\`\`json\n` +
                              `{\n` +
                              `  "mcpServers": {\n` +
                              `    "jaxon-optimizely-dxp": {\n` +
                              `      "command": "jaxon-optimizely-dxp-mcp",\n` +
                              `      "env": {\n` +
                              `        "OPTIMIZELY_MCP_TELEMETRY": "true"\n` +
                              `      }\n` +
                              `    }\n` +
                              `  }\n` +
                              `}\n` +
                              `\`\`\`\n\n` +
                              `**Privacy:** All telemetry is anonymous and helps improve the tool.\n\n` +
                              `📧 Need help? Contact us at support@jaxondigital.com`
                    }]
                }
            };
        }
        
        const uptimeHours = (report.uptime / (1000 * 60 * 60)).toFixed(1);
        
        let analyticsText = `📊 **Analytics Report**\n\n`;
        analyticsText += `✅ **Session Information**\n`;
        analyticsText += `• Session ID: \`${report.sessionId}\`\n`;
        analyticsText += `• Uptime: ${uptimeHours} hours\n\n`;
        
        analyticsText += `🔧 **Tool Usage**\n`;
        analyticsText += `• Total Tools Used: ${report.tools.count}\n`;
        analyticsText += `• Total Operations: ${report.tools.totalUsage}\n`;
        
        if (report.tools.top.length > 0) {
            analyticsText += `• Top Tools:\n`;
            report.tools.top.forEach(tool => {
                const envs = tool.environments.length > 0 ? ` (${tool.environments.join(', ')})` : '';
                analyticsText += `  - ${tool.name}: ${tool.count} uses${envs}\n`;
            });
        }
        analyticsText += '\n';
        
        if (report.errors.count > 0) {
            analyticsText += `⚠️ **Error Summary**\n`;
            analyticsText += `• Total Errors: ${report.errors.count}\n`;
            analyticsText += `• Error Categories:\n`;
            Object.entries(report.errors.categories).forEach(([category, count]) => {
                analyticsText += `  - ${category}: ${count}\n`;
            });
            analyticsText += '\n';
        }
        
        if (Object.keys(report.performance).length > 0) {
            analyticsText += `⚡ **Performance**\n`;
            Object.entries(report.performance).forEach(([operation, stats]) => {
                analyticsText += `• ${operation}: ${stats.avgDuration}ms avg (${stats.operations} ops)\n`;
            });
            analyticsText += '\n';
        }
        
        analyticsText += `🔒 **Privacy Notes**\n`;
        analyticsText += `• All data is anonymous\n`;
        analyticsText += `• No sensitive information is collected\n`;
        analyticsText += `• Data helps improve performance and reliability\n`;
        analyticsText += `• You can disable with \`OPTIMIZELY_MCP_TELEMETRY=false\`\n\n`;
        
        analyticsText += `📧 Need help? Contact us at support@jaxondigital.com`;
        
        return {
            result: {
                content: [{
                    type: 'text',
                    text: analyticsText
                }]
            }
        };
        
    } catch (error) {
        console.error('Analytics error:', error);
        return {
            error: `Failed to generate analytics report: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
        };
    }
}

/**
 * Handle rate limit status request
 */
function handleGetRateLimitStatus(args) {
    try {
        const PowerShellHelper = require(path.join(libPath, 'powershell-helper'));
        const rateLimiter = PowerShellHelper.getRateLimiter();
        
        // Get project credentials for the status check
        let projectId = args.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        
        // If project name provided, try to resolve it
        if (args.projectName && !projectId) {
            const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
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
        
        const minutePercent = ((status.requestsLastMinute / status.maxRequestsPerMinute) * 100).toFixed(1);
        const hourPercent = ((status.requestsLastHour / status.maxRequestsPerHour) * 100).toFixed(1);
        statusText += `• Minute usage: ${minutePercent}%\n`;
        statusText += `• Hour usage: ${hourPercent}%\n\n`;
        
        if (status.isThrottled) {
            const waitTime = Math.ceil((status.throttleRetryAfter - Date.now()) / 1000);
            statusText += `🚨 **Currently Throttled**\n`;
            statusText += `• Status: API returned 429 (Too Many Requests)\n`;
            statusText += `• Wait time: ${waitTime} seconds\n`;
            statusText += `• Retry after: ${new Date(status.throttleRetryAfter).toISOString()}\n\n`;
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
        
    } catch (error) {
        console.error('Rate limit status error:', error);
        return {
            error: `Failed to get rate limit status: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
        };
    }
}

/**
 * Handle cache status request
 */
function handleGetCacheStatus(args) {
    try {
        const PowerShellHelper = require(path.join(libPath, 'powershell-helper'));
        
        // Get project credentials for the status check
        let projectId = args.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        
        // If project name provided, try to resolve it
        if (args.projectName && !projectId) {
            const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
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
        
    } catch (error) {
        console.error('Cache status error:', error);
        return {
            error: `Failed to get cache status: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
        };
    }
}

// Command handler map
const commandHandlers = {
    'get_project_info': handleProjectInfo,
    'list_projects': (args) => ProjectTools.listProjects(args),
    'get_support': (args) => ProjectTools.handleGetSupport(args),
    'list_monitors': (args) => MonitoringTools.listMonitors(args),
    'update_monitoring_interval': (args) => MonitoringTools.updateMonitoringInterval(args),
    'stop_monitoring': (args) => MonitoringTools.stopMonitoring(args),
    'get_monitoring_stats': (args) => MonitoringTools.getMonitoringStats(args),
    'get_analytics': handleGetAnalytics,
    'get_rate_limit_status': handleGetRateLimitStatus,
    'get_cache_status': handleGetCacheStatus,
    'export_database': (args) => DatabaseTools.handleExportDatabase(args),
    'check_export_status': (args) => DatabaseTools.handleCheckExportStatus(args),
    'list_deployments': (args) => DeploymentTools.handleListDeployments(args),
    'start_deployment': (args) => DeploymentTools.handleStartDeployment(args),
    'get_deployment_status': (args) => DeploymentTools.handleGetDeploymentStatus(args),
    'complete_deployment': (args) => DeploymentTools.handleCompleteDeployment(args),
    'reset_deployment': (args) => DeploymentTools.handleResetDeployment(args),
    'list_storage_containers': (args) => StorageTools.handleListStorageContainers(args),
    'generate_storage_sas_link': (args) => StorageTools.handleGenerateStorageSasLink(args),
    'upload_deployment_package': (args) => PackageTools.handleUploadDeploymentPackage(args),
    'deploy_package_and_start': (args) => PackageTools.handleDeployPackageAndStart(args),
    'get_edge_logs': (args) => LoggingTools.handleGetEdgeLogs(args),
    'copy_content': (args) => ContentTools.handleCopyContent(args),
    'analyze_package': (args) => DeploymentHelperTools.handleAnalyzePackage(args),
    'prepare_deployment_package': (args) => DeploymentHelperTools.handlePrepareDeploymentPackage(args),
    'generate_sas_upload_url': (args) => DeploymentHelperTools.handleGenerateSasUploadUrl(args),
    'split_package': (args) => DeploymentHelperTools.handleSplitPackage(args)
};

// Tool definitions
const toolDefinitions = Object.keys(schemas).map(name => {
    const descriptions = {
        'get_project_info': 'Get current Optimizely project configuration details or info for a specific project',
        'list_projects': 'List all configured Optimizely projects',
        'get_support': 'Get comprehensive support information and contact details',
        'list_monitors': 'List active deployment monitors and monitoring statistics',
        'update_monitoring_interval': 'Update the monitoring frequency for active deployment monitors',
        'stop_monitoring': 'Stop monitoring for specific deployments or all active monitors',
        'get_monitoring_stats': 'Get detailed monitoring system statistics and performance metrics',
        'get_analytics': 'View anonymous usage analytics and performance metrics',
        'get_rate_limit_status': 'View current rate limiting status and usage quotas',
        'get_cache_status': 'View cache performance statistics or clear cache entries',
        'export_database': 'Export database from an Optimizely DXP environment (uses configured project)',
        'check_export_status': 'Check the status of a database export',
        'list_deployments': 'List all deployments for the configured project',
        'start_deployment': 'Start deployment between environments. Smart defaults: Upward (Int→Pre, Pre→Prod) deploys CODE; Downward (Prod→Pre/Int) copies CONTENT. Override with deploymentType: "code", "content", or "all". Commerce: set sourceApps: ["cms", "commerce"]',
        'get_deployment_status': 'Get the status of a deployment',
        'complete_deployment': 'Complete a deployment that is in Verification state',
        'reset_deployment': 'Reset/rollback a deployment',
        'list_storage_containers': 'List storage containers for an environment (uses configured project)',
        'generate_storage_sas_link': 'Generate SAS link for storage container',
        'upload_deployment_package': 'Upload a deployment package',
        'deploy_package_and_start': 'Deploy a package and start deployment',
        'get_edge_logs': 'Get edge/CDN logs for entire project (BETA - requires enablement by Optimizely support)',
        'copy_content': 'Copy content between environments (uses configured project)',
        'analyze_package': 'Analyze deployment package size and provide upload recommendations',
        'prepare_deployment_package': 'Prepare optimized deployment package from source directory',
        'generate_sas_upload_url': 'Generate SAS URL for direct package upload (best for large files)',
        'split_package': 'Split large package into smaller chunks for easier upload'
    };
    
    return {
        name,
        description: descriptions[name],
        inputSchema: schemas[name]
    };
});

// Create server instance
const server = new Server(
    {
        name: Config.PROJECT.NAME,
        version: require('./package.json').version
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

// Handle tools/list request
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: toolDefinitions.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: zodToJsonSchema(tool.inputSchema)
        }))
    };
});

// Handle tools/call request
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params;
    
    // Validate input with Zod schema
    const schema = schemas[toolName];
    if (!schema) {
        throw new Error(`Unknown tool: ${toolName}`);
    }
    
    let validatedArgs;
    try {
        validatedArgs = schema.parse(args);
    } catch (error) {
        return {
            content: [{ 
                type: 'text', 
                text: `❌ Invalid arguments: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com` 
            }],
            isError: true
        };
    }
    
    // Auto-register project when credentials are provided inline (BEFORE credential injection)
    // This ensures projects are saved even when used with get_project_info
    if (validatedArgs.projectName && validatedArgs.projectId && 
        validatedArgs.apiKey && validatedArgs.apiSecret) {
        // Check if this is a new project or update
        const existingProjects = ProjectTools.getConfiguredProjects();
        const isNewProject = !existingProjects.find(p => 
            p.id === validatedArgs.projectId || 
            p.name === validatedArgs.projectName
        );
        
        // Add or update the project
        ProjectTools.addProject({
            name: validatedArgs.projectName,
            id: validatedArgs.projectId,
            apiKey: validatedArgs.apiKey,
            apiSecret: validatedArgs.apiSecret,
            environments: ['Integration', 'Preproduction', 'Production'],
            isDefault: false
        });
        
        // Log registration for debugging (to stderr)
        if (isNewProject) {
            console.error(`Registered new project: ${validatedArgs.projectName}`);
        } else {
            console.error(`Updated project: ${validatedArgs.projectName}`);
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
        }
    }
    
    // Inject environment credentials if not provided and no inline credentials
    if (!validatedArgs.projectId && !validatedArgs.apiKey && !validatedArgs.apiSecret) {
        const defaultCreds = ProjectTools.getProjectCredentials();
        validatedArgs.projectId = defaultCreds.projectId || process.env.OPTIMIZELY_PROJECT_ID;
        validatedArgs.apiKey = defaultCreds.apiKey || process.env.OPTIMIZELY_API_KEY;
        validatedArgs.apiSecret = defaultCreds.apiSecret || process.env.OPTIMIZELY_API_SECRET;
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
    if (validatedArgs.projectId && toolName !== 'get_project_info') {
        console.error(`Using project: ${validatedArgs.projectId}`);
    }
    
    // Check for missing credentials (except for project management tools)
    if (toolName !== 'get_project_info' && toolName !== 'list_projects') {
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
                    text: `❌ **Missing Required Credentials**\n\n` +
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
                          `Run the \`get_project_info\` tool for detailed setup instructions.\n\n` +
                          `💡 **Tip:** Use \`list_projects\` to see all registered projects.`
                }],
                isError: true
            };
        }
    }
    
    // Execute tool using handler map
    const startTime = Date.now();
    
    try {
        const handler = commandHandlers[toolName];
        if (!handler) {
            throw new Error(`Tool ${toolName} not implemented`);
        }
        
        // Track tool usage
        telemetry.trackToolUsage(toolName, {
            environment: validatedArgs.environment,
            hasCredentials: !!(validatedArgs.apiKey && validatedArgs.projectId)
        });
        
        const result = await handler(validatedArgs);
        
        // Track performance
        const duration = Date.now() - startTime;
        telemetry.trackPerformance(`tool_${toolName}`, duration, {
            environment: validatedArgs.environment,
            success: !result.error
        });
        
        // Handle response format
        if (result.error) {
            // Track error
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
        
        // Track deployment pattern if applicable
        if (toolName === 'start_deployment' && validatedArgs.sourceEnvironment && validatedArgs.targetEnvironment) {
            telemetry.trackDeployment(validatedArgs.sourceEnvironment, validatedArgs.targetEnvironment, {
                includeCode: validatedArgs.deploymentType !== 'content',
                includeContent: validatedArgs.deploymentType !== 'code',
                directDeploy: validatedArgs.directDeploy,
                useMaintenancePage: validatedArgs.useMaintenancePage
            });
        }
        
        // Format successful response
        const responseText = result.result?.content?.[0]?.text || 
                           JSON.stringify(result.result, null, 2);
        
        return {
            content: [{ 
                type: 'text', 
                text: responseText 
            }]
        };
        
    } catch (error) {
        console.error(`Error executing tool ${toolName}:`, error);
        
        // Track error
        const duration = Date.now() - startTime;
        telemetry.trackError(error, {
            tool: toolName,
            operation: 'tool_execution',
            environment: validatedArgs.environment
        });
        telemetry.trackPerformance(`tool_${toolName}`, duration, {
            environment: validatedArgs.environment,
            success: false
        });
        
        return {
            content: [{ 
                type: 'text', 
                text: `❌ Error: ${error.message}` 
            }],
            isError: true
        };
    }
});

// Main function
async function main() {
    // Create transport
    const transport = new StdioServerTransport();
    
    // Connect server to transport
    await server.connect(transport);
    
    // Log to stderr to avoid polluting stdout
    console.error('Jaxon Optimizely DXP MCP Server started');
}

// Handle errors
main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});