#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server - Complete Version
 * Built from working minimal-v2 with all tools added
 */

// TEMPORARY: Disable telemetry until we fix it properly
process.env.OPTIMIZELY_MCP_TELEMETRY = 'false';
process.env.MCP_TELEMETRY = 'false';

const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if it exists (silently)
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '.env')
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      }
    });
    break;
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

const libPath = path.join(__dirname, '..', 'lib');
const Config = require(path.join(libPath, 'config'));
const ErrorHandler = require(path.join(libPath, 'error-handler'));
const ResponseBuilder = require(path.join(libPath, 'response-builder'));
const OutputLogger = require(path.join(libPath, 'output-logger'));

// Import all tool modules
const { 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools,
    ContentTools,
    DeploymentHelperTools 
} = require(path.join(libPath, 'tools'));
const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
const MonitoringTools = require(path.join(libPath, 'tools', 'monitoring-tools'));
const ConnectionTestTools = require(path.join(libPath, 'tools', 'connection-test-tools'));
const SetupWizard = require(path.join(libPath, 'tools', 'setup-wizard'));
const PermissionChecker = require(path.join(libPath, 'tools', 'permission-checker'));
const SimpleTools = require(path.join(libPath, 'tools', 'simple-tools'));
const DatabaseSimpleTools = require(path.join(libPath, 'tools', 'database-simple-tools'));
const SettingsTools = require(path.join(libPath, 'tools', 'settings-tools'));
const BlobDownloadTools = require(path.join(libPath, 'tools', 'blob-download-tools'));
const LogDownloadTools = require(path.join(libPath, 'tools', 'log-download-tools'));
const DownloadManagementTools = require(path.join(libPath, 'tools', 'download-management-tools'));
const ProjectSwitchTool = require(path.join(libPath, 'tools', 'project-switch-tool'));
const VersionChecker = require(path.join(libPath, 'version-check'));

// Helper function to normalize environment names
function normalizeEnvironmentName(env) {
    if (!env) return env;
    
    const envUpper = env.toUpperCase();
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

// Define all tool schemas
const schemas = {
    // Simple Commands
    status: z.object({
        project: z.string().optional(),
        environment: z.string().optional()
    }),
    
    quick: z.object({
        project: z.string().optional()
    }),
    
    // Database operations
    export_database: z.object({
        environment: z.string().optional(),
        project: z.string().optional(),
        databaseName: z.string().optional(),
        dryRun: z.boolean().optional(),
        autoDownload: z.boolean().optional(),
        downloadPath: z.string().optional(),
        forceNew: z.boolean().optional(),
        skipConfirmation: z.boolean().optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        retentionHours: z.number().optional()
    }),
    
    check_export_status: z.object({
        exportId: z.string().optional(),
        latest: z.boolean().optional(),
        project: z.string().optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    list_exports: z.object({
        limit: z.number().optional(),
        project: z.string().optional()
    }),
    
    // Deployment operations
    list_deployments: z.object({
        limit: z.number().optional(),
        offset: z.number().optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    start_deployment: z.object({
        sourceEnvironment: environmentSchema,
        targetEnvironment: environmentSchema,
        deploymentType: z.enum(['code', 'content', 'all']).optional(),
        directDeploy: z.boolean().optional(),
        includeBlob: z.boolean().optional(),
        includeDatabase: z.boolean().optional(),
        sourceApps: z.array(z.string()).optional(),
        useMaintenancePage: z.boolean().optional(),
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
    
    // Connection testing
    test_connection: z.object({
        project: z.string().optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    health_check: z.object({
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    setup_wizard: z.object({
        skipChecks: z.boolean().optional(),
        autoFix: z.boolean().optional()
    }),
    
    // Add more schemas as needed...
};

// Tool descriptions
const descriptions = {
    status: '💎 Intelligent status overview showing what matters right now',
    quick: '⚡ Ultra-fast status check - just the essentials',
    export_database: '💾 Export database from any environment with smart defaults and automatic monitoring (defaults to production for safety). Auto-download enabled by default.',
    check_export_status: '🔍 Primary export status checker with auto-download capability. Checks active exports first, then latest export.',
    list_exports: '📋 List recent database exports with status',
    list_deployments: 'List all deployments for the configured project',
    start_deployment: 'Start deployment between environments. Smart defaults: Upward (Int→Pre, Pre→Prod) deploys CODE; Downward (Prod→Pre/Int) copies CONTENT. Override with deploymentType: "code", "content", or "all". Commerce: set sourceApps: ["cms", "commerce"]',
    get_deployment_status: 'Get the status of a deployment',
    complete_deployment: 'Complete a deployment that is in Verification state',
    reset_deployment: 'Reset/rollback a deployment',
    test_connection: '🔍 Test your MCP setup and validate configuration (run this first!)',
    health_check: 'Quick health check of MCP status (minimal output)',
    setup_wizard: '🧙 Interactive setup wizard for first-time configuration',
    // Add more descriptions...
};

// Tool handlers
const handlers = {
    status: SimpleTools.handleStatus,
    quick: SimpleTools.handleQuick,
    export_database: DatabaseSimpleTools.handleExportDatabase,
    check_export_status: DatabaseSimpleTools.handleCheckExportStatus,
    list_exports: DatabaseSimpleTools.handleListExports,
    list_deployments: DeploymentTools.handleListDeployments,
    start_deployment: DeploymentTools.handleStartDeployment,
    get_deployment_status: DeploymentTools.handleGetDeploymentStatus,
    complete_deployment: DeploymentTools.handleCompleteDeployment,
    reset_deployment: DeploymentTools.handleResetDeployment,
    test_connection: ConnectionTestTools.handleTestConnection,
    health_check: ConnectionTestTools.handleHealthCheck,
    setup_wizard: SetupWizard.handleSetupWizard,
    // Add more handlers...
};

// Main function
async function main() {
    try {
        const pkg = require(path.join(__dirname, '..', 'package.json'));
        
        // Create server inside main (like progressive test)
        const server = new Server(
            {
                name: Config.PROJECT.NAME,
                version: pkg.version
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {}
                }
            }
        );
        
        // Add handlers AFTER server creation
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: Object.keys(schemas).map(name => ({
                    name,
                    description: descriptions[name] || name,
                    inputSchema: zodToJsonSchema(schemas[name])
                }))
            };
        });
        
        server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return { resources: [] };
        });
        
        server.setRequestHandler(ListPromptsRequestSchema, async () => {
            return { prompts: [] };
        });
        
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name: toolName, arguments: args } = request.params;
            
            try {
                // Validate with schema if available
                const schema = schemas[toolName];
                let validatedArgs = args || {};
                
                if (schema) {
                    validatedArgs = schema.parse(validatedArgs);
                }
                
                // Get handler
                const handler = handlers[toolName];
                if (!handler) {
                    return ResponseBuilder.error(`Unknown tool: ${toolName}`);
                }
                
                // Execute handler
                const result = await handler(validatedArgs);
                return result;
                
            } catch (error) {
                if (error.name === 'ZodError') {
                    return ResponseBuilder.error(`Invalid arguments: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
                }
                return ResponseBuilder.error(error.message);
            }
        });
        
        // Create transport
        const transport = new StdioServerTransport();
        
        // Connect
        await server.connect(transport);
        
        // Success message after connection
        OutputLogger.success(`Jaxon Optimizely DXP MCP Server v${pkg.version} ready`);
        
        // Check PowerShell after connection
        try {
            const { getPowerShellDetector } = require(path.join(libPath, 'powershell-detector'));
            const detector = getPowerShellDetector();
            await detector.getCommand();
            // Silent success
        } catch (error) {
            OutputLogger.warn('PowerShell not detected - some features may not work');
        }
        
        // Check for updates if not local development
        const isLocalDevelopment = () => {
            const rootDir = path.join(__dirname, '..');
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
        
        if (!isLocalDevelopment()) {
            (async () => {
                const updateInfo = await VersionChecker.checkForUpdates();
                const notification = VersionChecker.formatUpdateNotification(updateInfo);
                if (notification) {
                    OutputLogger.debug(notification);
                }
            })();
        }
        
    } catch (error) {
        // Silent exit on error
        process.exit(1);
    }
}

// Run main
main();