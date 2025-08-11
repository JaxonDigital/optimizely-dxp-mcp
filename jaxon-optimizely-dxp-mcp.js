#!/usr/bin/env node

// Standalone Optimizely MCP Server - can be copied to any project
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// PowerShell-only MCP Server - no API calls needed

class JaxonOptimizelyDxpMcp {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        console.error('Starting Jaxon Digital Optimizely DXP MCP Server');

        this.rl.on('line', async (line) => {
            try {
                const request = JSON.parse(line);
                const response = await this.processRequest(request);
                console.log(JSON.stringify(response));
            } catch (error) {
                console.error('Error processing request:', error);
                const errorResponse = {
                    jsonrpc: '2.0',
                    id: null,
                    error: {
                        code: -32000,
                        message: 'Internal server error',
                        data: error.message
                    }
                };
                console.log(JSON.stringify(errorResponse));
            }
        });
    }

    async processRequest(request) {
        console.error(`Processing request: ${request.method}`);

        switch (request.method) {
            case 'initialize':
                return this.handleInitialize(request);
            case 'initialized':
                return this.handleInitialized(request);
            case 'tools/list':
                return this.handleToolsList(request);
            case 'tools/call':
                return await this.handleToolCall(request);
            default:
                return {
                    jsonrpc: '2.0',
                    id: request.id,
                    error: {
                        code: -32601,
                        message: `Method not found: ${request.method}`
                    }
                };
        }
    }

    handleInitialize(request) {
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: {
                        listChanged: false
                    }
                },
                serverInfo: {
                    name: 'Optimizely DXP MCP Server',
                    version: '1.0.0'
                }
            }
        };
    }

    handleInitialized(request) {
        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {}
        };
    }

    handleToolsList(request) {
        const tools = [
            {
                name: 'export_database',
                description: 'Export database as a bacpac file from specified DXP environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        environment: {
                            type: 'string',
                            description: 'Target environment (Integration, Preproduction, Production, ADE1-6)',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        databaseName: {
                            type: 'string',
                            description: 'Database type to export',
                            enum: ['epicms', 'epicommerce']
                        },
                        retentionHours: {
                            type: 'integer',
                            description: 'Duration the exported file remains available (default 24h, max 72h)',
                            minimum: 1,
                            maximum: 72,
                            default: 24
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'databaseName']
                }
            },
            {
                name: 'check_export_status',
                description: 'Check the status of a database export and get download link when completed',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        environment: {
                            type: 'string',
                            description: 'Target environment (Integration, Preproduction, Production, ADE1-6)',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        databaseName: {
                            type: 'string',
                            description: 'Database type to export',
                            enum: ['epicms', 'epicommerce']
                        },
                        exportId: {
                            type: 'string',
                            description: 'The export ID returned from export_database'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'databaseName', 'exportId']
                }
            },
            {
                name: 'content_copy',
                description: 'Copy database and BLOB content between DXP environments using PowerShell EpiCloud module',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        sourceEnvironment: {
                            type: 'string',
                            description: 'Source environment to copy from',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        targetEnvironment: {
                            type: 'string',
                            description: 'Target environment to copy to',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        includeBlob: {
                            type: 'boolean',
                            description: 'Include BLOB storage in copy operation (default: true)',
                            default: true
                        },
                        includeDatabase: {
                            type: 'boolean',
                            description: 'Include database in copy operation (default: true)',
                            default: true
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'sourceEnvironment', 'targetEnvironment']
                }
            },
            {
                name: 'list_storage_containers',
                description: 'List BLOB storage containers for a DXP environment',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        environment: {
                            type: 'string',
                            description: 'Target environment to list containers for',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment']
                }
            },
            {
                name: 'test_epicloud_connection',
                description: 'Test PowerShell EpiCloud connection and authentication',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId']
                }
            },
            {
                name: 'get_deployment_status',
                description: 'Get deployment status and details using PowerShell EpiCloud module. Can list all deployments or get specific deployment by ID.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        deploymentId: {
                            type: 'string',
                            description: 'Optional deployment ID to get specific deployment details'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId']
                }
            },
            {
                name: 'generate_storage_sas_link',
                description: 'Generate SAS (Shared Access Signature) links for BLOB storage containers using PowerShell EpiCloud module. Supports read-only and writable access with configurable retention.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        environment: {
                            type: 'string',
                            description: 'Target environment for storage access',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        containers: {
                            type: 'array',
                            items: {
                                type: 'string'
                            },
                            description: 'Array of storage container names to generate SAS links for'
                        },
                        retentionHours: {
                            type: 'integer',
                            description: 'Number of hours the SAS link should remain valid (default: 24, max: 168)',
                            minimum: 1,
                            maximum: 168,
                            default: 24
                        },
                        writable: {
                            type: 'boolean',
                            description: 'Generate writable SAS links (allows upload/modify operations). Only works with certain containers like mysitemedia.',
                            default: false
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'containers']
                }
            },
            {
                name: 'get_edge_logs',
                description: 'Get edge/CDN log locations for Optimizely DXP environments using PowerShell EpiCloud module. Returns SAS URLs for downloading edge server logs.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId']
                }
            },
            {
                name: 'upload_deployment_package',
                description: 'Upload deployment package (NuGet file) for code deployment using PowerShell EpiCloud module. Gets upload location and uploads the package in one operation.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        packagePath: {
                            type: 'string',
                            description: 'Full path to the NuGet package file (.nupkg) to upload'
                        },
                        packageName: {
                            type: 'string',
                            description: 'Optional custom name for the package blob. If not specified, uses the filename from packagePath.'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'packagePath']
                }
            },
            {
                name: 'complete_deployment',
                description: 'Complete a deployment that is in AwaitingVerification status, moving it from staging slot to live environment using PowerShell EpiCloud module.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        deploymentId: {
                            type: 'string',
                            description: 'Deployment ID to complete (must be in AwaitingVerification status)'
                        },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for completion process to finish before returning response',
                            default: false
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Maximum time to wait for completion (default: 30 minutes)',
                            minimum: 1,
                            maximum: 240,
                            default: 30
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'deploymentId']
                }
            },
            {
                name: 'reset_deployment',
                description: 'Reset/rollback a deployment that is in AwaitingVerification status, returning it to staging slot for redeployment using PowerShell EpiCloud module.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        deploymentId: {
                            type: 'string',
                            description: 'Deployment ID to reset (must be in AwaitingVerification or failed status)'
                        },
                        includeDbRollback: {
                            type: 'boolean',
                            description: 'Include database rollback as part of the reset operation',
                            default: false
                        },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for reset process to finish before returning response',
                            default: false
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Maximum time to wait for reset completion (default: 30 minutes)',
                            minimum: 1,
                            maximum: 240,
                            default: 30
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'deploymentId']
                }
            },
            {
                name: 'start_deployment',
                description: 'Start deployment of uploaded packages to DXP environment using PowerShell EpiCloud module. Supports both package deployment and environment-to-environment deployments.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        apiKey: {
                            type: 'string',
                            description: 'DXP API key for authentication'
                        },
                        apiSecret: {
                            type: 'string',
                            description: 'DXP API secret for authentication'
                        },
                        projectId: {
                            type: 'string',
                            description: 'DXP project ID'
                        },
                        targetEnvironment: {
                            type: 'string',
                            description: 'Target environment to deploy to',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        packages: {
                            type: 'array',
                            items: {
                                type: 'string'
                            },
                            description: 'Array of package names to deploy (must be already uploaded). For environment-to-environment deployment, leave empty.'
                        },
                        sourceEnvironment: {
                            type: 'string',
                            description: 'Source environment for environment-to-environment deployment',
                            enum: ['Integration', 'Preproduction', 'Production', 'ADE1', 'ADE2', 'ADE3', 'ADE4', 'ADE5', 'ADE6']
                        },
                        sourceApps: {
                            type: 'array',
                            items: {
                                type: 'string',
                                enum: ['cms', 'commerce']
                            },
                            description: 'Source applications to copy (for environment-to-environment deployment)'
                        },
                        includeBlob: {
                            type: 'boolean',
                            description: 'Include BLOB storage in deployment (for environment-to-environment)',
                            default: false
                        },
                        includeDatabase: {
                            type: 'boolean',
                            description: 'Include database in deployment (for environment-to-environment)',
                            default: false
                        },
                        useMaintenancePage: {
                            type: 'boolean',
                            description: 'Use maintenance page during deployment',
                            default: false
                        },
                        directDeploy: {
                            type: 'boolean',
                            description: 'Use direct deploy for faster Integration/Development deployments (no rollback support)',
                            default: false
                        },
                        zeroDowntimeMode: {
                            type: 'string',
                            description: 'Zero downtime (smooth) deployment mode. ReadOnly is recommended for production to prevent data loss during deployment. ReadWrite allows database writes but risks data loss.',
                            enum: ['ReadOnly', 'ReadWrite']
                        },
                        warmUpUrl: {
                            type: 'string',
                            description: 'URL to warm up after deployment completion (for DirectDeploy mode)'
                        },
                        waitForCompletion: {
                            type: 'boolean',
                            description: 'Wait for deployment to complete before returning response',
                            default: false
                        },
                        waitTimeoutMinutes: {
                            type: 'integer',
                            description: 'Maximum time to wait for deployment completion (default: 30 minutes)',
                            minimum: 1,
                            maximum: 240,
                            default: 30
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'targetEnvironment']
                }
            }
        ];

        return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
                tools: tools
            }
        };
    }

    async handleToolCall(request) {
        try {
            const toolCall = request.params;
            
            switch (toolCall.name) {
                case 'export_database':
                    return await this.handleExportDatabase(request.id, toolCall.arguments);
                case 'check_export_status':
                    return await this.handleCheckExportStatus(request.id, toolCall.arguments);
                case 'content_copy':
                    return await this.handleContentCopy(request.id, toolCall.arguments);
                case 'list_storage_containers':
                    return await this.handleListStorageContainers(request.id, toolCall.arguments);
                case 'test_epicloud_connection':
                    return await this.handleTestEpiCloudConnection(request.id, toolCall.arguments);
                case 'get_deployment_status':
                    return await this.handleGetDeploymentStatus(request.id, toolCall.arguments);
                case 'generate_storage_sas_link':
                    return await this.handleGenerateStorageSasLink(request.id, toolCall.arguments);
                case 'get_edge_logs':
                    return await this.handleGetEdgeLogs(request.id, toolCall.arguments);
                case 'upload_deployment_package':
                    return await this.handleUploadDeploymentPackage(request.id, toolCall.arguments);
                case 'complete_deployment':
                    return await this.handleCompleteDeployment(request.id, toolCall.arguments);
                case 'start_deployment':
                    return await this.handleStartDeployment(request.id, toolCall.arguments);
                case 'reset_deployment':
                    return await this.handleResetDeployment(request.id, toolCall.arguments);
                default:
                    return {
                        jsonrpc: '2.0',
                        id: request.id,
                        error: {
                            code: -32601,
                            message: `Unknown tool: ${toolCall.name}`
                        }
                    };
            }
        } catch (error) {
            console.error('Error handling tool call:', error);
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }

    async handleExportDatabase(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.databaseName) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid export database arguments'
                    }
                };
            }

            const result = await this.exportDatabase(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.environment,
                args.databaseName,
                args.retentionHours || 24
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error exporting database:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: `Error exporting database: ${error.message}`
                    }],
                    isError: true
                }
            };
        }
    }

    async handleCheckExportStatus(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.databaseName || !args.exportId) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid check export status arguments'
                    }
                };
            }

            const result = await this.checkExportStatus(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.environment,
                args.databaseName,
                args.exportId
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error checking export status:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: `Error checking export status: ${error.message}`
                    }],
                    isError: true
                }
            };
        }
    }

    async exportDatabase(apiKey, apiSecret, projectId, environment, databaseName, retentionHours) {
        try {
            console.error(`Starting database export using PowerShell for project ${projectId}, environment ${environment}, database ${databaseName}`);

            // Use PowerShell Start-EpiDatabaseExport cmdlet with proper error handling
            const psScript = [
                'Import-Module EpiCloud -Force -ErrorAction SilentlyContinue',
                'if (Get-Module -Name EpiCloud) {',
                `    Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -ErrorAction SilentlyContinue`,
                '    try {',
                `        $export = Start-EpiDatabaseExport -ProjectId '${projectId}' -Environment '${environment}' -DatabaseName '${databaseName}' -RetentionHours ${retentionHours}`,
                '        if ($export) {',
                '            $export | ConvertTo-Json -Depth 10 -Compress',
                '        } else {',
                '            Write-Output "EXPORT_FAILED"',
                '        }',
                '    } catch {',
                '        if ($_.Exception.Message -like "*on-going database export*") {',
                '            Write-Output "EXPORT_ALREADY_RUNNING"',
                '        } elseif ($_.Exception.Message -like "*500*") {',
                '            Write-Output "SERVER_ERROR:$($_.Exception.Message)"',
                '        } else {',
                '            Write-Output "EXPORT_ERROR:$($_.Exception.Message)"',
                '        }',
                '    }',
                '} else {',
                '    Write-Output "EPICCLOUD_MODULE_NOT_FOUND"',
                '}'
            ].join('; ');

            const { stdout, stderr } = await execAsync(`pwsh -Command "${psScript}"`);
            
            if (stdout.includes('EPICCLOUD_MODULE_NOT_FOUND')) {
                return `❌ **EpiCloud PowerShell Module Required**

To export databases, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Export:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
Start-EpiDatabaseExport -ProjectId "${projectId}" -Environment "${environment}" -DatabaseName "${databaseName}" -RetentionHours ${retentionHours}
\`\`\`

**Environment:** ${environment}
**Database:** ${databaseName}`;
            } else if (stdout.includes('EXPORT_ALREADY_RUNNING')) {
                return `⚠️ **Database Export Already Running**

There is already an ongoing database export operation for this environment.

**Current Request:**
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Project ID:** ${projectId}

**What to do:**
1. Wait for the current export to complete (10-30 minutes)
2. Check existing export status in your [DXP Management Portal](https://paasportal.episerver.net)
3. Try again after the current export finishes

💡 **Tip:** Only one database export can run per environment at a time.`;
            } else if (stdout.includes('SERVER_ERROR:')) {
                const errorMessage = stdout.split('SERVER_ERROR:')[1] || 'Unknown server error';
                return `❌ **Server Error During Export**

**Error Details:**
\`\`\`
${errorMessage.trim()}
\`\`\`

**Attempted Export:**
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Project ID:** ${projectId}
- **Retention:** ${retentionHours} hours

**Troubleshooting:**
- Wait a few minutes and try again
- Check your DXP Management Portal for system status
- Contact support if the issue persists`;
            } else if (stdout.includes('EXPORT_ERROR:')) {
                const errorMessage = stdout.split('EXPORT_ERROR:')[1] || 'Unknown export error';
                return `❌ **Database Export Error**

**Error Details:**
\`\`\`
${errorMessage.trim()}
\`\`\`

**Attempted Export:**
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Project ID:** ${projectId}
- **Retention:** ${retentionHours} hours

**Common Causes:**
- Invalid environment or database name
- Insufficient permissions
- Environment temporarily unavailable`;
            } else if (stdout.includes('EXPORT_FAILED')) {
                return `❌ **Database Export Failed**

The export operation failed. This could be due to:
- Invalid environment or database name
- Insufficient permissions
- Environment is busy with another operation

**Attempted Export:**
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Project ID:** ${projectId}
- **Retention:** ${retentionHours} hours

Please check your DXP Management Portal or try again later.`;
            } else if (stdout.trim()) {
                try {
                    // Parse the export result from PowerShell
                    const lines = stdout.split('\n');
                    const jsonLine = lines.find(line => line.trim().startsWith('{') && line.trim().endsWith('}'));
                    
                    if (jsonLine) {
                        const exportResult = JSON.parse(jsonLine.trim());
                        return `🚀 **Database Export Started Successfully!**

✅ **Export Details:**
- **Operation ID:** \`${exportResult.id}\`
- **Status:** ${exportResult.status}
- **Environment:** ${exportResult.environment}
- **Database:** ${exportResult.databaseDisplayName || databaseName}
- **Full Database Name:** ${exportResult.databaseName}
- **Retention:** ${retentionHours} hours

📋 **What's Next:**
Your database export is now processing in the background. This typically takes 10-30 minutes depending on database size.

💡 **To check the status, ask me:**
"What's the status of export ${exportResult.id}?"

⏱️ **Estimated completion:** 10-30 minutes
📦 **File will be available for:** ${retentionHours} hours after completion

🔧 **Powered by:** PowerShell EpiCloud module`;
                    } else {
                        // Try to parse entire output as JSON
                        const exportResult = JSON.parse(stdout.trim());
                        return `🚀 **Database Export Started Successfully!**

✅ **Export Details:**
- **Operation ID:** \`${exportResult.id}\`
- **Status:** ${exportResult.status}
- **Environment:** ${exportResult.environment}
- **Database:** ${exportResult.databaseDisplayName || databaseName}
- **Full Database Name:** ${exportResult.databaseName}
- **Retention:** ${retentionHours} hours

📋 **What's Next:**
Your database export is now processing in the background. This typically takes 10-30 minutes depending on database size.

💡 **To check the status, ask me:**
"What's the status of export ${exportResult.id}?"

⏱️ **Estimated completion:** 10-30 minutes
📦 **File will be available for:** ${retentionHours} hours after completion

🔧 **Powered by:** PowerShell EpiCloud module`;
                    }
                } catch (error) {
                    // Return raw PowerShell output if JSON parsing fails
                    return `📊 **Database Export Started (PowerShell Output):**

\`\`\`
${stdout.trim()}
\`\`\`

**Export Parameters:**
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Retention:** ${retentionHours} hours

The export has been initiated. Check the status using the export ID from the output above.

🔧 **Powered by:** PowerShell EpiCloud module`;
                }
            } else {
                return `❌ **Database Export Failed**

**Error Output:**
\`\`\`
${stderr || 'Unknown error occurred'}
\`\`\`

**Export Parameters:**
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Retention:** ${retentionHours} hours

**Troubleshooting:**
- Verify your API credentials have permission for this environment
- Check that the environment and database name are correct
- Ensure no other operations are running on this environment`;
            }
        } catch (error) {
            throw new Error(`Database export failed: ${error.message}`);
        }
    }

    async checkExportStatus(apiKey, apiSecret, projectId, environment, databaseName, exportId) {
        try {
            console.error(`Checking export status using PowerShell for export ${exportId}`);

            // First try PowerShell approach with proper escaping
            const psScript = [
                'Import-Module EpiCloud -Force -ErrorAction SilentlyContinue',
                'if (Get-Module -Name EpiCloud) {',
                `    Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -ErrorAction SilentlyContinue`,
                `    $export = Get-EpiDatabaseExport -ProjectId '${projectId}' -Environment '${environment}' -DatabaseName '${databaseName}' -Id '${exportId}' -ErrorAction SilentlyContinue`,
                '    if ($export) {',
                '        $export | ConvertTo-Json -Depth 10 -Compress',
                '    } else {',
                '        Write-Output "EXPORT_NOT_FOUND"',
                '    }',
                '} else {',
                '    Write-Output "EPICCLOUD_MODULE_NOT_FOUND"',
                '}'
            ].join('; ');

            const { stdout, stderr } = await execAsync(`pwsh -Command "${psScript}"`);
            
            if (stdout.includes('EPICCLOUD_MODULE_NOT_FOUND')) {
                return this.getFallbackExportStatusMessage(exportId, environment, databaseName, projectId);
            } else if (stdout.includes('EXPORT_NOT_FOUND')) {
                return `❌ **Export Not Found**

The export ID \`${exportId}\` was not found. This could mean:
- Export ID is incorrect
- Export has expired (they're only available for 24-72 hours)
- Export was completed and cleaned up

Please check your DXP Management Portal or try a new export.`;
            } else if (stdout.trim()) {
                // Try to parse JSON response
                try {
                    const exportData = JSON.parse(stdout.trim());
                    return this.formatExportStatus(exportData);
                } catch (error) {
                    // Return raw PowerShell output if JSON parsing fails
                    return `📊 **Export Status (PowerShell Output):**

\`\`\`
${stdout.trim()}
\`\`\`

Export ID: \`${exportId}\`
Environment: ${environment}
Database: ${databaseName}`;
                }
            } else {
                return this.getFallbackExportStatusMessage(exportId, environment, databaseName, projectId);
            }
        } catch (error) {
            console.error('PowerShell error:', error);
            return this.getFallbackExportStatusMessage(exportId, environment, databaseName, projectId);
        }
    }

    formatExportStatus(exportData) {
        const status = exportData.status || 'Unknown';
        const downloadUrl = exportData.downloadLink || null;
        const fileName = exportData.bacpacName || null;
        
        let result = `📊 **Export Status: ${status}**\n\n`;
        
        if (fileName) {
            result += `📁 **File:** ${fileName}\n`;
        }
        
        result += `🆔 **Export ID:** \`${exportData.id || 'Unknown'}\`\n`;
        result += `🌍 **Environment:** ${exportData.environment || 'Unknown'}\n`;
        result += `💾 **Database:** ${exportData.databaseName || 'Unknown'}\n\n`;
        
        if (status.toLowerCase() === 'succeeded' && downloadUrl) {
            result += `✅ **Ready for Download!**\n`;
            result += `🔗 **Download Link:** ${downloadUrl}\n\n`;
            result += `💡 **Next Steps:**\n`;
            result += `- Download the file using the link above\n`;
            result += `- File will be available for the retention period specified during export\n`;
        } else if (status.toLowerCase() === 'inprogress' || status.toLowerCase() === 'running') {
            result += `⏳ **Processing...**\n`;
            result += `Your export is still being processed. Please check again in a few minutes.\n\n`;
            result += `⏱️ **Typical Times:**\n`;
            result += `- Small DBs: 5-15 minutes\n`;
            result += `- Medium DBs: 15-30 minutes\n`;
            result += `- Large DBs: 30+ minutes\n`;
        } else if (status.toLowerCase() === 'failed') {
            result += `❌ **Export Failed**\n`;
            result += `The export operation failed. Please try starting a new export.\n`;
        }
        
        return result;
    }

    getFallbackExportStatusMessage(exportId, environment, databaseName, projectId) {
        return `🔍 **Export Status Check**

📋 **Export Information:**
- **Export ID:** \`${exportId}\`
- **Environment:** ${environment}
- **Database:** ${databaseName}

⚠️ **PowerShell Module Required:**
To check export status, you need the EpiCloud PowerShell module installed:

**Install Instructions:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Check:**
\`\`\`powershell
Connect-EpiCloud -ClientKey "your-api-key" -ClientSecret "your-api-secret" -ProjectId "${projectId}"
Get-EpiDatabaseExport -ProjectId "${projectId}" -Environment "${environment}" -DatabaseName "${databaseName}" -Id "${exportId}"
\`\`\`

**Alternative:** Check your [DXP Management Portal](https://paasportal.episerver.net) for export status.`;
    }

    async handleContentCopy(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.sourceEnvironment || !args.targetEnvironment) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid content copy arguments'
                    }
                };
            }

            const result = await this.copyContent(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.sourceEnvironment,
                args.targetEnvironment,
                args.includeBlob !== false,
                args.includeDatabase !== false
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error copying content:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: `Error copying content: ${error.message}`
                    }],
                    isError: true
                }
            };
        }
    }

    async copyContent(apiKey, apiSecret, projectId, sourceEnvironment, targetEnvironment, includeBlob, includeDatabase) {
        try {
            console.error(`Starting content copy using PowerShell from ${sourceEnvironment} to ${targetEnvironment}`);

            // Use PowerShell Start-EpiDeployment cmdlet for content copy - simplified approach
            const deploymentCommand = `Start-EpiDeployment -ProjectId '${projectId}' -SourceEnvironment '${sourceEnvironment}' -TargetEnvironment '${targetEnvironment}'${includeBlob ? ' -IncludeBlob' : ''}${includeDatabase ? ' -IncludeDb' : ''}`;
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${deploymentCommand} | ConvertTo-Json -Depth 10 -Compress`;

            const { stdout, stderr } = await execAsync(`pwsh -Command "${psScript}"`);
            
            // Check for errors in stderr (PowerShell exceptions appear here)
            if (stderr && (stderr.includes('on-going deployment') || stderr.includes('not allowed when there is an on-going deployment'))) {
                return `⚠️ **Deployment Already Running**

There is already an ongoing deployment operation for this project.

**Current Request:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

**What to do:**
1. Wait for the current deployment to complete (30-60 minutes)
2. Check existing deployment status in your [DXP Management Portal](https://paasportal.episerver.net)
3. Try again after the current deployment finishes

💡 **Tip:** Only one deployment can run per project at a time.

🔧 **Powered by:** PowerShell EpiCloud module`;
            } else if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**

To perform content copy operations, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Content Copy:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
Start-EpiDeployment -ProjectId "${projectId}" -SourceEnvironment "${sourceEnvironment}" -TargetEnvironment "${targetEnvironment}"${includeBlob ? ' -IncludeBlob' : ''}${includeDatabase ? ' -IncludeDb' : ''}
\`\`\`

**Operation Details:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}`;
            } else if (stderr && stderr.trim()) {
                return `❌ **Content Copy Error**

**Error Details:**
\`\`\`
${stderr.trim()}
\`\`\`

**Operation Details:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

**Common Causes:**
- Invalid source or target environment names
- Insufficient permissions for source or target environments
- Environments temporarily unavailable
- Content sync restrictions between environment types

🔧 **Powered by:** PowerShell EpiCloud module`;
            } else if (stdout.trim()) {
                try {
                    // Parse the deployment result from PowerShell
                    const lines = stdout.split('\n');
                    const jsonLine = lines.find(line => line.trim().startsWith('{') && line.trim().endsWith('}'));
                    
                    if (jsonLine) {
                        const deploymentResult = JSON.parse(jsonLine.trim());
                        return `🚀 **Content Copy Started Successfully!**

✅ **Operation Details:**
- **Operation ID:** \`${deploymentResult.id}\`
- **Status:** ${deploymentResult.status}
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

📋 **What's Next:**
Your content copy is now processing in the background. This typically takes 30-60 minutes depending on:
- Database size
- BLOB storage size  
- System load

💡 **To check the status, ask me:**
"What's the status of deployment ${deploymentResult.id}?"

⏱️ **Estimated completion:** 30-60 minutes

⚠️ **Important:**
- Target environment will be unavailable during the copy process
- Any existing content in the target environment will be overwritten

🔧 **Powered by:** PowerShell EpiCloud module`;
                    } else {
                        // Try to parse entire output as JSON
                        const deploymentResult = JSON.parse(stdout.trim());
                        return `🚀 **Content Copy Started Successfully!**

✅ **Operation Details:**
- **Operation ID:** \`${deploymentResult.id}\`
- **Status:** ${deploymentResult.status}
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

📋 **What's Next:**
Your content copy is now processing in the background. This typically takes 30-60 minutes depending on data size and system load.

💡 **To check the status, ask me:**
"What's the status of deployment ${deploymentResult.id}?"

⏱️ **Estimated completion:** 30-60 minutes

🔧 **Powered by:** PowerShell EpiCloud module`;
                    }
                } catch (error) {
                    // Return raw PowerShell output if JSON parsing fails
                    return `📊 **Content Copy Started (PowerShell Output):**

\`\`\`
${stdout.trim()}
\`\`\`

**Operation Details:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

The content copy has been initiated. Check the status using the deployment ID from the output above.

🔧 **Powered by:** PowerShell EpiCloud module`;
                }
            } else {
                return `❌ **Content Copy Failed**

**Error Output:**
\`\`\`
${stderr || 'Unknown error occurred'}
\`\`\`

**Operation Details:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

**Troubleshooting:**
- Verify your API credentials have permission for both environments
- Check that the source and target environment names are correct
- Ensure no other operations are running on these environments`;
            }
        } catch (error) {
            // Check if it's the ongoing deployment error (priority check - most specific first)
            const errorMessage = error.message || '';
            
            if (errorMessage.includes('on-going deployment') || errorMessage.includes('not allowed when there is an on-going deployment') || (errorMessage.includes('Copying content') && errorMessage.includes('not allowed') && errorMessage.includes('deployment'))) {
                return `⚠️ **Deployment Already Running**

There is already an ongoing deployment operation for this project.

**Current Request:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

**What to do:**
1. Wait for the current deployment to complete (30-60 minutes)
2. Check existing deployment status in your [DXP Management Portal](https://paasportal.episerver.net)
3. Try again after the current deployment finishes

💡 **Tip:** Only one deployment can run per project at a time.

🔧 **Powered by:** PowerShell EpiCloud module`;
            } else if (errorMessage.includes('not recognized as a name of a cmdlet') && errorMessage.includes('Start-EpiDeployment')) {
                return `❌ **EpiCloud PowerShell Module Required**

To perform content copy operations, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Content Copy:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
Start-EpiDeployment -ProjectId "${projectId}" -SourceEnvironment "${sourceEnvironment}" -TargetEnvironment "${targetEnvironment}"${includeBlob ? ' -IncludeBlob' : ''}${includeDatabase ? ' -IncludeDb' : ''}
\`\`\`

**Operation Details:**
- **Source:** ${sourceEnvironment} → **Target:** ${targetEnvironment}
- **Include BLOB:** ${includeBlob}
- **Include Database:** ${includeDatabase}

🔧 **Powered by:** PowerShell EpiCloud module`;
            }
            throw new Error(`Content copy failed: ${error.message}`);
        }
    }

    async handleListStorageContainers(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid list storage containers arguments'
                    }
                };
            }

            const result = await this.listStorageContainers(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.environment
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error listing storage containers:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: `Error listing storage containers: ${error.message}`
                    }],
                    isError: true
                }
            };
        }
    }

    async listStorageContainers(apiKey, apiSecret, projectId, environment) {
        try {
            console.error(`Listing storage containers using PowerShell for ${environment} environment`);

            // Use PowerShell Get-EpiStorageContainer cmdlet
            const psScript = [
                'Import-Module EpiCloud -Force -ErrorAction SilentlyContinue',
                'if (Get-Module -Name EpiCloud) {',
                `    Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -ErrorAction SilentlyContinue`,
                '    try {',
                `        $containers = Get-EpiStorageContainer -ProjectId '${projectId}' -Environment '${environment}' | ConvertTo-Json -Depth 10 -Compress`,
                '        if ($containers) {',
                '            $containers',
                '        } else {',
                '            Write-Output "NO_CONTAINERS_FOUND"',
                '        }',
                '    } catch {',
                '        if ($_.Exception.Message -like "*500*") {',
                '            Write-Output "SERVER_ERROR:$($_.Exception.Message)"',
                '        } else {',
                '            Write-Output "STORAGE_ERROR:$($_.Exception.Message)"',
                '        }',
                '    }',
                '} else {',
                '    Write-Output "EPICCLOUD_MODULE_NOT_FOUND"',
                '}'
            ].join('; ');

            const { stdout, stderr } = await execAsync(`pwsh -Command "${psScript}"`);

            if (stdout.includes('EPICCLOUD_MODULE_NOT_FOUND')) {
                return `❌ **EpiCloud PowerShell Module Required**

To list storage containers, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Container Listing:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
Get-EpiStorageContainer -ProjectId "${projectId}" -Environment "${environment}"
\`\`\`

**Environment:** ${environment}`;
            } else if (stdout.includes('NO_CONTAINERS_FOUND')) {
                return `📁 **No Storage Containers Found**

**Environment:** ${environment}
**Project ID:** ${projectId}

This could mean:
- No BLOB storage containers are configured for this environment
- Containers exist but are not accessible with current credentials
- Environment doesn't have BLOB storage enabled`;
            } else if (stdout.includes('SERVER_ERROR:')) {
                const errorMessage = stdout.split('SERVER_ERROR:')[1] || 'Unknown server error';
                return `❌ **Server Error Listing Containers**

**Error Details:**
\`\`\`
${errorMessage.trim()}
\`\`\`

**Environment:** ${environment}
**Project ID:** ${projectId}

**Troubleshooting:**
- Wait a few minutes and try again
- Check your DXP Management Portal for system status
- Contact support if the issue persists`;
            } else if (stdout.includes('STORAGE_ERROR:')) {
                const errorMessage = stdout.split('STORAGE_ERROR:')[1] || 'Unknown storage error';
                return `❌ **Storage Container Error**

**Error Details:**
\`\`\`
${errorMessage.trim()}
\`\`\`

**Environment:** ${environment}
**Project ID:** ${projectId}

**Common Causes:**
- Invalid environment name
- Insufficient permissions for this environment
- Environment temporarily unavailable
- BLOB storage not configured for this environment`;
            } else if (stdout.trim()) {
                try {
                    // Extract JSON from PowerShell output (it might have table headers)
                    const lines = stdout.split('\n');
                    const jsonLine = lines.find(line => line.trim().startsWith('{') && line.trim().endsWith('}'));
                    
                    if (jsonLine) {
                        const containers = JSON.parse(jsonLine.trim());
                        return this.formatStorageContainers(containers, environment);
                    } else {
                        // Try to parse the entire output as JSON
                        const containers = JSON.parse(stdout.trim());
                        return this.formatStorageContainers(containers, environment);
                    }
                } catch (error) {
                    // Check if we can extract useful information from the raw output
                    if (stdout.includes('storageContainers')) {
                        const lines = stdout.split('\n');
                        const jsonLine = lines.find(line => line.includes('storageContainers'));
                        if (jsonLine) {
                            try {
                                const containers = JSON.parse(jsonLine.trim());
                                return this.formatStorageContainers(containers, environment);
                            } catch (e) {
                                // Fall through to raw output
                            }
                        }
                    }
                    
                    return `📊 **Storage Containers (PowerShell Output):**

**Environment:** ${environment}

\`\`\`
${stdout.trim()}
\`\`\`

The storage container information has been retrieved but couldn't be parsed as JSON.

🔧 **Powered by:** PowerShell EpiCloud module`;
                }
            } else {
                return `❌ **Failed to List Storage Containers**

**Environment:** ${environment}
**Error Output:**
\`\`\`
${stderr || 'Unknown error occurred'}
\`\`\`

**Troubleshooting:**
- Verify your API credentials have permission for this environment
- Check that the environment exists and has BLOB storage configured
- Ensure PowerShell EpiCloud module is properly installed`;
            }
        } catch (error) {
            throw new Error(`Storage container listing failed: ${error.message}`);
        }
    }

    formatStorageContainers(containers, environment) {
        if (!containers) {
            return `📁 **No Storage Containers Found**

**Environment:** ${environment}

This environment doesn't have any BLOB storage containers configured.`;
        }

        let result = `📁 **Storage Containers for ${environment}**\n\n`;
        
        // Handle the expected API response structure
        if (containers.storageContainers && Array.isArray(containers.storageContainers)) {
            const containerList = containers.storageContainers;
            result += `**Total Containers:** ${containerList.length}\n\n`;

            containerList.forEach((containerName, index) => {
                result += `### 📦 Container ${index + 1}\n`;
                result += `**Name:** ${containerName}\n`;
                
                // Add container type detection
                if (containerName.includes('logs')) {
                    result += `**Type:** Application Logs\n`;
                } else if (containerName.includes('media')) {
                    result += `**Type:** Media Storage\n`;
                } else if (containerName.includes('sourcemaps')) {
                    result += `**Type:** Source Maps\n`;
                } else {
                    result += `**Type:** General Storage\n`;
                }
                
                result += '\n';
            });
            
            if (containers.projectId) {
                result += `**Project ID:** ${containers.projectId}\n`;
            }
            if (containers.environment) {
                result += `**Environment:** ${containers.environment}\n\n`;
            }
        } else if (Array.isArray(containers)) {
            // Handle array of container objects
            result += `**Total Containers:** ${containers.length}\n\n`;
            
            containers.forEach((container, index) => {
                result += `### 📦 Container ${index + 1}\n`;
                
                if (typeof container === 'string') {
                    result += `**Name:** ${container}\n`;
                } else {
                    if (container.name) result += `**Name:** ${container.name}\n`;
                    if (container.url) result += `**URL:** ${container.url}\n`;
                    if (container.type) result += `**Type:** ${container.type}\n`;
                    if (container.status) result += `**Status:** ${container.status}\n`;
                }
                result += '\n';
            });
        } else {
            // Handle single container object
            result += `**Total Containers:** 1\n\n`;
            result += `### 📦 Container\n`;
            
            Object.keys(containers).forEach(key => {
                if (key !== 'storageContainers' && key !== 'projectId' && key !== 'environment') {
                    result += `**${key}:** ${containers[key]}\n`;
                }
            });
            result += '\n';
        }

        result += `💡 **Next Steps:**\n`;
        result += `- Generate SAS links for container access\n`;
        result += `- Download/upload files to containers\n`;
        result += `- Sync containers between environments\n`;

        return result;
    }

    async handleTestEpiCloudConnection(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid test connection arguments'
                    }
                };
            }

            const result = await this.testEpiCloudConnection(
                args.apiKey,
                args.apiSecret,
                args.projectId
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error testing EpiCloud connection:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: `Error testing EpiCloud connection: ${error.message}`
                    }],
                    isError: true
                }
            };
        }
    }

    async testEpiCloudConnection(apiKey, apiSecret, projectId) {
        try {
            console.error(`Testing EpiCloud PowerShell connection for project ${projectId}`);

            // Test connection without -ErrorAction SilentlyContinue to see actual errors
            const psScript = [
                'Import-Module EpiCloud -Force',
                'Write-Output "Module imported successfully"',
                `Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'`,
                'Write-Output "Connection attempt completed"',
                'Get-EpiCloud',
                'Write-Output "Connection details retrieved"'
            ].join('; ');

            const { stdout, stderr } = await execAsync(`pwsh -Command "${psScript}"`);
            
            let result = `🔧 **EpiCloud PowerShell Connection Test**\n\n`;
            result += `**Project ID:** ${projectId}\n`;
            result += `**API Key:** ${apiKey.substring(0, 8)}...\n\n`;
            
            if (stdout.trim()) {
                result += `**PowerShell Output:**\n\`\`\`\n${stdout.trim()}\n\`\`\`\n\n`;
            }
            
            if (stderr.trim()) {
                result += `**PowerShell Errors:**\n\`\`\`\n${stderr.trim()}\n\`\`\`\n\n`;
            }
            
            // Check for success indicators
            if (stdout.includes('AuthenticationVerified') && stdout.includes('True')) {
                result += `✅ **Connection Status:** SUCCESS\n`;
                result += `Authentication verified successfully!\n\n`;
                result += `**Available Operations:**\n`;
                result += `- Database exports\n`;
                result += `- Storage container management\n`;
                result += `- Deployment operations\n`;
                result += `- Content synchronization\n`;
            } else if (stdout.includes('AuthenticationVerified') && stdout.includes('False')) {
                result += `❌ **Connection Status:** AUTHENTICATION FAILED\n`;
                result += `The credentials are invalid or don't have access to this project.\n\n`;
                result += `**Troubleshooting:**\n`;
                result += `- Verify API key and secret are correct\n`;
                result += `- Check that credentials have access to project ${projectId}\n`;
                result += `- Ensure credentials are for the correct environment\n`;
            } else {
                result += `⚠️ **Connection Status:** UNCLEAR\n`;
                result += `Connection test completed but status is unclear.\n`;
            }
            
            return result;
        } catch (error) {
            throw new Error(`EpiCloud connection test failed: ${error.message}`);
        }
    }

    async handleGetDeploymentStatus(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid deployment status arguments'
                    }
                };
            }

            const result = await this.getDeploymentStatus(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.deploymentId
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error getting deployment status:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }

    async getDeploymentStatus(apiKey, apiSecret, projectId, deploymentId = null) {
        try {
            console.error(`Getting deployment status for project ${projectId}${deploymentId ? `, deployment ${deploymentId}` : ' (all deployments)'}`);
            
            // Build PowerShell command - with or without specific deployment ID
            const deploymentCommand = deploymentId 
                ? `Get-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -Id '${deploymentId}'`
                : `Get-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'`;
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${deploymentCommand} | ConvertTo-Json -Depth 10 -Compress`;
            const { stdout, stderr } = await execAsync(`pwsh -Command "${psScript}"`);
            
            // Check for PowerShell module error
            if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To check deployment status, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Deployment Status Check:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
${deploymentCommand}
\`\`\`

**Project ID:** ${projectId}
${deploymentId ? `**Deployment ID:** ${deploymentId}` : '**Mode:** List all recent deployments'}`;
            }
            
            if (stderr && stderr.trim()) {
                return `❌ **Deployment Status Error**

**Error Details:**
\`\`\`
${stderr.trim()}
\`\`\`

**Project ID:** ${projectId}
${deploymentId ? `**Deployment ID:** ${deploymentId}` : '**Mode:** List all recent deployments'}`;
            }
            
            // Parse JSON from PowerShell output (skip any table headers)
            const lines = stdout.split('\n');
            let jsonContent = '';
            let foundJson = false;
            
            for (const line of lines) {
                if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                    foundJson = true;
                }
                if (foundJson) {
                    jsonContent += line;
                }
            }
            
            if (!jsonContent.trim()) {
                return `⚠️ **No Deployment Data Found**

No deployments found for this project.

**Project ID:** ${projectId}
${deploymentId ? `**Deployment ID:** ${deploymentId}` : '**Recent Deployments:** None'}

💡 **Note:** Only the 10 most recent deployments are returned by the API.`;
            }
            
            const deployments = JSON.parse(jsonContent);
            const isArray = Array.isArray(deployments);
            const deploymentList = isArray ? deployments : [deployments];
            
            if (deploymentList.length === 0) {
                return `⚠️ **No Deployments Found**

No deployments found for this project.

**Project ID:** ${projectId}
${deploymentId ? `**Deployment ID:** ${deploymentId}` : ''}`;
            }
            
            // Format response
            let result = deploymentId 
                ? `🚀 **Deployment Status**\n\n`
                : `🚀 **Recent Deployments** (Latest ${deploymentList.length} deployments)\n\n`;
            
            deploymentList.forEach((deployment, index) => {
                const status = deployment.status || 'Unknown';
                const statusEmoji = this.getStatusEmoji(status);
                const startTime = deployment.startTime ? new Date(deployment.startTime).toLocaleString() : 'Unknown';
                const endTime = deployment.endTime ? new Date(deployment.endTime).toLocaleString() : 'In Progress';
                const percentComplete = deployment.percentComplete || 0;
                const duration = this.calculateDuration(deployment.startTime, deployment.endTime);
                
                result += `${statusEmoji} **${status.toUpperCase()}** - ${deployment.id}\n`;
                result += `**Started:** ${startTime}\n`;
                result += `**${deployment.endTime ? 'Completed' : 'Current Progress'}:** ${deployment.endTime ? endTime : percentComplete + '%'}\n`;
                if (duration) result += `**Duration:** ${duration}\n`;
                
                // Add deployment parameters
                const params = deployment.parameters || {};
                if (params.sourceEnvironment && params.targetEnvironment) {
                    result += `**Operation:** ${params.sourceEnvironment} → ${params.targetEnvironment}\n`;
                } else if (params.targetEnvironment) {
                    result += `**Target Environment:** ${params.targetEnvironment}\n`;
                }
                
                if (params.packages && params.packages.length > 0) {
                    result += `**Packages:** ${params.packages.join(', ')}\n`;
                }
                
                if (params.includeBlob !== undefined || params.includeDb !== undefined) {
                    const options = [];
                    if (params.includeBlob) options.push('BLOB');
                    if (params.includeDb) options.push('Database');
                    if (options.length > 0) result += `**Content:** ${options.join(' + ')}\n`;
                }
                
                // Add validation links if available
                if (deployment.validationLinks && deployment.validationLinks.length > 0) {
                    result += `🔗 **Preview URL:** ${deployment.validationLinks[0]}\n`;
                    if (deployment.validationLinks.length > 1) {
                        result += `🔗 **Additional URLs:** ${deployment.validationLinks.slice(1).join(', ')}\n`;
                    }
                }
                
                // Add warnings and errors if any
                if (deployment.deploymentWarnings && deployment.deploymentWarnings.length > 0) {
                    result += `⚠️ **Warnings:** ${deployment.deploymentWarnings.length}\n`;
                }
                if (deployment.deploymentErrors && deployment.deploymentErrors.length > 0) {
                    result += `❌ **Errors:** ${deployment.deploymentErrors.length}\n`;
                }
                
                if (!deploymentId && index < deploymentList.length - 1) {
                    result += `\n---\n\n`;
                }
            });
            
            result += `\n\n🔧 **Powered by:** PowerShell EpiCloud module`;
            
            return result;
            
        } catch (error) {
            throw new Error(`Get deployment status failed: ${error.message}`);
        }
    }
    
    getStatusEmoji(status) {
        switch (status?.toLowerCase()) {
            case 'succeeded': return '✅';
            case 'inprogress': return '🔄';
            case 'failed': return '❌';
            case 'canceled': case 'cancelled': return '⛔';
            case 'reset': return '🔄';
            default: return '❓';
        }
    }
    
    calculateDuration(startTime, endTime) {
        if (!startTime) return null;
        
        const start = new Date(startTime);
        const end = endTime ? new Date(endTime) : new Date();
        const diffMs = end - start;
        
        if (diffMs < 60000) { // Less than 1 minute
            return Math.round(diffMs / 1000) + ' seconds';
        } else if (diffMs < 3600000) { // Less than 1 hour
            return Math.round(diffMs / 60000) + ' minutes';
        } else {
            const hours = Math.floor(diffMs / 3600000);
            const minutes = Math.round((diffMs % 3600000) / 60000);
            return hours + 'h ' + minutes + 'm';
        }
    }

    async handleGenerateStorageSasLink(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.environment || !args.containers) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid storage SAS link arguments'
                    }
                };
            }

            const result = await this.generateStorageSasLink(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.environment,
                args.containers,
                args.retentionHours || 24,
                args.writable || false
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error generating storage SAS links:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }

    async generateStorageSasLink(apiKey, apiSecret, projectId, environment, containers, retentionHours, writable) {
        try {
            console.error(`Generating SAS links for ${containers.length} container(s) in ${environment} environment`);
            
            // Build PowerShell array for containers
            const containersArray = containers.map(c => `'${c}'`).join(',');
            const containersParam = containers.length === 1 ? `'${containers[0]}'` : `@(${containersArray})`;
            
            // Build SAS link command
            const sasCommand = `Get-EpiStorageContainerSasLink -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -Environment '${environment}' -StorageContainer ${containersParam} -RetentionHours ${retentionHours}${writable ? ' -Writable' : ''}`;
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${sasCommand} | ConvertTo-Json -Depth 10 -Compress`;
            let stdout, stderr;
            
            try {
                const result = await execAsync(`pwsh -Command "${psScript}"`);
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error) {
                // PowerShell errors get caught here
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            }
            
            // Check for PowerShell module error
            if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To generate storage SAS links, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual SAS Link Generation:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
${sasCommand}
\`\`\`

**Operation Details:**
- **Environment:** ${environment}
- **Containers:** ${containers.join(', ')}
- **Retention:** ${retentionHours} hours
- **Access Type:** ${writable ? 'Read/Write' : 'Read-Only'}`;
            }
            
            // Check for API errors in stderr (multiple error types)
            if (stderr && (stderr.includes('Bad Request') || stderr.includes('Not Found') || stderr.includes('API call failed'))) {
                // Try multiple regex patterns to extract error messages
                let errorMessage = 'Unknown API error';
                
                // First try to match the JSON error format
                const jsonErrorMatch = stderr.match(/"errors":\["(.+?)"/);
                if (jsonErrorMatch) {
                    errorMessage = jsonErrorMatch[1];
                } else {
                    // Try to match other error patterns
                    const notFoundMatch = stderr.match(/container (.+?) was not found/);
                    if (notFoundMatch) {
                        errorMessage = `Container '${notFoundMatch[1]}' was not found in the associated subscription`;
                    }
                }
                
                return `❌ **Storage Container Error**

**API Error:** ${errorMessage}

**Operation Details:**
- **Environment:** ${environment}  
- **Containers:** ${containers.join(', ')}
- **Access Type:** ${writable ? 'Read/Write' : 'Read-Only'}

**Common Issues:**
- Some containers (like azure-application-logs) don't exist in Integration environment
- Some containers don't support writable access
- Container names must be valid and exist in the environment
- Check container names with the list_storage_containers tool first`;
            }
            
            if (stderr && stderr.trim()) {
                return `❌ **SAS Link Generation Error**

**Error Details:**
\`\`\`
${stderr.trim()}
\`\`\`

**Operation Details:**
- **Environment:** ${environment}
- **Containers:** ${containers.join(', ')}
- **Retention:** ${retentionHours} hours
- **Access Type:** ${writable ? 'Read/Write' : 'Read-Only'}`;
            }
            
            // Parse JSON from PowerShell output (skip any table headers)
            const lines = stdout.split('\n');
            let jsonContent = '';
            let foundJson = false;
            
            for (const line of lines) {
                if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                    foundJson = true;
                }
                if (foundJson) {
                    jsonContent += line;
                }
            }
            
            if (!jsonContent.trim()) {
                return `⚠️ **No SAS Link Data Found**

Unable to generate SAS links for the specified containers.

**Operation Details:**
- **Environment:** ${environment}
- **Containers:** ${containers.join(', ')}
- **Retention:** ${retentionHours} hours
- **Access Type:** ${writable ? 'Read/Write' : 'Read-Only'}

💡 **Tip:** Verify container names exist using the list_storage_containers tool first.`;
            }
            
            const sasData = JSON.parse(jsonContent);
            const sasLinks = Array.isArray(sasData) ? sasData : [sasData];
            
            if (sasLinks.length === 0) {
                return `⚠️ **No SAS Links Generated**

No SAS links were generated for the specified containers.

**Environment:** ${environment}
**Containers:** ${containers.join(', ')}`;
            }
            
            // Format response
            let result = `🔗 **Storage SAS Links Generated**\n\n`;
            result += `**Environment:** ${environment}\n`;
            result += `**Access Type:** ${writable ? '📝 Read/Write' : '👁️ Read-Only'}\n`;
            result += `**Valid For:** ${retentionHours} hours\n\n`;
            
            sasLinks.forEach((link, index) => {
                const expiresOn = link.expiresOn ? new Date(link.expiresOn).toLocaleString() : 'Unknown';
                
                result += `📦 **${link.containerName}**\n`;
                result += `**Expires:** ${expiresOn}\n`;
                result += `**SAS URL:** \`${link.sasLink}\`\n`;
                
                // Extract permissions from SAS URL
                const permMatch = link.sasLink.match(/sp=([^&]+)/);
                const permissions = permMatch ? permMatch[1] : 'unknown';
                const permissionText = this.formatSasPermissions(permissions);
                if (permissionText) result += `**Permissions:** ${permissionText}\n`;
                
                if (index < sasLinks.length - 1) {
                    result += `\n---\n\n`;
                }
            });
            
            result += `\n\n💡 **Usage Tips:**\n`;
            result += `- Use these URLs with Azure Storage Explorer or REST API calls\n`;
            result += `- ${writable ? 'You can upload, download, and modify files' : 'You can only download and list files'}\n`;
            result += `- Links expire automatically after ${retentionHours} hours\n`;
            result += `\n🔧 **Powered by:** PowerShell EpiCloud module`;
            
            return result;
            
        } catch (error) {
            throw new Error(`Generate storage SAS link failed: ${error.message}`);
        }
    }
    
    formatSasPermissions(permissions) {
        const permMap = {
            'r': 'Read',
            'w': 'Write', 
            'l': 'List',
            'd': 'Delete',
            'c': 'Create'
        };
        
        if (!permissions || permissions === 'unknown') return null;
        
        const permArray = permissions.split('').map(p => permMap[p]).filter(Boolean);
        return permArray.join(', ');
    }
    async handleGetEdgeLogs(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid get edge logs arguments'
                    }
                };
            }
            const result = await this.getEdgeLogs(
                args.apiKey,
                args.apiSecret,
                args.projectId
            );
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error getting edge logs:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }
    async getEdgeLogs(apiKey, apiSecret, projectId) {
        try {
            console.error(`Getting edge logs using PowerShell for project ${projectId}`);
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; Get-EpiEdgeLogLocation -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' | ConvertTo-Json -Depth 10 -Compress`;
            
            let stdout, stderr;
            try {
                const result = await execAsync(`pwsh -Command "${psScript}"`);
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error) {
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            }
            // Check for PowerShell module error
            if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To get edge logs, you need the EpiCloud PowerShell module installed:
**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`
**Manual Edge Log Access:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
Get-EpiEdgeLogLocation -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
\`\`\`
**Project Details:**
- **Project ID:** ${projectId}`;
            }
            // Check for authentication errors
            if (stderr && (stderr.includes('authentication') || stderr.includes('unauthorized') || stderr.includes('403') || stderr.includes('401'))) {
                return `❌ **Authentication Failed**

The API credentials are invalid or don't have permission for this operation.

**Troubleshooting:**
- Verify your API key and secret are correct
- Check that the credentials have permission for project ${projectId}
- Ensure the project ${projectId} exists and you have access to it

**Project ID:** ${projectId}`;
            }
            // Check for generic errors in stderr
            if (stderr && stderr.includes('error')) {
                return `❌ **Get Edge Logs Failed**\n\n${stderr}\n\n**Project ID:** ${projectId}`;
            }
            // Try to parse JSON response
            if (stdout && stdout.trim()) {
                try {
                    // Parse potential JSON from mixed PowerShell output
                    let foundJson = false;
                    let jsonLines = [];
                    const lines = stdout.split('\n');
                    
                    for (const line of lines) {
                        if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                            foundJson = true;
                        }
                        if (foundJson) {
                            jsonLines.push(line);
                        }
                    }
                    
                    if (jsonLines.length > 0) {
                        const jsonString = jsonLines.join('\n');
                        const logData = JSON.parse(jsonString);
                        return this.formatEdgeLogResponse(logData, projectId);
                    }
                } catch (parseError) {
                    console.error('JSON parsing failed:', parseError);
                    // Continue to return raw output
                }
            }
            // Return raw output if no JSON parsing succeeded
            if (stdout && stdout.trim()) {
                return `📋 **Edge Logs Location**\n\n${stdout.trim()}\n\n**Project ID:** ${projectId}\n\n🔧 **Powered by:** PowerShell EpiCloud module`;
            } else {
                return `⚠️ **No Edge Logs Available**\n\nNo edge logs were found for this project.\n\n**Project ID:** ${projectId}\n\n**Possible Reasons:**
- No recent edge/CDN activity
- Logs have expired (typically retained for 30 days)
- Project may not have CDN enabled

🔧 **Powered by:** PowerShell EpiCloud module`;
            }
        } catch (error) {
            throw new Error(`Get edge logs failed: ${error.message}`);
        }
    }
    formatEdgeLogResponse(logData, projectId) {
        // logData could be a string (SAS URL) or object with multiple properties
        let result = `📋 **Edge/CDN Logs Access**\n\n`;
        
        if (typeof logData === 'string') {
            // Simple SAS URL response
            result += `**Project ID:** ${projectId}\n`;
            result += `**SAS URL:** \`${logData}\`\n\n`;
            
            // Extract expiration from SAS URL if available
            const expiryMatch = logData.match(/se=([^&]+)/);
            if (expiryMatch) {
                const expiryDate = decodeURIComponent(expiryMatch[1]);
                result += `**Expires:** ${new Date(expiryDate).toLocaleString()}\n`;
            }
        } else if (logData && typeof logData === 'object') {
            // Complex response with multiple log sources
            result += `**Project ID:** ${projectId}\n\n`;
            
            if (logData.sasLink || logData.SasLink) {
                const sasUrl = logData.sasLink || logData.SasLink;
                result += `**SAS URL:** \`${sasUrl}\`\n\n`;
                
                const expiryMatch = sasUrl.match(/se=([^&]+)/);
                if (expiryMatch) {
                    const expiryDate = decodeURIComponent(expiryMatch[1]);
                    result += `**Expires:** ${new Date(expiryDate).toLocaleString()}\n`;
                }
            }
            
            // Add any additional properties
            Object.keys(logData).forEach(key => {
                if (key !== 'sasLink' && key !== 'SasLink') {
                    result += `**${key}:** ${logData[key]}\n`;
                }
            });
        } else {
            result += `**Project ID:** ${projectId}\n`;
            result += `**Raw Response:** ${JSON.stringify(logData)}\n\n`;
        }
        
        result += `\n💡 **Usage Tips:**\n`;
        result += `- Use the SAS URL with Azure Storage Explorer or REST API calls\n`;
        result += `- Edge logs typically contain CDN access logs and performance data\n`;
        result += `- Logs are usually available for the past 30 days\n`;
        result += `- Download logs for analysis with log processing tools\n\n`;
        
        result += `🔧 **Powered by:** PowerShell EpiCloud module`;
        
        return result;
    }

    async handleUploadDeploymentPackage(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.packagePath) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid deployment package upload arguments'
                    }
                };
            }

            const result = await this.uploadDeploymentPackage(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.packagePath,
                args.packageName
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error uploading deployment package:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }

    async uploadDeploymentPackage(apiKey, apiSecret, projectId, packagePath, packageName = null) {
        try {
            console.error(`Starting deployment package upload for project ${projectId}`);
            console.error(`Package path: ${packagePath}`);
            
            // Step 1: Get the deployment package upload location (SAS URL)
            const locationCommand = `Get-EpiDeploymentPackageLocation -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'`;
            const psLocationScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${locationCommand}`;
            
            let locationStdout, locationStderr;
            try {
                const locationResult = await execAsync(`pwsh -Command "${psLocationScript}"`);
                locationStdout = locationResult.stdout;
                locationStderr = locationResult.stderr;
            } catch (error) {
                locationStdout = error.stdout || '';
                locationStderr = error.stderr || '';
            }

            // Check for PowerShell module error
            if (locationStderr && locationStderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To upload deployment packages, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Package Upload:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
\\$sasUrl = Get-EpiDeploymentPackageLocation -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
Add-EpiDeploymentPackage -SasUrl \\$sasUrl -Path "${packagePath}"
\`\`\`

**Package Details:**
- **Path:** ${packagePath}
- **Project ID:** ${projectId}`;
            }

            if (locationStderr && locationStderr.trim()) {
                return `❌ **Package Upload Location Error**

**Error Details:**
\`\`\`
${locationStderr.trim()}
\`\`\`

**Package Details:**
- **Path:** ${packagePath}
- **Project ID:** ${projectId}`;
            }

            // Extract SAS URL from PowerShell output (skip table headers)
            const lines = locationStdout.split('\n');
            let sasUrl = '';
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('https://') && trimmedLine.includes('blob.core.windows.net')) {
                    sasUrl = trimmedLine.replace(/"/g, ''); // Remove any quotes
                    break;
                }
            }

            if (!sasUrl) {
                return `⚠️ **No Upload Location Found**

Unable to get deployment package upload location.

**Package Details:**
- **Path:** ${packagePath}
- **Project ID:** ${projectId}

💡 **Troubleshooting:**
- Verify API credentials have deployment permissions
- Check if project ID is correct`;
            }

            console.error(`Got SAS URL: ${sasUrl.substring(0, 50)}...`);

            // Step 2: Upload the package using Add-EpiDeploymentPackage
            const blobName = packageName || require('path').basename(packagePath);
            const uploadCommand = `Add-EpiDeploymentPackage -SasUrl '${sasUrl}' -Path '${packagePath}' -BlobName '${blobName}'`;
            const psUploadScript = `Import-Module EpiCloud -Force; ${uploadCommand}`;
            
            let uploadStdout, uploadStderr;
            try {
                const uploadResult = await execAsync(`pwsh -Command "${psUploadScript}"`);
                uploadStdout = uploadResult.stdout;
                uploadStderr = uploadResult.stderr;
            } catch (error) {
                uploadStdout = error.stdout || '';
                uploadStderr = error.stderr || '';
            }

            // Check for upload errors
            if (uploadStderr && uploadStderr.includes('Azure.Storage')) {
                return `❌ **Azure Storage Module Required**

The upload requires the Azure.Storage PowerShell module:

**Installation:**
\`\`\`powershell
Install-Module Az.Storage -Force
\`\`\`

**Package Details:**
- **Path:** ${packagePath}
- **Blob Name:** ${blobName}
- **Project ID:** ${projectId}`;
            }

            if (uploadStderr && uploadStderr.trim()) {
                return `❌ **Package Upload Failed**

**Error Details:**
\`\`\`
${uploadStderr.trim()}
\`\`\`

**Package Details:**
- **Path:** ${packagePath}
- **Blob Name:** ${blobName}
- **Project ID:** ${projectId}

**Common Issues:**
- File path doesn't exist or is inaccessible
- Package file is locked by another process
- Insufficient disk space or permissions`;
            }

            // Format successful response
            const fileSize = this.getFileSizeDescription(packagePath);
            
            let result = `🚀 **Deployment Package Uploaded Successfully!**\n\n`;
            result += `✅ **Upload Complete**\n`;
            result += `**Package:** ${blobName}\n`;
            result += `**Source:** ${packagePath}\n`;
            result += `**Project ID:** ${projectId}\n`;
            if (fileSize) result += `**Size:** ${fileSize}\n`;
            result += `\n📋 **Next Steps:**\n`;
            result += `1. The package is now available for deployment\n`;
            result += `2. Use the deployment tools to deploy this package to an environment\n`;
            result += `3. Package name to reference: \`${blobName}\`\n`;
            result += `\n💡 **Package Management:**\n`;
            result += `- Packages are retained in the deployment container\n`;
            result += `- Multiple versions can be uploaded simultaneously\n`;
            result += `- Use descriptive names to identify different versions\n`;
            result += `\n🔧 **Powered by:** PowerShell EpiCloud module`;
            
            return result;
            
        } catch (error) {
            throw new Error(`Upload deployment package failed: ${error.message}`);
        }
    }
    
    getFileSizeDescription(filePath) {
        try {
            const fs = require('fs');
            const stats = fs.statSync(filePath);
            const bytes = stats.size;
            
            if (bytes < 1024) return bytes + ' bytes';
            if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
            if (bytes < 1073741824) return Math.round(bytes / 1048576) + ' MB';
            return Math.round(bytes / 1073741824) + ' GB';
        } catch (error) {
            return null;
        }
    }

    async handleStartDeployment(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.targetEnvironment) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid start deployment arguments'
                    }
                };
            }

            const result = await this.startDeployment(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.targetEnvironment,
                args.packages,
                args.sourceEnvironment,
                args.sourceApps,
                args.includeBlob,
                args.includeDatabase,
                args.useMaintenancePage,
                args.directDeploy,
                args.zeroDowntimeMode,
                args.warmUpUrl,
                args.waitForCompletion,
                args.waitTimeoutMinutes
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error starting deployment:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }

    async startDeployment(apiKey, apiSecret, projectId, targetEnvironment, packages = null, sourceEnvironment = null, sourceApps = null, includeBlob = false, includeDatabase = false, useMaintenancePage = false, directDeploy = false, zeroDowntimeMode = null, warmUpUrl = null, waitForCompletion = false, waitTimeoutMinutes = 30) {
        try {
            const isPackageDeployment = packages && packages.length > 0;
            const isEnvironmentDeployment = sourceEnvironment && !isPackageDeployment;
            
            // Validate parameter combinations
            if (directDeploy && zeroDowntimeMode) {
                return `❌ **Invalid Configuration**

DirectDeploy and Zero Downtime Mode cannot be used together.

**Choose one approach:**
- **DirectDeploy**: Fast deployment directly to target (Integration/Development)
- **Zero Downtime**: Smooth deployment with traffic management (Production)

**Current Configuration:**
- **DirectDeploy:** ${directDeploy}
- **Zero Downtime Mode:** ${zeroDowntimeMode}`;
            }
            
            if (zeroDowntimeMode && targetEnvironment === 'Integration') {
                return `⚠️ **Configuration Warning**

Zero Downtime Mode is typically used for Production deployments.
For Integration environment, DirectDeploy is usually faster and sufficient.

**Recommendation:**
- Use DirectDeploy for Integration/Development environments
- Use Zero Downtime Mode for Production environments

**Current Configuration:**
- **Target:** ${targetEnvironment}
- **Zero Downtime Mode:** ${zeroDowntimeMode}

Continue anyway? Consider using DirectDeploy for faster Integration deployments.`;
            }
            
            console.error(`Starting ${isPackageDeployment ? 'package' : 'environment'} deployment to ${targetEnvironment}`);
            
            // Build PowerShell command based on deployment type
            let deployCommand = `Start-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -TargetEnvironment '${targetEnvironment}'`;
            
            if (isPackageDeployment) {
                // Package deployment
                const packagesArray = packages.map(p => `'${p}'`).join(',');
                const packagesParam = packages.length === 1 ? `'${packages[0]}'` : `@(${packagesArray})`;
                deployCommand += ` -DeploymentPackage ${packagesParam}`;
            } else if (isEnvironmentDeployment) {
                // Environment-to-environment deployment
                deployCommand += ` -SourceEnvironment '${sourceEnvironment}'`;
                if (sourceApps && sourceApps.length > 0) {
                    const appsArray = sourceApps.map(a => `'${a}'`).join(',');
                    const appsParam = sourceApps.length === 1 ? `'${sourceApps[0]}'` : `@(${appsArray})`;
                    deployCommand += ` -SourceApp ${appsParam}`;
                }
                if (includeBlob) deployCommand += ' -IncludeBlob';
                if (includeDatabase) deployCommand += ' -IncludeDb';
            }
            
            // Add optional parameters
            if (useMaintenancePage) deployCommand += ' -UseMaintenancePage';
            if (directDeploy) deployCommand += ' -DirectDeploy';
            if (zeroDowntimeMode) deployCommand += ` -ZeroDownTimeMode '${zeroDowntimeMode}'`;
            if (waitForCompletion) {
                deployCommand += ' -Wait';
                if (waitTimeoutMinutes && waitTimeoutMinutes !== 30) {
                    deployCommand += ` -WaitTimeoutMinutes ${waitTimeoutMinutes}`;
                }
            }
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${deployCommand} | ConvertTo-Json -Depth 10 -Compress`;
            
            let stdout, stderr;
            try {
                const result = await execAsync(`pwsh -Command "${psScript}"`);
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error) {
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            }

            // Check for PowerShell module error
            if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To start deployments, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Deployment:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
${deployCommand}
\`\`\`

**Deployment Details:**
- **Target Environment:** ${targetEnvironment}
${isPackageDeployment ? `- **Packages:** ${packages.join(', ')}` : ''}
${isEnvironmentDeployment ? `- **Source Environment:** ${sourceEnvironment}` : ''}`;
            }

            // Check for deployment conflicts (ongoing deployment) - check both text and JSON
            const ongoingDeploymentCheck = stderr && (
                stderr.includes('on-going deployment') || 
                stderr.includes('not allowed when there is an on-going deployment') || 
                stderr.includes('already an on-going code deployment') ||
                stderr.includes('there is already an on-going code deployment')
            );
            
            if (ongoingDeploymentCheck) {
                return `⚠️ **Deployment Already Running**

There is already an ongoing deployment operation for this project.

**Current Request:**
- **Target Environment:** ${targetEnvironment}
${isPackageDeployment ? `- **Packages:** ${packages.join(', ')}` : ''}
${isEnvironmentDeployment ? `- **Source Environment:** ${sourceEnvironment}` : ''}

**What to do:**
1. Wait for the current deployment to complete
2. Check deployment status using the get_deployment_status tool
3. Try again after the current deployment finishes

💡 **Tip:** Only one deployment can run per project at a time.`;
            }

            if (stderr && stderr.trim()) {
                return `❌ **Deployment Start Error**

**Error Details:**
\`\`\`
${stderr.trim()}
\`\`\`

**Deployment Details:**
- **Target Environment:** ${targetEnvironment}
${isPackageDeployment ? `- **Packages:** ${packages.join(', ')}` : ''}
${isEnvironmentDeployment ? `- **Source Environment:** ${sourceEnvironment}` : ''}`;
            }

            // Parse JSON from PowerShell output (skip table headers)
            const lines = stdout.split('\n');
            let jsonContent = '';
            let foundJson = false;
            
            for (const line of lines) {
                if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                    foundJson = true;
                }
                if (foundJson) {
                    jsonContent += line;
                }
            }

            if (!jsonContent.trim()) {
                return `⚠️ **No Deployment Response**

The deployment command completed but no deployment data was returned.

**Deployment Details:**
- **Target Environment:** ${targetEnvironment}
${isPackageDeployment ? `- **Packages:** ${packages.join(', ')}` : ''}
${isEnvironmentDeployment ? `- **Source Environment:** ${sourceEnvironment}` : ''}`;
            }

            const deployment = JSON.parse(jsonContent);
            
            // Handle warm-up if DirectDeploy and warmUpUrl provided
            let warmUpResult = '';
            if (directDeploy && warmUpUrl && deployment.status === 'Succeeded') {
                warmUpResult = await this.performWarmUp(warmUpUrl);
            }
            
            // Format successful deployment start response
            let result = `🚀 **Deployment ${waitForCompletion && deployment.status === 'Succeeded' ? 'Completed' : 'Started'} Successfully!**\n\n`;
            result += `✅ **Deployment ${waitForCompletion && deployment.status === 'Succeeded' ? 'Complete' : 'Initiated'}**\n`;
            result += `**Deployment ID:** \`${deployment.id}\`\n`;
            result += `**Status:** ${deployment.status}\n`;
            result += `**Target Environment:** ${targetEnvironment}\n`;
            result += `**Started:** ${new Date(deployment.startTime).toLocaleString()}\n`;
            
            if (deployment.endTime) {
                result += `**Completed:** ${new Date(deployment.endTime).toLocaleString()}\n`;
                const duration = Math.round((new Date(deployment.endTime) - new Date(deployment.startTime)) / 60000);
                result += `**Duration:** ${duration} minutes\n`;
            } else if (deployment.percentComplete !== undefined) {
                result += `**Progress:** ${deployment.percentComplete}%\n`;
            }
            
            // Add deployment-specific details
            const params = deployment.parameters || {};
            if (isPackageDeployment) {
                result += `**Packages:** ${packages.join(', ')}\n`;
                result += `**Type:** Package Deployment\n`;
            } else if (isEnvironmentDeployment) {
                result += `**Source:** ${sourceEnvironment} → ${targetEnvironment}\n`;
                result += `**Type:** Environment-to-Environment\n`;
                if (sourceApps && sourceApps.length > 0) {
                    result += `**Source Apps:** ${sourceApps.join(', ')}\n`;
                }
                if (includeBlob || includeDatabase) {
                    const content = [];
                    if (includeBlob) content.push('BLOB');
                    if (includeDatabase) content.push('Database');
                    result += `**Content:** ${content.join(' + ')}\n`;
                }
            }
            
            // Add deployment options
            const options = [];
            if (useMaintenancePage) options.push('Maintenance Page');
            if (directDeploy) options.push('Direct Deploy');
            if (zeroDowntimeMode) {
                const modeDescription = zeroDowntimeMode === 'ReadOnly' ? 
                    'Zero Downtime (ReadOnly - Recommended)' : 
                    'Zero Downtime (ReadWrite - Data Loss Risk)';
                options.push(modeDescription);
            }
            if (waitForCompletion) options.push(`Wait for Completion (${waitTimeoutMinutes}min)`);
            if (options.length > 0) {
                result += `**Options:** ${options.join(', ')}\n`;
            }
            
            // Add zero downtime mode explanation if used
            if (zeroDowntimeMode) {
                result += `\n🔄 **Zero Downtime Deployment:**\n`;
                if (zeroDowntimeMode === 'ReadOnly') {
                    result += `✅ **ReadOnly Mode**: Database writes disabled during deployment (recommended)\n`;
                    result += `✅ **Data Safety**: No data loss - cloned environment prevents write conflicts\n`;
                    result += `✅ **Best Practice**: Ensures data integrity during deployment process\n`;
                } else {
                    result += `⚠️ **ReadWrite Mode**: Database writes allowed during deployment\n`;
                    result += `⚠️ **Data Risk**: Any data written during deployment may be lost\n`;
                    result += `⚠️ **Use Case**: Only when data loss is acceptable\n`;
                }
                result += `📋 **Process**: Creates cloned environment to manage traffic during deployment\n`;
            }
            
            // Add warm-up results if performed
            if (warmUpResult) {
                result += `\n${warmUpResult}\n`;
            }
            
            // Conditional next steps based on deployment status
            if (waitForCompletion && deployment.status === 'Succeeded') {
                result += `\n🎉 **Deployment Complete!**\n`;
                result += `✅ Your deployment is now live and ready to use\n`;
                if (directDeploy) {
                    result += `✅ Direct deployment - no additional steps needed\n`;
                }
            } else {
                result += `\n📋 **What's Next:**\n`;
                if (!waitForCompletion) {
                    result += `1. Monitor deployment progress using get_deployment_status\n`;
                    result += `2. Deployment typically takes 5-15 minutes for packages\n`;
                }
                result += `3. ${directDeploy ? 'Direct deployment will go live automatically' : 'Deployment will be in staging slot awaiting verification'}\n`;
                
                if (!directDeploy && isPackageDeployment) {
                    result += `\n⚠️ **Important:**\n`;
                    result += `- This deployment is in a staging slot\n`;
                    result += `- Use complete_deployment to make it live\n`;
                    result += `- Or use reset_deployment to rollback\n`;
                }
                
                if (!waitForCompletion) {
                    result += `\n💡 **Monitor Progress:**\n`;
                    result += `Check status with: \`get_deployment_status\` using deployment ID \`${deployment.id}\`\n`;
                }
            }
            
            result += `\n🔧 **Powered by:** PowerShell EpiCloud module`;
            
            return result;
            
        } catch (error) {
            throw new Error(`Start deployment failed: ${error.message}`);
        }
    }

    async performWarmUp(warmUpUrl) {
        try {
            console.error(`Performing warm-up request to: ${warmUpUrl}`);
            
            // Use Node.js fetch or similar to make warm-up request
            const { execAsync } = require('util').promisify(require('child_process').exec);
            const startTime = new Date();
            
            let warmUpResult;
            try {
                // Use curl for the warm-up request with timeout
                const { stdout, stderr } = await execAsync(`curl -I -m 30 -s -o /dev/null -w "%{http_code},%{time_total}" "${warmUpUrl}"`);
                const [statusCode, responseTime] = stdout.trim().split(',');
                
                if (statusCode === '200') {
                    warmUpResult = `🔥 **Warm-Up Successful!**\n`;
                    warmUpResult += `✅ **URL:** ${warmUpUrl}\n`;
                    warmUpResult += `✅ **Response:** HTTP ${statusCode}\n`;
                    warmUpResult += `✅ **Response Time:** ${Math.round(parseFloat(responseTime) * 1000)}ms\n`;
                    warmUpResult += `✅ **Status:** Site warmed up and ready`;
                } else {
                    warmUpResult = `⚠️ **Warm-Up Warning**\n`;
                    warmUpResult += `**URL:** ${warmUpUrl}\n`;
                    warmUpResult += `**Response:** HTTP ${statusCode}\n`;
                    warmUpResult += `**Note:** Site may need additional time to fully warm up`;
                }
            } catch (error) {
                warmUpResult = `❌ **Warm-Up Failed**\n`;
                warmUpResult += `**URL:** ${warmUpUrl}\n`;
                warmUpResult += `**Error:** ${error.message}\n`;
                warmUpResult += `**Note:** Site deployed successfully but warm-up request failed`;
            }
            
            return warmUpResult;
            
        } catch (error) {
            return `❌ **Warm-Up Error:** ${error.message}`;
        }
    }

    async handleCompleteDeployment(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid complete deployment arguments'
                    }
                };
            }

            const result = await this.completeDeployment(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.deploymentId,
                args.waitForCompletion,
                args.waitTimeoutMinutes
            );

            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error completing deployment:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }

    async completeDeployment(apiKey, apiSecret, projectId, deploymentId, waitForCompletion = false, waitTimeoutMinutes = 30) {
        try {
            console.error(`Completing deployment ${deploymentId} for project ${projectId}`);
            
            // Build PowerShell command
            let completeCommand = `Complete-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -Id '${deploymentId}'`;
            
            if (waitForCompletion) {
                completeCommand += ' -Wait';
                if (waitTimeoutMinutes && waitTimeoutMinutes !== 30) {
                    completeCommand += ` -WaitTimeoutMinutes ${waitTimeoutMinutes}`;
                }
            }
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${completeCommand} | ConvertTo-Json -Depth 10 -Compress`;
            
            let stdout, stderr;
            try {
                const result = await execAsync(`pwsh -Command "${psScript}"`);
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error) {
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            }

            // Check for PowerShell module error
            if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To complete deployments, you need the EpiCloud PowerShell module installed:

**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`

**Manual Deployment Completion:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
${completeCommand}
\`\`\`

**Deployment Details:**
- **Deployment ID:** ${deploymentId}
- **Project ID:** ${projectId}`;
            }

            // Check for deployment state errors
            if (stderr && (stderr.includes('on-going code deployment') || stderr.includes('cannot be completed'))) {
                return `⚠️ **Cannot Complete Deployment**

The deployment cannot be completed at this time. This usually means:

**Possible Causes:**
- Another deployment operation is currently running
- Deployment is not in "AwaitingVerification" status
- Deployment has already been completed or reset

**Current Request:**
- **Deployment ID:** ${deploymentId}
- **Project:** ${projectId}

**What to do:**
1. Check deployment status using get_deployment_status
2. Wait for any ongoing operations to complete
3. Ensure deployment is in "AwaitingVerification" status before completing

💡 **Note:** Only deployments in "AwaitingVerification" status can be completed.`;
            }

            if (stderr && stderr.trim()) {
                return `❌ **Deployment Completion Error**

**Error Details:**
\`\`\`
${stderr.trim()}
\`\`\`

**Deployment Details:**
- **Deployment ID:** ${deploymentId}
- **Project:** ${projectId}

**Troubleshooting:**
- Verify deployment is in "AwaitingVerification" status
- Check that no other operations are running
- Ensure deployment ID is correct`;
            }

            // Parse JSON from PowerShell output (skip table headers)
            const lines = stdout.split('\n');
            let jsonContent = '';
            let foundJson = false;
            
            for (const line of lines) {
                if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                    foundJson = true;
                }
                if (foundJson) {
                    jsonContent += line;
                }
            }

            if (!jsonContent.trim()) {
                return `⚠️ **No Completion Response**

The completion command was sent but no response data was returned.

**Deployment Details:**
- **Deployment ID:** ${deploymentId}
- **Project:** ${projectId}

**Next Steps:**
- Check deployment status to verify completion
- The deployment may have completed successfully despite the lack of response data`;
            }

            const deployment = JSON.parse(jsonContent);
            
            // Format successful completion response
            let result = `🎉 **Deployment ${waitForCompletion && deployment.status === 'Succeeded' ? 'Completed' : 'Completion Started'}!**\n\n`;
            result += `✅ **Staging Slot → Live Environment**\n`;
            result += `**Deployment ID:** \`${deployment.id}\`\n`;
            result += `**Status:** ${deployment.status}\n`;
            result += `**Project:** ${projectId}\n`;
            
            if (deployment.startTime) {
                result += `**Original Start:** ${new Date(deployment.startTime).toLocaleString()}\n`;
            }
            
            if (deployment.endTime) {
                result += `**Completed:** ${new Date(deployment.endTime).toLocaleString()}\n`;
                const totalDuration = deployment.startTime ? 
                    Math.round((new Date(deployment.endTime) - new Date(deployment.startTime)) / 60000) : 
                    'Unknown';
                result += `**Total Duration:** ${totalDuration} minutes\n`;
            } else if (deployment.percentComplete !== undefined) {
                result += `**Progress:** ${deployment.percentComplete}%\n`;
            }
            
            // Add parameters info
            const params = deployment.parameters || {};
            if (params.targetEnvironment) {
                result += `**Environment:** ${params.targetEnvironment}\n`;
            }
            if (params.packages && params.packages.length > 0) {
                result += `**Packages:** ${params.packages.join(', ')}\n`;
            }
            
            // Add validation links for completed deployments
            if (deployment.validationLinks && deployment.validationLinks.length > 0) {
                // For completed deployments, validation links typically point to the live site
                result += `\n🌐 **Live Site URL:**\n`;
                deployment.validationLinks.forEach(link => {
                    // Convert staging slot URL to live URL
                    const liveUrl = link.replace('-slot.dxcloud.episerver.net', '.dxcloud.episerver.net');
                    result += `🔗 ${liveUrl}\n`;
                });
            }
            
            // Status-specific messaging
            if (waitForCompletion && deployment.status === 'Succeeded') {
                result += `\n🎉 **Deployment Complete!**\n`;
                result += `✅ Your package is now live and serving traffic\n`;
                result += `✅ Staging slot has been swapped to production\n`;
                result += `✅ Previous version has been moved to staging slot for rollback if needed\n`;
            } else if (deployment.status === 'InProgress') {
                result += `\n🔄 **Completion In Progress**\n`;
                result += `⏳ The staging slot is being swapped to production\n`;
                result += `⏳ This typically takes 2-5 minutes\n`;
                if (!waitForCompletion) {
                    result += `\n💡 **Monitor Progress:**\n`;
                    result += `Check status with: \`get_deployment_status\` using deployment ID \`${deployment.id}\`\n`;
                }
            } else {
                result += `\n📋 **Next Steps:**\n`;
                if (!waitForCompletion && deployment.status !== 'Succeeded') {
                    result += `1. Monitor completion progress using get_deployment_status\n`;
                    result += `2. Completion typically takes 2-5 minutes\n`;
                }
                result += `3. Test your live site once completion finishes\n`;
            }
            
            result += `\n🔧 **Powered by:** PowerShell EpiCloud module`;
            
            return result;
            
        } catch (error) {
            throw new Error(`Complete deployment failed: ${error.message}`);
        }
    }
    async handleResetDeployment(requestId, args) {
        try {
            if (!args.apiKey || !args.apiSecret || !args.projectId || !args.deploymentId) {
                return {
                    jsonrpc: '2.0',
                    id: requestId,
                    error: {
                        code: -32602,
                        message: 'Invalid reset deployment arguments'
                    }
                };
            }
            const result = await this.resetDeployment(
                args.apiKey,
                args.apiSecret,
                args.projectId,
                args.deploymentId,
                args.includeDbRollback,
                args.waitForCompletion,
                args.waitTimeoutMinutes
            );
            return {
                jsonrpc: '2.0',
                id: requestId,
                result: {
                    content: [{
                        type: 'text',
                        text: result
                    }]
                }
            };
        } catch (error) {
            console.error('Error resetting deployment:', error);
            return {
                jsonrpc: '2.0',
                id: requestId,
                error: {
                    code: -32000,
                    message: 'Internal server error',
                    data: error.message
                }
            };
        }
    }
    async resetDeployment(apiKey, apiSecret, projectId, deploymentId, includeDbRollback = false, waitForCompletion = false, waitTimeoutMinutes = 30) {
        try {
            console.error(`Resetting deployment ${deploymentId} for project ${projectId}`);
            
            // Build PowerShell command
            let resetCommand = `Reset-EpiDeployment -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}' -Id '${deploymentId}'`;
            
            if (includeDbRollback) {
                resetCommand += ' -IncludeDbRollback';
            }
            
            if (waitForCompletion) {
                resetCommand += ' -Wait';
                if (waitTimeoutMinutes && waitTimeoutMinutes !== 30) {
                    resetCommand += ` -WaitTimeoutMinutes ${waitTimeoutMinutes}`;
                }
            }
            
            const psScript = `Import-Module EpiCloud -Force; Connect-EpiCloud -ClientKey '${apiKey}' -ClientSecret '${apiSecret}' -ProjectId '${projectId}'; ${resetCommand} | ConvertTo-Json -Depth 10 -Compress`;
            
            let stdout, stderr;
            try {
                const result = await execAsync(`pwsh -Command "${psScript}"`);
                stdout = result.stdout;
                stderr = result.stderr;
            } catch (error) {
                stdout = error.stdout || '';
                stderr = error.stderr || '';
            }
            // Check for PowerShell module error
            if (stderr && stderr.includes('EpiCloud')) {
                return `❌ **EpiCloud PowerShell Module Required**
                
To reset deployments, you need the EpiCloud PowerShell module installed:
**Installation:**
\`\`\`powershell
Install-Module EpiCloud -Force
\`\`\`
**Manual Deployment Reset:**
After installing the module, you can run:
\`\`\`powershell
Connect-EpiCloud -ClientKey "${apiKey}" -ClientSecret "your-secret" -ProjectId "${projectId}"
${resetCommand}
\`\`\`
**Deployment Details:**
- **Deployment ID:** ${deploymentId}
- **Project ID:** ${projectId}
- **Include DB Rollback:** ${includeDbRollback ? 'Yes' : 'No'}`;
            }
            // Check for deployment state errors
            if (stderr && (stderr.includes('cannot be reset') || stderr.includes('not in a valid state'))) {
                return `⚠️ **Cannot Reset Deployment**

The deployment cannot be reset at this time. This usually means:
- Deployment is not in **AwaitingVerification** status
- Deployment has already been completed or reset
- Another operation is currently running

**Current Status Check:**
Run: \`Get-EpiDeployment -ProjectId ${projectId} -Id ${deploymentId}\` to check current status.

**Valid Reset States:**
- AwaitingVerification (deployment in staging slot waiting for verification)
- Failed (deployment failed and needs reset)

**Deployment ID:** ${deploymentId}`;
            }
            // Check for authentication errors
            if (stderr && (stderr.includes('authentication') || stderr.includes('unauthorized') || stderr.includes('403') || stderr.includes('401'))) {
                return `❌ **Authentication Failed**

The API credentials are invalid or don't have permission for this operation.

**Troubleshooting:**
- Verify your API key and secret are correct
- Check that the credentials have permission for project ${projectId}
- Ensure the deployment ${deploymentId} exists and you have access to it

**Deployment ID:** ${deploymentId}
**Project ID:** ${projectId}`;
            }
            // Check for generic errors in stderr
            if (stderr && stderr.includes('error')) {
                // Extract error message
                const errorMatch = stderr.match(/"errors":\["(.+?)"/i);
                if (errorMatch) {
                    return `❌ **Reset Failed**\n\n${errorMatch[1]}\n\n**Deployment ID:** ${deploymentId}\n**Project ID:** ${projectId}`;
                } else {
                    return `❌ **Reset Failed**\n\n${stderr}\n\n**Deployment ID:** ${deploymentId}\n**Project ID:** ${projectId}`;
                }
            }
            // Try to parse JSON response
            if (stdout && stdout.trim()) {
                try {
                    // Parse potential JSON from mixed PowerShell output
                    let foundJson = false;
                    let jsonLines = [];
                    const lines = stdout.split('\n');
                    
                    for (const line of lines) {
                        if (line.trim().startsWith('{') || line.trim().startsWith('[')) {
                            foundJson = true;
                        }
                        if (foundJson) {
                            jsonLines.push(line);
                        }
                    }
                    
                    if (jsonLines.length > 0) {
                        const jsonString = jsonLines.join('\n');
                        const deploymentData = JSON.parse(jsonString);
                        return this.formatDeploymentResetStatus(deploymentData, includeDbRollback);
                    }
                } catch (parseError) {
                    console.error('JSON parsing failed:', parseError);
                    // Continue to return raw output
                }
            }
            // Return raw output if no JSON parsing succeeded
            if (stdout && stdout.trim()) {
                return `✅ **Deployment Reset Initiated**\n\n${stdout.trim()}\n\n**Deployment ID:** ${deploymentId}\n**Project ID:** ${projectId}\n**DB Rollback:** ${includeDbRollback ? 'Included' : 'Not included'}`;
            } else {
                return `⚠️ **Reset Command Completed**\n\nThe reset command was executed but no detailed response was received.\n\n**Deployment ID:** ${deploymentId}\n**Project ID:** ${projectId}\n**DB Rollback:** ${includeDbRollback ? 'Included' : 'Not included'}\n\n**Troubleshooting:**
- Verify your API credentials have permission for this environment
- Check that the deployment ID is correct
- Ensure the deployment is in a valid state for reset`;
            }
        } catch (error) {
            throw new Error(`Deployment reset failed: ${error.message}`);
        }
    }
    formatDeploymentResetStatus(deployment, includeDbRollback) {
        const status = deployment.Status || deployment.status || 'Unknown';
        const deploymentId = deployment.Id || deployment.id;
        const projectId = deployment.ProjectId || deployment.projectId;
        const environment = deployment.Environment || deployment.environment;
        const percentComplete = deployment.PercentComplete || deployment.percentComplete || 0;
        const startTime = deployment.StartTime || deployment.startTime;
        const endTime = deployment.EndTime || deployment.endTime;
        
        let statusIcon = '🔄';
        let statusMessage = 'Reset in progress';
        
        switch (status?.toLowerCase()) {
            case 'succeeded':
            case 'completed':
                statusIcon = '✅';
                statusMessage = 'Reset completed successfully';
                break;
            case 'inprogress':
            case 'in progress':
            case 'running':
                statusIcon = '🔄';
                statusMessage = 'Reset in progress';
                break;
            case 'failed':
            case 'error':
                statusIcon = '❌';
                statusMessage = 'Reset failed';
                break;
            case 'awaitingverification':
            case 'awaiting verification':
                statusIcon = '⏳';
                statusMessage = 'Reset completed - Deployment back to verification status';
                break;
            default:
                statusIcon = '📋';
                statusMessage = `Status: ${status}`;
        }
        
        let result = `${statusIcon} **Deployment Reset Status**\n\n`;
        result += `**Status:** ${statusMessage}\n`;
        result += `**Deployment ID:** ${deploymentId}\n`;
        
        if (projectId) result += `**Project ID:** ${projectId}\n`;
        if (environment) result += `**Environment:** ${environment}\n`;
        result += `**DB Rollback:** ${includeDbRollback ? 'Included' : 'Not included'}\n`;
        
        if (percentComplete !== undefined) {
            result += `**Progress:** ${percentComplete}%\n`;
        }
        
        if (startTime) {
            const start = new Date(startTime);
            result += `**Started:** ${start.toLocaleString()}\n`;
            
            if (endTime) {
                const end = new Date(endTime);
                const duration = Math.round((end - start) / 1000 / 60);
                result += `**Completed:** ${end.toLocaleString()} (${duration} min)\n`;
            } else {
                const now = new Date();
                const elapsed = Math.round((now - start) / 1000 / 60);
                result += `**Elapsed:** ${elapsed} minutes\n`;
            }
        }
        
        // Add helpful next steps based on status
        if (status?.toLowerCase() === 'awaitingverification') {
            result += `\n**Next Steps:**\n`;
            result += `- The deployment has been reset and is back to verification status\n`;
            result += `- You can now redeploy or make changes as needed\n`;
            result += `- The staging slot is available for a new deployment\n`;
        } else if (status?.toLowerCase() === 'succeeded') {
            result += `\n**Reset Complete:**\n`;
            result += `- The deployment has been successfully reset\n`;
            result += `- You can now start a new deployment if needed\n`;
            if (includeDbRollback) {
                result += `- Database has been rolled back as requested\n`;
            }
        } else if (status?.toLowerCase() === 'failed') {
            result += `\n**Reset Failed:**\n`;
            result += `- Check the deployment status for specific error details\n`;
            result += `- You may need to contact support or retry the reset\n`;
        }
        
        return result;
    }

}

// Start the server
const server = new JaxonOptimizelyDxpMcp();
server.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});