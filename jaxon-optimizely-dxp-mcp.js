#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server - v1.3.0
 * Built with official @modelcontextprotocol/sdk for full Claude compatibility
 * 
 * Built by Jaxon Digital - Optimizely Gold Partner
 * https://www.jaxondigital.com
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
    ListToolsRequestSchema,
    CallToolRequestSchema 
} = require('@modelcontextprotocol/sdk/types.js');
const { z } = require('zod');
const { zodToJsonSchema } = require('zod-to-json-schema');
const path = require('path');

// Import existing modules
const libPath = path.join(__dirname, 'lib');
const Config = require(path.join(libPath, 'config'));
const { 
    DatabaseTools, 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools,
    ContentTools 
} = require(path.join(libPath, 'tools'));

// Define Zod schemas for each tool
const schemas = {
    // Project info
    get_project_info: z.object({}),
    
    // Database operations
    export_database: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        databaseName: z.enum(['epicms', 'epicommerce']),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    check_export_status: z.object({
        exportId: z.string(),
        projectId: z.string().optional(),
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        databaseName: z.enum(['epicms', 'epicommerce']),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Deployment operations
    list_deployments: z.object({
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
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    get_deployment_status: z.object({
        deploymentId: z.string(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    complete_deployment: z.object({
        deploymentId: z.string(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    reset_deployment: z.object({
        deploymentId: z.string(),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Storage operations
    list_storage_containers: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    generate_storage_sas_link: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        containerName: z.string(),
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
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    deploy_package_and_start: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        packagePath: z.string(),
        projectId: z.string().optional(),
        directDeploy: z.boolean().optional().default(true),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Logging operations
    get_edge_logs: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']).optional(),
        projectId: z.string().optional(),
        hours: z.number().optional().default(1),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Content operations
    copy_content: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectId: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    })
};

// Special handler for project info
function handleProjectInfo() {
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
    'copy_content': (args) => ContentTools.handleCopyContent(args)
};

// Tool definitions
const toolDefinitions = Object.keys(schemas).map(name => {
    const descriptions = {
        'get_project_info': 'Get current Optimizely project name and configuration details',
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
        'copy_content': 'Copy content between environments (uses configured project)'
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
        version: '1.3.0'
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
                text: `❌ Invalid arguments: ${error.message}` 
            }],
            isError: true
        };
    }
    
    // Inject environment credentials if not provided
    if (!validatedArgs.projectId) {
        validatedArgs.projectId = process.env.OPTIMIZELY_PROJECT_ID;
    }
    if (!validatedArgs.apiKey) {
        validatedArgs.apiKey = process.env.OPTIMIZELY_API_KEY;
    }
    if (!validatedArgs.apiSecret) {
        validatedArgs.apiSecret = process.env.OPTIMIZELY_API_SECRET;
    }
    
    // Log which project is being used (to stderr to avoid polluting stdout)
    if (validatedArgs.projectId && toolName !== 'get_project_info') {
        console.error(`Using project: ${validatedArgs.projectId}`);
    }
    
    // Check for missing credentials (except for get_project_info)
    if (toolName !== 'get_project_info') {
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
    console.error('Jaxon Optimizely DXP MCP Server v1.2 (SDK) started');
}

// Handle errors
main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
});