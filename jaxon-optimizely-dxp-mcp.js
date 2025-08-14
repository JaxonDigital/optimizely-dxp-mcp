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
const VersionChecker = require(path.join(libPath, 'version-check'));

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

// Command handler map
const commandHandlers = {
    'get_project_info': handleProjectInfo,
    'list_projects': (args) => ProjectTools.listProjects(args),
    'get_support': (args) => ProjectTools.handleGetSupport(args),
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
    
    // Inject environment credentials if not provided
    if (!validatedArgs.projectId) {
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
        if (!validatedArgs.projectId) missingCreds.push('Project ID');
        if (!validatedArgs.apiKey) missingCreds.push('API Key');
        if (!validatedArgs.apiSecret) missingCreds.push('API Secret');
        
        if (missingCreds.length > 0) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ **Missing Required Credentials**\n\n` +
                          `The following credentials are required but not provided:\n` +
                          missingCreds.map(c => `• ${c}`).join('\n') + `\n\n` +
                          `**How to fix this:**\n\n` +
                          `**Option 1:** Pass the credentials as parameters to this tool:\n` +
                          `• projectId: "your-project-id"\n` +
                          `• apiKey: "your-api-key"\n` +
                          `• apiSecret: "your-api-secret"\n\n` +
                          `**Option 2:** Configure environment variables in Claude Desktop:\n` +
                          `Run the \`get_project_info\` tool for detailed setup instructions.\n\n` +
                          `💡 **Tip:** Use \`get_project_info\` to check your current configuration.`
                }],
                isError: true
            };
        }
    }
    
    // Execute tool using handler map
    try {
        const handler = commandHandlers[toolName];
        if (!handler) {
            throw new Error(`Tool ${toolName} not implemented`);
        }
        
        const result = await handler(validatedArgs);
        
        // Handle response format
        if (result.error) {
            return {
                content: [{ 
                    type: 'text', 
                    text: result.error || 'An error occurred' 
                }],
                isError: true
            };
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