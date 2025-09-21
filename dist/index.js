#!/usr/bin/env node

console.error('[MCP SERVER] Starting up at', new Date().toISOString());
console.error('[MCP SERVER] Version check - includes self-hosted fixes');

/**
 * Jaxon Digital Optimizely DXP MCP Server
 * Built with official @modelcontextprotocol for full Claude compatibility
 * 
 * Built by Jaxon Digital - Optimizely Gold Partner
 * https://www.jaxondigital.com
 */

// Telemetry is enabled by default (opt-out model)
// Users can disable by setting OPTIMIZELY_MCP_TELEMETRY=false in their environment

// Load required modules first
const fs = require('fs');
const path = require('path');

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

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
    ListToolsRequestSchema,
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListPromptsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');

// Import existing modules
const libPath = path.join(__dirname, '..', 'lib');
const Config = require(path.join(libPath, 'config'));
const ErrorHandler = require(path.join(libPath, 'error-handler'));
const ResponseBuilder = require(path.join(libPath, 'response-builder'));
const OutputLogger = require(path.join(libPath, 'output-logger'));
const { 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    ContentTools,
    DeploymentHelperTools 
} = require(path.join(libPath, 'tools'));
const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
const MonitoringTools = require(path.join(libPath, 'tools', 'monitoring-tools'));
const ConnectionTestTools = require(path.join(libPath, 'tools', 'connection-test-tools'));
// SetupWizard removed - functionality merged into ConnectionTestTools
const PermissionChecker = require(path.join(libPath, 'tools', 'permission-checker'));
const SimpleTools = require(path.join(libPath, 'tools', 'simple-tools'));
const DatabaseSimpleTools = require(path.join(libPath, 'tools', 'database-simple-tools'));
const BlobDownloadTools = require(path.join(libPath, 'tools', 'blob-download-tools'));
const LogDownloadTools = require(path.join(libPath, 'tools', 'log-download-tools'));
const DownloadManagementTools = require(path.join(libPath, 'tools', 'download-management-tools'));
const ProjectSwitchTool = require(path.join(libPath, 'tools', 'project-switch-tool'));
const VersionChecker = require(path.join(libPath, 'version-check'));
const AIGuidanceTools = require(path.join(libPath, 'tools', 'ai-guidance-tools'));
const { getTelemetry } = require(path.join(libPath, 'telemetry'));

// Hosting type detection and tool filtering (DXP-23)
const HostingDetector = require(path.join(libPath, 'utils', 'hosting-detector'));
const ToolAvailabilityMatrix = require(path.join(libPath, 'utils', 'tool-availability-matrix'));
const ToolFilter = require(path.join(libPath, 'tool-filter'));
const HostingAwareHelp = require(path.join(libPath, 'tools', 'hosting-aware-help'));

// Initialize telemetry
const telemetry = getTelemetry();

// Check for updates on startup (async, non-blocking) - Only for npm installations
// Detect if we're running from npm global install vs local development
const isLocalDevelopment = () => {
    // Check if we're running from a development directory (has .git, node_modules, etc.)
    const fs = require('fs');
    const currentDir = __dirname;
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
function normalizeEnvironmentName(env) {
    if (!env) return env;
    
    const envUpper = env.toUpperCase();
    
    // Map common abbreviations to full names
    const abbreviations = {
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
    export_database: z.object({
        environment: z.string().optional().describe('Environment to export: prod, staging, integration (default: prod)'),
        project: z.string().optional().describe('Project name (uses default if not specified)'),
        databaseName: z.string().optional().describe('Database name (default: epicms). Can be epicms or epicommerce'),
        dryRun: z.boolean().optional().describe('Preview what will happen without executing'),
        autoDownload: z.boolean().optional().describe('Automatically download export when complete'),
        downloadPath: z.string().optional().describe('Path to save downloaded export (default: ./backups)'),
        forceNew: z.boolean().optional().describe('Force creation of new export even if recent one exists'),
        skipConfirmation: z.boolean().optional().describe('INTERNAL: Bypass size preview - set automatically when user confirms'),
        // Advanced parameters
        projectName: z.string().optional().describe('Alternative to project parameter'),
        projectId: z.string().optional().describe('Project UUID (if providing inline credentials)'),
        apiKey: z.string().optional().describe('API key (if providing inline credentials)'),
        apiSecret: z.string().optional().describe('API secret (if providing inline credentials)'),
        retentionHours: z.number().optional().describe('How long to retain export (default: 168 hours)')
    }),
    
    check_export_status: z.object({
        exportId: z.string().optional().describe('Export ID to check (uses latest if not specified)'),
        project: z.string().optional().describe('Project name (uses default if not specified)'),
        latest: z.boolean().optional().describe('Check status of latest export'),
        projectName: z.string().optional().describe('Alternative to project parameter'),
        projectId: z.string().optional().describe('Project UUID (if providing inline credentials)'),
        apiKey: z.string().optional().describe('API key (if providing inline credentials)'),
        apiSecret: z.string().optional().describe('API secret (if providing inline credentials)')
    }),
    
    list_exports: z.object({
        project: z.string().optional().describe('Project name (uses default if not specified)'),
        limit: z.number().optional().describe('Number of recent exports to show (default: 5)')
    }),
    
    
    check_download_capabilities: z.object({
        downloadPath: z.string().optional().describe('Path to check for download capability (default: uses configured path)')
    }),
    
    
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
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    download_media: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional().default('Production'),
        containerName: z.string().optional().describe('Storage container name (auto-detected if not specified)'),
        downloadPath: z.string().optional().describe('Where to save files (auto-detected based on project)'),
        previewOnly: z.boolean().optional().describe('Show download preview without actually downloading'),
        filter: z.string().optional().describe('Filter for specific files: exact name ("logo.png"), glob pattern ("*.pdf", "2024/*.jpg"), or substring ("report")'),
        incremental: z.boolean().optional().describe('Use smart incremental download (skip unchanged files). Default: true'),
        forceFullDownload: z.boolean().optional().describe('Force full download even if files exist locally. Default: false'),
        skipConfirmation: z.boolean().optional().default(false).describe('Skip confirmation preview (WARNING: downloads immediately without preview). Default: false - always show preview'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    download_assets: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional().default('Production'),
        containerName: z.string().optional().describe('Storage container name (auto-detected if not specified)'),
        downloadPath: z.string().optional().describe('Where to save files (auto-detected based on project)'),
        previewOnly: z.boolean().optional().describe('Show download preview without actually downloading'),
        filter: z.string().optional().describe('Filter for specific files: exact name ("logo.png"), glob pattern ("*.pdf", "2024/*.jpg"), or substring ("report")'),
        incremental: z.boolean().optional().describe('Use smart incremental download (skip unchanged files). Default: true'),
        forceFullDownload: z.boolean().optional().describe('Force full download even if files exist locally. Default: false'),
        skipConfirmation: z.boolean().optional().default(false).describe('Skip confirmation preview (WARNING: downloads immediately without preview). Default: false - always show preview'),
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
        dateFilter: z.string().optional().describe('Filter logs by date (e.g., "2025/08/24" or "2025/08")'),
        // Time-based filtering (use only one)
        secondsBack: z.number().optional().describe('Download logs from the last N seconds (e.g., 30 for last 30 seconds)'),
        minutesBack: z.number().optional().describe('Download logs from the last N minutes (e.g., 15 for last 15 minutes)'),
        hoursBack: z.number().optional().describe('Download logs from the last N hours (e.g., 6 for last 6 hours)'),
        daysBack: z.number().optional().describe('Download logs from the last N days (e.g., 7 for last week)'),
        weeksBack: z.number().optional().describe('Download logs from the last N weeks (e.g., 2 for last 2 weeks)'),
        monthsBack: z.number().optional().describe('Download logs from the last N months (e.g., 3 for last quarter)'),
        yearsBack: z.number().optional().describe('Download logs from the last N years (e.g., 1 for last year)'),
        // Date range filtering (alternative to time-based)
        startDate: z.string().optional().describe('Start date for range filter (e.g., "2025/08/20" or "2025-08-20T14:30")'),
        endDate: z.string().optional().describe('End date for range filter (e.g., "2025/08/26" or "2025-08-26T18:45")'),
        // DXP-20: ISO 8601 datetime support
        startDateTime: z.string().optional().describe('ISO 8601 start datetime (e.g., "2025-09-15T01:00:00-05:00" for 1am EST)'),
        endDateTime: z.string().optional().describe('ISO 8601 end datetime (e.g., "2025-09-15T01:30:00-05:00" for 1:30am EST)'),
        downloadPath: z.string().optional().describe('Where to save log files'),
        previewOnly: z.boolean().optional().describe('Show download preview without actually downloading'),
        skipConfirmation: z.boolean().optional().default(false).describe('Skip confirmation preview (WARNING: downloads immediately without preview). Default: false - always show preview'),
        incremental: z.boolean().optional().describe('Use smart incremental download (skip unchanged files). Default: true'),
        forceFullDownload: z.boolean().optional().describe('Force full download even if files exist locally. Default: false'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
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
    
    // Download management tools
    list_active_downloads: z.object({}),
    
    cancel_download: z.object({
        downloadId: z.string().describe('Download ID to cancel (get from list_active_downloads)')
    }),
    
    cancel_all_downloads: z.object({}),
    
    download_history: z.object({
        limit: z.number().optional().default(10).describe('Number of recent downloads to show')
    }),
    
    get_download_status: z.object({
        downloadId: z.string().describe('Download ID to check status for')
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
        apiSecret: z.string().optional()
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
        makeDefault: z.boolean().optional()
    }),

    list_projects: z.object({}),

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
        environment: environmentSchema,
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
    upload_deployment_package: z.object({
        environment: environmentSchema,
        packagePath: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    deploy_package_and_start: z.object({
        sourceEnvironment: environmentSchema,
        targetEnvironment: environmentSchema,
        packagePath: z.string(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        directDeploy: z.boolean().optional().default(true),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    // Azure DevOps Integration
    deploy_azure_artifact: z.object({
        artifactUrl: z.string().describe('Azure DevOps artifact URL. Supports both Resources API (https://dev.azure.com/org/_apis/resources/Containers/ID/drop) and Build API (https://dev.azure.com/org/project/_apis/build/builds/ID/artifacts)'),
        targetEnvironment: environmentSchema.describe('Target environment for deployment'),
        azureDevOpsPat: z.string().optional().describe('Azure DevOps Personal Access Token (can also use AZURE_DEVOPS_PAT env var)'),
        azureDevOpsOrg: z.string().optional().describe('Azure DevOps organization name (can also use AZURE_DEVOPS_ORG env var)'),
        azureDevOpsProject: z.string().optional().describe('Azure DevOps project name (can also use AZURE_DEVOPS_PROJECT env var)'),
        artifactName: z.string().optional().default('drop').describe('Name of the artifact to download (default: drop). For direct .nupkg download, provide the full filename'),
        cleanupAfterDeploy: z.boolean().optional().default(true).describe('Clean up downloaded artifact after deployment'),
        forceResourcesApi: z.boolean().optional().default(false).describe('Force use of Resources API for direct file downloads (recommended for .nupkg files)'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        directDeploy: z.boolean().optional().default(true),
        useMaintenancePage: z.boolean().optional().default(false),
        zeroDowntimeMode: z.boolean().optional().default(false),
        warmUpUrl: z.string().optional(),
        waitForCompletion: z.boolean().optional().default(false),
        waitTimeoutMinutes: z.number().optional().default(30),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),

    deploy_package_enhanced: z.object({
        packagePath: z.string().optional().describe('Local package file path (for traditional deployment)'),
        artifactUrl: z.string().optional().describe('Azure DevOps artifact URL (for CI/CD integration)'),
        targetEnvironment: environmentSchema.describe('Target environment for deployment'),
        azureDevOpsPat: z.string().optional().describe('Azure DevOps PAT (required for artifact URLs)'),
        artifactName: z.string().optional().default('drop').describe('Artifact name to download'),
        cleanupAfterDeploy: z.boolean().optional().default(true).describe('Clean up temporary files'),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        directDeploy: z.boolean().optional().default(true),
        useMaintenancePage: z.boolean().optional().default(false),
        zeroDowntimeMode: z.boolean().optional().default(false),
        warmUpUrl: z.string().optional(),
        waitForCompletion: z.boolean().optional().default(false),
        waitTimeoutMinutes: z.number().optional().default(30),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    
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
    analyze_package: z.object({
        packagePath: z.string()
    }),
    
    prepare_deployment_package: z.object({
        sourcePath: z.string(),
        outputPath: z.string().optional(),
        excludePatterns: z.array(z.string()).optional()
    }),
    
    generate_sas_upload_url: z.object({
        environment: environmentSchema,
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
function handleDisableTelemetry(args) {
    try {
        // Disable telemetry for this session
        telemetry.enabled = false;
        
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
    } catch (error) {
        const errorMessage = ErrorHandler.formatError(error, { tool: 'disable_telemetry' });
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

function handleEnableTelemetry(args) {
    try {
        // Enable telemetry for this session
        telemetry.enabled = true;
        
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
    } catch (error) {
        const errorMessage = ErrorHandler.formatError(error, { tool: 'enable_telemetry' });
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
        OutputLogger.error('Rate limit status error:', error);
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
        OutputLogger.error('Cache status error:', error);
        return {
            error: `Failed to get cache status: ${error.message}\n\n📧 Need help? Contact us at support@jaxondigital.com`
        };
    }
}

// Project resolution wrapper for tools that require credentials
function withProjectResolution(toolHandler) {
    return async (args) => {
        // Add project resolution if credentials are missing (including self-hosted)
        if (!args.connectionString && (!args.apiKey || !args.apiSecret || !args.projectId)) {
            const projects = ProjectTools.getConfiguredProjects();
            
            if (projects.length === 0) {
                return ResponseBuilder.error('No projects configured. Run "setup_wizard" to configure your first project.');
            }
            
            let projectConfig = null;
            const projectName = args.projectName || args.project; // Handle both parameter names
            
            
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
                id: projectConfig.projectId || projectConfig.id
            });
            
            // Add resolved project credentials to args (handling both DXP and self-hosted)
            if (projectConfig.connectionString) {
                // Self-hosted project
                args.connectionString = args.connectionString || projectConfig.connectionString;
                args.projectName = args.projectName || projectConfig.name;
                args.isSelfHosted = true;
                args.projectType = 'self-hosted';
            } else if (projectConfig.isSelfHosted) {
                // Handle case where isSelfHosted flag is set but connectionString might be missing
                args.isSelfHosted = true;
                args.projectType = 'self-hosted';
                args.connectionString = args.connectionString || projectConfig.connectionString;
                args.projectName = args.projectName || projectConfig.name;
            } else {
                // DXP project
                args.projectId = args.projectId || projectConfig.projectId || projectConfig.id;
                args.apiKey = args.apiKey || projectConfig.apiKey;
                args.apiSecret = args.apiSecret || projectConfig.apiSecret;
                args.projectName = args.projectName || projectConfig.name;
                args.projectType = projectConfig.projectType || 'dxp-paas';
            }
        }
        
        // IMPORTANT: Preserve the environment from the original request
        // The environment is not stored in project config, it's specified per operation
        
        return toolHandler(args);
    };
}

// New verify_access handler that avoids cached module issues
async function handleVerifyAccess(args) {
    // Use the unified PermissionChecker for most accurate results
    return await PermissionChecker.verifyAccess(args);
}

// check_permissions removed - functionality merged into test_connection

// Handle get_version command
async function handleGetVersion(args) {
    try {
        const packageJson = require(path.join(__dirname, '..', 'package.json'));
        const currentVersion = packageJson.version;
        
        let versionText = `📦 **Jaxon Optimizely DXP MCP Server**\n\n`;
        versionText += `**Current Version**: v${currentVersion}\n`;
        versionText += `**Released**: ${packageJson.publishedAt || 'Unknown'}\n\n`;
        
        // Check for updates (with error handling)
        try {
            const versionChecker = require(path.join(libPath, 'version-check'));
            const updateInfo = await versionChecker.checkForUpdates();
            
            if (updateInfo && updateInfo.updateAvailable) {
                versionText += `⚠️ **Update Available**: v${updateInfo.latestVersion}\n`;
                versionText += `📅 Released: ${updateInfo.publishedAt || 'Recently'}\n\n`;
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
            OutputLogger.error('Version check error:', updateError);
            versionText += `ℹ️ **Update check failed** - showing current version only\n`;
        }
        
        versionText += `\n**System Information**:\n`;
        versionText += `• Node.js: ${process.version}\n`;
        versionText += `• Platform: ${process.platform}\n`;
        versionText += `• Architecture: ${process.arch}\n`;
        
        return {
            result: {
                content: [{
                    type: 'text',
                    text: ResponseBuilder.addFooter(versionText)
                }]
            }
        };
    } catch (error) {
        OutputLogger.error('Error in handleGetVersion:', error);
        const errorMessage = ErrorHandler.formatError(error, { tool: 'get_version', args });
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
    'status': (args) => SimpleTools.handleStatus(args),
    'quick': (args) => SimpleTools.handleQuick(args),
    
    // Database Simple Commands - Natural language
    'export_database': withProjectResolution((args) => DatabaseSimpleTools.handleExportDatabase(args)),
    'check_export_status': withProjectResolution((args) => DatabaseSimpleTools.handleExportStatus(args)),
    'list_exports': withProjectResolution((args) => DatabaseSimpleTools.handleListExports(args)),
    'check_download_capabilities': (args) => DatabaseSimpleTools.handleCheckCapabilities(args),
    
    
    // Blob Download Tools
    'download_blobs': withProjectResolution((args) => BlobDownloadTools.handleDownloadBlobs(args)),
    'download_media': withProjectResolution((args) => BlobDownloadTools.handleDownloadBlobs(args)),
    'download_assets': withProjectResolution((args) => BlobDownloadTools.handleDownloadBlobs(args)),
    
    // Log Download Tools
    'download_logs': withProjectResolution((args) => LogDownloadTools.handleDownloadLogs(args)),
    'discover_logs': withProjectResolution((args) => require(path.join(libPath, 'tools', 'log-discovery-tools')).discoverLogContainers(args)),
    'debug_containers': withProjectResolution((args) => require(path.join(libPath, 'tools', 'container-debug-tools')).debugContainers(args)),
    
    // Download Management
    'list_active_downloads': () => DownloadManagementTools.handleListActiveDownloads(),
    'cancel_download': (args) => DownloadManagementTools.handleCancelDownload(args),
    'cancel_all_downloads': () => DownloadManagementTools.handleCancelAllDownloads(),
    'download_history': (args) => DownloadManagementTools.handleDownloadHistory(args),
    'get_download_status': (args) => DownloadManagementTools.handleGetDownloadStatus(args),
    
    // Download Configuration
    'show_download_config': (args) => require(path.join(libPath, 'tools', 'download-config-tools')).handleShowDownloadConfig(args),
    
    // Project Switching
    'switch_project': (args) => ProjectSwitchTool.handleSwitchProject(args),
    
    // Setup & Connection Tools
    'test_connection': withProjectResolution((args) => ConnectionTestTools.testConnection(args)),
    'health_check': (args) => ConnectionTestTools.healthCheck(args),
    'get_version': handleGetVersion,
    'get_ai_guidance': async (args) => AIGuidanceTools.getAIGuidance(args), // Direct handler, no credentials needed
    // 'check_permissions': removed - merged into test_connection
    'verify_access': handleVerifyAccess, // Direct handler, no withProjectResolution to avoid cached module
    'get_project': (args) => ProjectTools.getProject(args),
    'update_project': (args) => ProjectTools.updateProject(args),
    'list_projects': (args) => ProjectTools.listProjects(args),
    'current_project': () => ProjectTools.showCurrentProject(),
    'get_support': (args) => ProjectTools.handleGetSupport(args),
    'list_monitors': (args) => MonitoringTools.listMonitors(args),
    'update_monitoring_interval': (args) => MonitoringTools.updateMonitoringInterval(args),
    'stop_monitoring': (args) => MonitoringTools.stopMonitoring(args),
    'get_monitoring_stats': (args) => MonitoringTools.getMonitoringStats(args),
    'disable_telemetry': handleDisableTelemetry,
    'enable_telemetry': handleEnableTelemetry,
    'get_rate_limit_status': handleGetRateLimitStatus,
    'get_cache_status': handleGetCacheStatus,
    // Legacy database tools are now handled above as aliases
    'list_deployments': withProjectResolution((args) => DeploymentTools.handleListDeployments(args)),
    'start_deployment': withProjectResolution((args) => DeploymentTools.handleStartDeployment(args)),
    'get_deployment_status': withProjectResolution((args) => DeploymentTools.handleGetDeploymentStatus(args)),
    'complete_deployment': withProjectResolution((args) => DeploymentTools.handleCompleteDeployment(args)),
    'reset_deployment': withProjectResolution((args) => DeploymentTools.handleResetDeployment(args)),
    'list_storage_containers': withProjectResolution((args) => StorageTools.handleListStorageContainers(args)),
    'generate_storage_sas_link': withProjectResolution((args) => StorageTools.handleGenerateStorageSasLink(args)),
    'upload_deployment_package': withProjectResolution((args) => PackageTools.handleUploadDeploymentPackage(args)),
    'deploy_package_and_start': withProjectResolution((args) => PackageTools.handleDeployPackageAndStart(args)),
    'deploy_azure_artifact': withProjectResolution((args) => PackageTools.handleDeployAzureArtifact(args)),
    'deploy_package_enhanced': withProjectResolution((args) => PackageTools.handleDeployPackageEnhanced(args)),
    'copy_content': withProjectResolution((args) => ContentTools.handleCopyContent(args)),
    'analyze_package': (args) => DeploymentHelperTools.handleAnalyzePackage(args),
    'prepare_deployment_package': (args) => DeploymentHelperTools.handlePrepareDeploymentPackage(args),
    'generate_sas_upload_url': withProjectResolution((args) => DeploymentHelperTools.handleGenerateSasUploadUrl(args)),
    'split_package': (args) => DeploymentHelperTools.handleSplitPackage(args)
};

// Tool definitions
const toolDefinitions = Object.keys(schemas).sort((a, b) => {
    return a.localeCompare(b);
}).map(name => {
    const descriptions = {
        // AI-Friendly Tools - Goal-oriented interfaces for AI agents
        
        // Simple Commands - Dead Simple with Smart Defaults
        'deploy': '🚀 Deploy to any environment with smart defaults (e.g. "deploy to prod")',
        'status': '📊 Intelligent status overview showing what matters right now',
        'quick': '⚡ Ultra-fast status check - just the essentials',
        
        // Database Export Commands
        'export_database': '💾 Export database from any environment (AI: Requires confirmation before download, see get_ai_guidance)',
        'check_export_status': '🔍 Primary export status checker with auto-download capability. Checks active exports first, then latest export.',
        'list_exports': '📋 List recent database exports with status',
        'check_download_capabilities': '🔧 Check if auto-download is supported in your environment',
        
        
        // Blob Download Tools
        'download_blobs': '📦 Download blobs/media from storage (AI: ALWAYS show preview first, NEVER auto-set skipConfirmation)',
        'download_media': '🖼️ Download media files from storage (AI: REQUIRES user confirmation, see get_ai_guidance)',
        'download_assets': '📁 Download asset files from storage (AI: Preview mandatory, user must confirm)',
        
        // Log Download Tools
        'download_logs': '📊 Download logs (AI: PROACTIVELY call get_ai_guidance BEFORE using this tool - do not wait to be asked)',
        'discover_logs': '🔎 Discover and diagnose log container access across all environments (troubleshoot missing Production logs)',
        'debug_containers': '🐛 Debug raw container listing with detailed PowerShell output (troubleshoot container access issues)',
        
        // Download Management
        'list_active_downloads': '📥 List all active downloads with progress and status',
        'cancel_download': '❌ Cancel a specific download by ID',
        'cancel_all_downloads': '🛑 Cancel all active downloads',
        'download_history': '📜 Show recent download history',
        'get_download_status': '📊 Get detailed status of a specific download',
        
        // Download Configuration
        'show_download_config': '📁 Show current download path configuration and environment variables',
        
        // Project Switching
        'switch_project': '🔄 Switch to a different project (persists for session)',
        
        // Setup & Connection Tools
        'test_connection': '🔍 Test ONE connection - NOT for listing projects! Only use when explicitly asked to TEST',
        'health_check': 'Quick health check of MCP status (minimal output)',
        'get_version': 'Check the current MCP server version and available updates',
        'get_ai_guidance': '🤖 AI should call this first for command routing guidance. Helps map user requests to correct tools.',
        // 'check_permissions': removed - functionality merged into test_connection
        'verify_access': '🔑 Verify environment access permissions',
        'get_project': '📋 Get project information and configuration details (read-only)',
        'update_project': '✏️ Update project configuration: rename, credentials, paths, or settings',
        'list_projects': '📂 LIST ALL PROJECTS - Shows every configured project. This is THE tool for listing projects. Do NOT use test_connection for this.',
        'current_project': '📌 Show the current active project configuration',
        'get_support': 'Get comprehensive support information and contact details',
        'list_monitors': 'List active deployment monitors and monitoring statistics',
        'update_monitoring_interval': 'Update the monitoring frequency for active deployment monitors',
        'stop_monitoring': 'Stop monitoring for specific deployments or all active monitors',
        'get_monitoring_stats': 'Get detailed monitoring system statistics and performance metrics',
        'disable_telemetry': 'Disable anonymous telemetry data collection for this session',
        'enable_telemetry': 'Re-enable anonymous telemetry data collection for this session',
        'get_rate_limit_status': 'View current rate limiting status and usage quotas',
        'get_cache_status': 'View cache performance statistics or clear cache entries',
        // Legacy export tools have been promoted to primary tools above - these lines are no longer needed
        'list_deployments': 'List all deployments for the configured project',
        'start_deployment': 'Start deployment between environments. Smart defaults: Upward (Int→Pre, Pre→Prod) deploys CODE; Downward (Prod→Pre/Int) copies CONTENT. Override with deploymentType: "code", "content", or "all". Commerce: set sourceApps: ["cms", "commerce"]',
        'get_deployment_status': 'Get the status of a deployment',
        'complete_deployment': 'Complete a deployment that is in Verification state',
        'reset_deployment': 'Reset/rollback a deployment',
        'list_storage_containers': 'List storage containers for an environment (uses configured project)',
        'generate_storage_sas_link': 'Generate SAS link for storage container',
        'upload_deployment_package': 'Upload a deployment package',
        'deploy_package_and_start': 'Deploy a package and start deployment',
        'deploy_azure_artifact': '🔗 Deploy directly from Azure DevOps build artifacts - perfect for CI/CD integration',
        'deploy_package_enhanced': '📦 Enhanced package deployment supporting both local files and Azure DevOps artifacts',
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

// Server instance - will be created in main()
let server;

// Handler setup function - will be called from main() after server creation
function setupHandlers(server) {
    // Handle tools/list request - Filter by environment (DXP-23) and user preferences (DXP-42)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        // Get current project to determine hosting type
        const ProjectTools = require('../lib/tools/project-tools');
        const currentProject = ProjectTools.getCurrentProject();

        // Pass project info for hosting type detection
        const projectArgs = currentProject ? {
            projectId: currentProject.projectId,
            apiKey: currentProject.apiKey,
            apiSecret: currentProject.apiSecret,
            connectionString: currentProject.connectionString
        } : {};

        // Get available tools for current hosting type
        const availableToolNames = ToolAvailabilityMatrix.getAvailableTools(projectArgs)
            .map(t => t.name);

        // Filter tool definitions to only include available tools
        let filteredTools = toolDefinitions
            .filter(tool => availableToolNames.includes(tool.name))
            .map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: zodToJsonSchema(tool.inputSchema)
            }));

        // Apply user-configured tool filter (DXP-42)
        filteredTools = ToolFilter.filterTools(filteredTools);

        // Log filter summary if in debug mode
        if (process.env.DEBUG === 'true' || process.env.TOOL_FILTER_DEBUG === 'true') {
            const filterSummary = ToolFilter.getFilterSummary();
            if (filterSummary.enabled) {
                console.error(`[DXP-42] Tool filter active: ${filteredTools.length} tools enabled`);
                console.error(`[DXP-42] Filter patterns:`, filterSummary.patterns);
            }
        }

        return {
            tools: filteredTools
        };
    });

    // Handle resources/list request - Claude Code expects this
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
        // Return empty resources list - we don't expose any resources
        return {
            resources: []
        };
    });

    // Handle prompts/list request - Claude Code expects this
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
        // Return empty prompts list - we don't use prompts
        return {
            prompts: []
        };
    });

    // Handle tools/call request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name: toolName, arguments: args } = request.params;

    // DXP-42: Check if tool is enabled
    if (!ToolFilter.isToolEnabled(toolName)) {
        const filterSummary = ToolFilter.getFilterSummary();
        if (filterSummary.enabled) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ Tool "${toolName}" is not enabled\n\nThis tool has been disabled by the ENABLED_TOOLS configuration.\n\nCurrently enabled patterns: ${filterSummary.patterns.join(', ')}\n\nTo enable this tool, update the ENABLED_TOOLS environment variable.`
                }],
                isError: true
            };
        }
    }

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
        'export_database', 'check_export_status', 'list_exports'
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
        const handler = commandHandlers[toolName];
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

        // Track detailed tool call event (for analytics platform)
        telemetry.trackToolCall(toolName, duration, validatedArgs, !result.error, result.error ? new Error(result.error) : null);
        
        // Track performance (legacy format)
        telemetry.trackPerformance(`tool_${toolName}`, duration, {
            environment: validatedArgs.environment,
            success: !result.error
        });
        
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
                           result.content?.[0]?.text ||
                           JSON.stringify(result, null, 2);
        
        return {
            content: [{ 
                type: 'text', 
                text: responseText 
            }]
        };
        
    } catch (error) {
        console.error(`[CATCH] Caught error in tool ${toolName}:`, error.message);
        console.error(`[CATCH] Error stack:`, error.stack);
        OutputLogger.error(`Error executing tool ${toolName}:`, error);
        
        // Track error
        const duration = Date.now() - startTime;
        
        // Track detailed tool call error event (for analytics platform)
        telemetry.trackToolCall(toolName, duration, validatedArgs, false, error);
        
        // Track error (legacy format)
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
}

// Main function
async function main() {
    const packageJson = require(path.join(__dirname, '..', 'package.json'));
    
    // Create server instance
    server = new Server(
        {
            name: Config.PROJECT.NAME,
            version: packageJson.version
        },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {}
            }
        }
    );
    
    // Setup handlers after server creation
    setupHandlers(server);
    
    // Create and connect transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // NOW we can log safely after connection is established
    OutputLogger.success(`Jaxon Optimizely DXP MCP Server v${packageJson.version} ready`);
    
    // Initialize telemetry AFTER connection
    telemetry.initialize();
    
    // Check what projects are configured
    try {
        const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
        const projects = ProjectTools.getConfiguredProjects();
        if (projects.length > 0) {
            const current = ProjectTools.getCurrentProject();
            if (current && current.isSelfHosted) {
                OutputLogger.success(`Self-hosted project detected: ${current.name}`);
            } else if (current) {
                OutputLogger.success(`DXP project detected: ${current.name}`);
            }
        }
    } catch (error) {
        // Ignore project detection errors at startup
    }
    
    // Check for PowerShell availability (after connection) - only if not self-hosted
    try {
        const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
        const current = ProjectTools.getCurrentProject();
        
        if (!current || !current.isSelfHosted) {
            const { getPowerShellDetector } = require(path.join(libPath, 'powershell-detector'));
            const detector = getPowerShellDetector();
            const psCommand = await detector.getCommand();
            // Silent success - don't log unless there's an issue
        }
    } catch (error) {
        // Log PowerShell warning but don't break the connection
        OutputLogger.warn('PowerShell not detected - some features may not work');
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