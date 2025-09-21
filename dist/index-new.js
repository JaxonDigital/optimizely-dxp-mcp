#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server
 * Refactored to fix connection issues
 */

// Core Node.js modules
const fs = require('fs');
const path = require('path');

// Silent .env loading
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

// MCP SDK imports
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

// Local imports
const libPath = path.join(__dirname, '..', 'lib');
const Config = require(path.join(libPath, 'config'));
const ErrorHandler = require(path.join(libPath, 'error-handler'));
const ResponseBuilder = require(path.join(libPath, 'response-builder'));
const OutputLogger = require(path.join(libPath, 'output-logger'));

// Import all tools
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
const { getTelemetry } = require(path.join(libPath, 'telemetry'));

// Initialize telemetry (safe - only uses console.error)
const telemetry = getTelemetry();

// Check if local development
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

const shouldCheckVersion = !isLocalDevelopment();

// Environment name normalization
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

// Tool schemas and handlers will be defined here but NOT executed
const schemas = {
    status: z.object({
        project: z.string().optional(),
        environment: z.string().optional()
    }),
    
    quick: z.object({
        project: z.string().optional()
    }),
    
    test_connection: z.object({
        project: z.string().optional(),
        projectName: z.string().optional(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Add more schemas as needed...
};

const descriptions = {
    status: '💎 Intelligent status overview showing what matters right now',
    quick: '⚡ Ultra-fast status check - just the essentials',
    test_connection: '🔍 Test your MCP setup and validate configuration (run this first!)',
    // Add more descriptions...
};

const handlers = {
    status: SimpleTools.handleStatus,
    quick: SimpleTools.handleQuick,
    test_connection: ConnectionTestTools.handleTestConnection,
    // Add more handlers...
};

// Main function - ALL initialization happens here
async function main() {
    const packageJson = require(path.join(__dirname, '..', 'package.json'));
    
    // Create server instance INSIDE main
    const server = new Server(
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
    
    // Register handlers AFTER server creation
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
            // Validate with schema
            const schema = schemas[toolName];
            if (!schema) {
                return ResponseBuilder.error(`Unknown tool: ${toolName}`);
            }
            
            const validatedArgs = schema.parse(args || {});
            
            // Track telemetry
            telemetry.trackToolCall(toolName, validatedArgs);
            
            // Get handler
            const handler = handlers[toolName];
            if (!handler) {
                return ResponseBuilder.error(`No handler for tool: ${toolName}`);
            }
            
            // Execute handler
            const result = await handler(validatedArgs);
            
            // Track success
            telemetry.trackToolCall(toolName, validatedArgs, 'success');
            
            return result;
        } catch (error) {
            telemetry.trackError(error, { tool: toolName });
            return ResponseBuilder.error(error.message);
        }
    });
    
    // Create transport and connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // NOW we can safely log after connection
    OutputLogger.success(`Jaxon Optimizely DXP MCP Server v${packageJson.version} ready`);
    
    // Check PowerShell after connection
    try {
        const { getPowerShellDetector } = require(path.join(libPath, 'powershell-detector'));
        const detector = getPowerShellDetector();
        await detector.getCommand();
    } catch (error) {
        OutputLogger.warn('PowerShell not detected - some features may not work');
    }
    
    // Version check after connection
    if (shouldCheckVersion) {
        (async () => {
            const updateInfo = await VersionChecker.checkForUpdates();
            const notification = VersionChecker.formatUpdateNotification(updateInfo);
            if (notification) {
                OutputLogger.debug(notification);
            }
        })();
    }
}

// Run main
if (require.main === module) {
    main().catch((error) => {
        // Silent exit - connection failed
        process.exit(1);
    });
}

// Export for testing
module.exports = { main };