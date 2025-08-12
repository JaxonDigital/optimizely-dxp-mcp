#!/usr/bin/env node

/**
 * Jaxon Digital Optimizely DXP MCP Server - Clean Version
 * PowerShell-based MCP server for Optimizely DXP deployment operations
 * 
 * Built by Jaxon Digital - Optimizely Gold Partner
 * https://www.jaxondigital.com
 */

const readline = require('readline');
const path = require('path');

// Use absolute paths for requires when script is run from different directory
const libPath = path.join(__dirname, 'lib');
const toolsPath = path.join(__dirname, 'lib', 'tools');

const { ResponseBuilder, Config } = require(libPath);
const { 
    DatabaseTools, 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools 
} = require(toolsPath);

class JaxonOptimizelyDxpMcp {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        this.isConnected = false;
    }

    async run() {
        // IMPORTANT: No console.log messages except for JSON-RPC responses
        // All debug output must go to stderr
        
        this.rl.on('line', async (line) => {
            try {
                const request = JSON.parse(line);
                const response = await this.processRequest(request);
                
                // Only send response if there is one (not for notifications)
                if (response) {
                    console.log(JSON.stringify(response));
                }
            } catch (error) {
                // Log errors to stderr, not stdout
                if (process.env.DEBUG) {
                    console.error('Error processing request:', error);
                }
                const errorResponse = ResponseBuilder.internalError(null, 'Failed to process request', error.message);
                console.log(JSON.stringify(errorResponse));
            }
        });
        
        // Handle graceful shutdown
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }
    
    shutdown() {
        this.isConnected = false;
        process.exit(0);
    }

    async processRequest(request) {
        // Debug logging to stderr only
        if (process.env.DEBUG) {
            console.error('Processing request:', request.method);
        }
        
        switch (request.method) {
            case 'initialize':
                return this.handleInitialize(request);
            case 'tools/list':
                return this.handleToolsList(request);
            case 'tools/call':
                return await this.handleToolCall(request);
            case 'ping':
                return this.handlePing(request);
            case 'shutdown':
                this.shutdown();
                return { jsonrpc: '2.0', id: request.id, result: { status: 'shutting_down' } };
            default:
                return ResponseBuilder.methodNotFound(request.id, request.method);
        }
    }
    
    handlePing(request) {
        // Respond to ping requests to confirm connection
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                status: 'pong',
                timestamp: Date.now(),
                connected: this.isConnected
            }
        };
    }

    handleInitialize(request) {
        // Mark as connected when initialized
        this.isConnected = true;
        
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                protocolVersion: '0.1.0',
                serverInfo: {
                    name: Config.PROJECT.NAME,
                    version: Config.PROJECT.VERSION,
                    description: Config.PROJECT.DESCRIPTION
                },
                capabilities: {
                    tools: {},
                    prompts: {}
                }
            }
        };
    }

    handleToolsList(request) {
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                tools: this.getToolDefinitions()
            }
        };
    }

    async handleToolCall(request) {
        const toolCall = request.params;
        if (process.env.DEBUG) {
            console.error('Tool call:', toolCall.name);
        }
        
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
            if (process.env.DEBUG) {
                console.error('Tool execution error:', error);
            }
            return ResponseBuilder.internalError(request.id, `Tool ${toolCall.name} failed`, error.message);
        }
    }

    async handleContentCopy(requestId, args) {
        const response = await DeploymentTools.handleDeployPackageAndStart(requestId, {
            ...args,
            directDeploy: false
        });
        
        return response;
    }

    getToolDefinitions() {
        return [
            // Database operations
            {
                name: 'export_database',
                description: 'Export database from an Optimizely DXP environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        environment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Environment to export from'
                        },
                        databaseName: {
                            type: 'string',
                            enum: ['epicms', 'epicommerce'],
                            description: 'Database to export'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['environment', 'databaseName', 'projectId']
                }
            },
            {
                name: 'check_export_status',
                description: 'Check the status of a database export',
                inputSchema: {
                    type: 'object',
                    properties: {
                        exportId: {
                            type: 'string',
                            description: 'Export ID from export_database'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['exportId', 'projectId']
                }
            },

            // Deployment operations
            {
                name: 'start_deployment',
                description: 'Start a deployment to specified environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceEnvironment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Source environment'
                        },
                        targetEnvironment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Target environment'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['sourceEnvironment', 'targetEnvironment', 'projectId']
                }
            },
            {
                name: 'get_deployment_status',
                description: 'Get the status of a deployment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deploymentId: {
                            type: 'string',
                            description: 'Deployment ID'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['deploymentId', 'projectId']
                }
            },
            {
                name: 'complete_deployment',
                description: 'Complete a deployment that is in Verification state',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deploymentId: {
                            type: 'string',
                            description: 'Deployment ID'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['deploymentId', 'projectId']
                }
            },
            {
                name: 'reset_deployment',
                description: 'Reset/rollback a deployment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        deploymentId: {
                            type: 'string',
                            description: 'Deployment ID'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['deploymentId', 'projectId']
                }
            },

            // Storage operations
            {
                name: 'list_storage_containers',
                description: 'List storage containers for an environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        environment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Environment'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['environment', 'projectId']
                }
            },
            {
                name: 'generate_storage_sas_link',
                description: 'Generate SAS link for storage container',
                inputSchema: {
                    type: 'object',
                    properties: {
                        environment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Environment'
                        },
                        containerName: {
                            type: 'string',
                            description: 'Container name'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        },
                        permissions: {
                            type: 'string',
                            enum: ['Read', 'Write', 'Delete', 'List'],
                            description: 'SAS permissions (default: Read)'
                        },
                        expiryHours: {
                            type: 'number',
                            description: 'Link expiry in hours (default: 24)'
                        }
                    },
                    required: ['environment', 'containerName', 'projectId']
                }
            },

            // Package operations
            {
                name: 'upload_deployment_package',
                description: 'Upload a deployment package',
                inputSchema: {
                    type: 'object',
                    properties: {
                        environment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Target environment'
                        },
                        packagePath: {
                            type: 'string',
                            description: 'Path to .nupkg file'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['environment', 'packagePath', 'projectId']
                }
            },
            {
                name: 'deploy_package_and_start',
                description: 'Deploy a package and start deployment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceEnvironment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Source environment'
                        },
                        targetEnvironment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Target environment'
                        },
                        packagePath: {
                            type: 'string',
                            description: 'Path to .nupkg file'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        },
                        directDeploy: {
                            type: 'boolean',
                            description: 'Use direct deploy (default: true)'
                        }
                    },
                    required: ['sourceEnvironment', 'targetEnvironment', 'packagePath', 'projectId']
                }
            },

            // Logging operations
            {
                name: 'get_edge_logs',
                description: 'Get edge/application logs',
                inputSchema: {
                    type: 'object',
                    properties: {
                        environment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Environment'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        },
                        hours: {
                            type: 'number',
                            description: 'Hours of logs to retrieve (default: 1)'
                        }
                    },
                    required: ['environment', 'projectId']
                }
            },

            // Content operations
            {
                name: 'copy_content',
                description: 'Copy content between environments',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sourceEnvironment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Source environment'
                        },
                        targetEnvironment: {
                            type: 'string',
                            enum: ['Integration', 'Preproduction', 'Production'],
                            description: 'Target environment'
                        },
                        projectId: {
                            type: 'string',
                            description: 'Optimizely project ID'
                        }
                    },
                    required: ['sourceEnvironment', 'targetEnvironment', 'projectId']
                }
            }
        ];
    }
}

// Main execution
const server = new JaxonOptimizelyDxpMcp();
server.run();