#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server - Refactored Version
 * PowerShell-based MCP server for Optimizely DXP deployment operations
 * 
 * Built by Jaxon Digital - Optimizely Gold Partner
 * https://www.jaxondigital.com
 */

const readline = require('readline');
const { ResponseBuilder, Config } = require('./lib');
const { 
    DatabaseTools, 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools 
} = require('./lib/tools');

class JaxonOptimizelyDxpMcp {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        console.error(`Starting ${Config.PROJECT.NAME}`);
        console.error(`${Config.COMPANY.NAME} - ${Config.COMPANY.PARTNER_STATUS}`);
        console.error(`Website: ${Config.COMPANY.WEBSITE}`);

        this.rl.on('line', async (line) => {
            try {
                const request = JSON.parse(line);
                const response = await this.processRequest(request);
                console.log(JSON.stringify(response));
            } catch (error) {
                console.error('Error processing request:', error);
                const errorResponse = ResponseBuilder.internalError(null, 'Failed to process request', error.message);
                console.log(JSON.stringify(errorResponse));
            }
        });

        // Send initialization response
        const initResponse = {
            jsonrpc: '2.0',
            id: null,
            result: {
                name: Config.PROJECT.NAME,
                version: Config.PROJECT.VERSION,
                description: Config.PROJECT.DESCRIPTION,
                tools: this.getToolDefinitions()
            }
        };
        console.log(JSON.stringify(initResponse));
    }

    async processRequest(request) {
        console.error('Processing request:', request.method);
        
        if (request.method === 'tools/call') {
            return await this.handleToolCall(request);
        }
        
        return ResponseBuilder.methodNotFound(request.id, request.method);
    }

    async handleToolCall(request) {
        const toolCall = request.params;
        console.error('Tool call:', toolCall.name);
        
        try {
            switch (toolCall.name) {
                // Database operations
                case 'export_database':
                    return await DatabaseTools.handleExportDatabase(request.id, toolCall.arguments);
                case 'check_export_status':
                    return await DatabaseTools.handleCheckExportStatus(request.id, toolCall.arguments);
                
                // Deployment operations
                case 'start_deployment':
                    return await DeploymentTools.handleStartDeployment(request.id, toolCall.arguments);
                case 'get_deployment_status':
                    return await DeploymentTools.handleGetDeploymentStatus(request.id, toolCall.arguments);
                case 'complete_deployment':
                    return await DeploymentTools.handleCompleteDeployment(request.id, toolCall.arguments);
                case 'reset_deployment':
                    return await DeploymentTools.handleResetDeployment(request.id, toolCall.arguments);
                
                // Storage operations
                case 'list_storage_containers':
                    return await StorageTools.handleListStorageContainers(request.id, toolCall.arguments);
                case 'generate_storage_sas_link':
                    return await StorageTools.handleGenerateStorageSasLink(request.id, toolCall.arguments);
                
                // Package operations
                case 'upload_deployment_package':
                    return await PackageTools.handleUploadDeploymentPackage(request.id, toolCall.arguments);
                case 'deploy_package_and_start':
                    return await PackageTools.handleDeployPackageAndStart(request.id, toolCall.arguments);
                
                // Logging operations
                case 'get_edge_logs':
                    return await LoggingTools.handleGetEdgeLogs(request.id, toolCall.arguments);
                
                // Content operations (special case - uses deployment tools)
                case 'copy_content':
                    return await this.handleContentCopy(request.id, toolCall.arguments);
                
                default:
                    return ResponseBuilder.methodNotFound(request.id, toolCall.name);
            }
        } catch (error) {
            console.error('Error handling tool call:', error);
            return ResponseBuilder.internalError(request.id, 'Tool execution failed', error.message);
        }
    }

    // Content copy is a special case of deployment
    async handleContentCopy(requestId, args) {
        // Transform content copy args to deployment args
        const deploymentArgs = {
            ...args,
            sourceEnvironment: args.sourceEnvironment,
            targetEnvironment: args.targetEnvironment,
            includeBlob: args.includeBlob !== false,
            includeDatabase: args.includeDatabase !== false
        };
        
        return await DeploymentTools.handleStartDeployment(requestId, deploymentArgs);
    }

    // Tool definitions
    getToolDefinitions() {
        return [
            // Database operations
            {
                name: 'export_database',
                description: 'Export database as BACPAC file from DXP environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        environment: { 
                            type: 'string', 
                            description: 'Source environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        databaseName: { 
                            type: 'string', 
                            description: 'Database to export',
                            enum: Object.values(Config.DATABASES)
                        },
                        retentionHours: { 
                            type: 'integer', 
                            description: 'Hours to retain export',
                            default: Config.DEFAULTS.RETENTION_HOURS 
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'databaseName']
                }
            },
            {
                name: 'check_export_status',
                description: 'Check database export status and get download link',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        environment: { type: 'string', description: 'Environment' },
                        databaseName: { type: 'string', description: 'Database name' },
                        exportId: { type: 'string', description: 'Export ID to check' }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'databaseName', 'exportId']
                }
            },
            
            // Deployment operations
            {
                name: 'start_deployment',
                description: 'Start a deployment to target environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        targetEnvironment: { 
                            type: 'string', 
                            description: 'Target environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        sourceEnvironment: { 
                            type: 'string', 
                            description: 'Source environment (for env-to-env)',
                            enum: Config.ENVIRONMENTS 
                        },
                        packages: {
                            type: 'array',
                            description: 'Package locations (for package deployment)',
                            items: { type: 'string' }
                        },
                        sourceApps: {
                            type: 'array',
                            description: 'Source apps to deploy',
                            items: { 
                                type: 'string',
                                enum: Object.values(Config.SOURCE_APPS)
                            }
                        },
                        includeBlob: { 
                            type: 'boolean', 
                            description: 'Include BLOB storage',
                            default: true 
                        },
                        includeDatabase: { 
                            type: 'boolean', 
                            description: 'Include database',
                            default: true 
                        },
                        useMaintenancePage: {
                            type: 'boolean',
                            description: 'Show maintenance page during deployment'
                        },
                        directDeploy: {
                            type: 'boolean',
                            description: 'Deploy directly to live (skip staging)'
                        },
                        zeroDowntimeMode: {
                            type: 'string',
                            description: 'Zero downtime deployment mode',
                            enum: Object.values(Config.ZERO_DOWNTIME_MODES)
                        },
                        warmUpUrl: {
                            type: 'string',
                            description: 'URL to warm up after deployment'
                        },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for deployment to complete'
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Wait timeout in minutes',
                            default: Config.DEFAULTS.WAIT_TIMEOUT_MINUTES
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'targetEnvironment']
                }
            },
            {
                name: 'get_deployment_status',
                description: 'Get deployment status and progress',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        deploymentId: { type: 'string', description: 'Specific deployment ID (optional)' },
                        limit: { type: 'integer', description: 'Limit number of deployments returned' }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId']
                }
            },
            {
                name: 'complete_deployment',
                description: 'Complete a deployment (move from staging to live)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        deploymentId: { type: 'string', description: 'Deployment ID to complete' },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for completion'
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Wait timeout in minutes',
                            default: Config.DEFAULTS.WAIT_TIMEOUT_MINUTES
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'deploymentId']
                }
            },
            {
                name: 'reset_deployment',
                description: 'Reset/rollback a deployment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        deploymentId: { type: 'string', description: 'Deployment ID to reset' },
                        includeDbRollback: {
                            type: 'boolean',
                            description: 'Include database rollback'
                        },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for reset to complete'
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Wait timeout in minutes',
                            default: Config.DEFAULTS.WAIT_TIMEOUT_MINUTES
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'deploymentId']
                }
            },
            
            // Content operations
            {
                name: 'copy_content',
                description: 'Copy databases and BLOBs between environments',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        sourceEnvironment: { 
                            type: 'string', 
                            description: 'Source environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        targetEnvironment: { 
                            type: 'string', 
                            description: 'Target environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        includeBlob: { 
                            type: 'boolean', 
                            description: 'Include BLOB storage',
                            default: true 
                        },
                        includeDatabase: { 
                            type: 'boolean', 
                            description: 'Include database',
                            default: true 
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'sourceEnvironment', 'targetEnvironment']
                }
            },
            
            // Storage operations
            {
                name: 'list_storage_containers',
                description: 'List BLOB storage containers for an environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        environment: { 
                            type: 'string', 
                            description: 'Environment',
                            enum: Config.ENVIRONMENTS 
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment']
                }
            },
            {
                name: 'generate_storage_sas_link',
                description: 'Generate SAS link for storage container access',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        environment: { 
                            type: 'string', 
                            description: 'Environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        containerName: { type: 'string', description: 'Storage container name' },
                        permissions: {
                            type: 'string',
                            description: 'SAS permissions',
                            enum: ['Read', 'Write', 'Delete', 'List', 'All'],
                            default: 'Read'
                        },
                        validMinutes: {
                            type: 'integer',
                            description: 'SAS link validity in minutes',
                            default: 60
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'containerName']
                }
            },
            
            // Package operations
            {
                name: 'upload_deployment_package',
                description: 'Upload deployment package to DXP',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        packagePath: { type: 'string', description: 'Path to package file' },
                        chunkSize: {
                            type: 'integer',
                            description: 'Upload chunk size in MB',
                            default: Config.FILE_LIMITS.UPLOAD_CHUNK_SIZE_MB
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'packagePath']
                }
            },
            {
                name: 'deploy_package_and_start',
                description: 'Upload package and start deployment (combined workflow)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        packagePath: { type: 'string', description: 'Path to package file' },
                        targetEnvironment: { 
                            type: 'string', 
                            description: 'Target environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        useMaintenancePage: {
                            type: 'boolean',
                            description: 'Show maintenance page during deployment'
                        },
                        directDeploy: {
                            type: 'boolean',
                            description: 'Deploy directly to live (skip staging)'
                        },
                        zeroDowntimeMode: {
                            type: 'string',
                            description: 'Zero downtime deployment mode',
                            enum: Object.values(Config.ZERO_DOWNTIME_MODES)
                        },
                        warmUpUrl: {
                            type: 'string',
                            description: 'URL to warm up after deployment'
                        },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for deployment to complete'
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Wait timeout in minutes',
                            default: Config.DEFAULTS.WAIT_TIMEOUT_MINUTES
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'packagePath', 'targetEnvironment']
                }
            },
            
            // Logging operations
            {
                name: 'get_edge_logs',
                description: 'Get edge/CDN log location',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: { type: 'string', description: 'DXP API key' },
                        apiSecret: { type: 'string', description: 'DXP API secret' },
                        projectId: { type: 'string', description: 'DXP project ID' },
                        environment: { 
                            type: 'string', 
                            description: 'Environment',
                            enum: Config.ENVIRONMENTS 
                        },
                        startDate: {
                            type: 'string',
                            description: 'Start date (ISO format)'
                        },
                        endDate: {
                            type: 'string',
                            description: 'End date (ISO format)'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment']
                }
            }
        ];
    }
}

// Start the server
const server = new JaxonOptimizelyDxpMcp();
server.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});