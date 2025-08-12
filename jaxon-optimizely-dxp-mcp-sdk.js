#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server - SDK Version 1.2
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
const { Config } = require(libPath);
const { 
    DatabaseTools, 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools 
} = require(path.join(libPath, 'tools'));

// Define Zod schemas for each tool
const schemas = {
    // Database operations
    export_database: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        databaseName: z.enum(['epicms', 'epicommerce']),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    check_export_status: z.object({
        exportId: z.string(),
        projectId: z.string(),
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        databaseName: z.enum(['epicms', 'epicommerce']),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Deployment operations
    start_deployment: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    get_deployment_status: z.object({
        deploymentId: z.string(),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    complete_deployment: z.object({
        deploymentId: z.string(),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    reset_deployment: z.object({
        deploymentId: z.string(),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Storage operations
    list_storage_containers: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    generate_storage_sas_link: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        containerName: z.string(),
        projectId: z.string(),
        permissions: z.enum(['Read', 'Write', 'Delete', 'List']).optional().default('Read'),
        expiryHours: z.number().optional().default(24),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Package operations
    upload_deployment_package: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        packagePath: z.string(),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    deploy_package_and_start: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        packagePath: z.string(),
        projectId: z.string(),
        directDeploy: z.boolean().optional().default(true),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Logging operations
    get_edge_logs: z.object({
        environment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectId: z.string(),
        hours: z.number().optional().default(1),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    }),
    
    // Content operations
    copy_content: z.object({
        sourceEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        targetEnvironment: z.enum(['Integration', 'Preproduction', 'Production']),
        projectId: z.string(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional()
    })
};

// Tool definitions
const toolDefinitions = [
    {
        name: 'export_database',
        description: 'Export database from an Optimizely DXP environment',
        inputSchema: schemas.export_database
    },
    {
        name: 'check_export_status',
        description: 'Check the status of a database export',
        inputSchema: schemas.check_export_status
    },
    {
        name: 'start_deployment',
        description: 'Start a deployment to specified environment',
        inputSchema: schemas.start_deployment
    },
    {
        name: 'get_deployment_status',
        description: 'Get the status of a deployment',
        inputSchema: schemas.get_deployment_status
    },
    {
        name: 'complete_deployment',
        description: 'Complete a deployment that is in Verification state',
        inputSchema: schemas.complete_deployment
    },
    {
        name: 'reset_deployment',
        description: 'Reset/rollback a deployment',
        inputSchema: schemas.reset_deployment
    },
    {
        name: 'list_storage_containers',
        description: 'List storage containers for an environment',
        inputSchema: schemas.list_storage_containers
    },
    {
        name: 'generate_storage_sas_link',
        description: 'Generate SAS link for storage container',
        inputSchema: schemas.generate_storage_sas_link
    },
    {
        name: 'upload_deployment_package',
        description: 'Upload a deployment package',
        inputSchema: schemas.upload_deployment_package
    },
    {
        name: 'deploy_package_and_start',
        description: 'Deploy a package and start deployment',
        inputSchema: schemas.deploy_package_and_start
    },
    {
        name: 'get_edge_logs',
        description: 'Get edge/application logs',
        inputSchema: schemas.get_edge_logs
    },
    {
        name: 'copy_content',
        description: 'Copy content between environments',
        inputSchema: schemas.copy_content
    }
];

// Create server instance
const server = new Server(
    {
        name: Config.PROJECT.NAME,
        version: '1.2.1' // SDK version
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
    
    // Execute tool
    try {
        let result;
        
        switch (toolName) {
            // Database operations
            case 'export_database':
                result = await DatabaseTools.handleExportDatabase(null, validatedArgs);
                break;
            case 'check_export_status':
                result = await DatabaseTools.handleCheckExportStatus(null, validatedArgs);
                break;
            
            // Deployment operations
            case 'start_deployment':
                result = await DeploymentTools.handleStartDeployment(null, validatedArgs);
                break;
            case 'get_deployment_status':
                result = await DeploymentTools.handleGetDeploymentStatus(null, validatedArgs);
                break;
            case 'complete_deployment':
                result = await DeploymentTools.handleCompleteDeployment(null, validatedArgs);
                break;
            case 'reset_deployment':
                result = await DeploymentTools.handleResetDeployment(null, validatedArgs);
                break;
            
            // Storage operations
            case 'list_storage_containers':
                result = await StorageTools.handleListStorageContainers(null, validatedArgs);
                break;
            case 'generate_storage_sas_link':
                result = await StorageTools.handleGenerateStorageSasLink(null, validatedArgs);
                break;
            
            // Package operations
            case 'upload_deployment_package':
                result = await PackageTools.handleUploadDeploymentPackage(null, validatedArgs);
                break;
            case 'deploy_package_and_start':
                result = await PackageTools.handleDeployPackageAndStart(null, validatedArgs);
                break;
            
            // Logging operations
            case 'get_edge_logs':
                result = await LoggingTools.handleGetEdgeLogs(null, validatedArgs);
                break;
            
            // Content operations
            case 'copy_content':
                result = await DeploymentTools.handleDeployPackageAndStart(null, {
                    ...validatedArgs,
                    directDeploy: false
                });
                break;
            
            default:
                throw new Error(`Tool ${toolName} not implemented`);
        }
        
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