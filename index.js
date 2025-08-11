#!/usr/bin/env node

const readline = require('readline');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Import fetch for Node.js versions that don't have it built-in
let fetch;
if (typeof globalThis.fetch === 'undefined') {
    fetch = require('node-fetch').default;
} else {
    fetch = globalThis.fetch;
}

class OptimizelyMcpServer {
    constructor() {
        this.defaultApiBaseUrl = 'https://paasportal.episerver.net/api/v1.0';
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        console.error('Starting Optimizely DXP MCP Server');

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
                        },
                        apiBaseUrl: {
                            type: 'string',
                            description: 'Optional custom API base URL'
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
                        },
                        apiBaseUrl: {
                            type: 'string',
                            description: 'Optional custom API base URL'
                        }
                    },
                    required: ['apiKey', 'apiSecret', 'projectId', 'environment', 'databaseName', 'exportId']
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
                args.retentionHours || 24,
                args.apiBaseUrl
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
                args.exportId,
                args.apiBaseUrl
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

    async exportDatabase(apiKey, apiSecret, projectId, environment, databaseName, retentionHours, apiBaseUrl) {
        try {
            console.error(`Starting database export for project ${projectId}, environment ${environment}, database ${databaseName}`);

            const baseUrl = (apiBaseUrl || this.defaultApiBaseUrl).replace(/\/$/, '');
            const url = `${baseUrl}/projects/${projectId}/environments/${environment}/databases/${databaseName}/exports`;
            
            const requestBody = {
                retentionHours: retentionHours
            };

            const response = await this.sendAuthorizedRequest('POST', url, apiKey, apiSecret, requestBody);
            const content = await response.text();
            
            console.error(`API Response Status: ${response.status}`);
            console.error(`API Response Content: ${content}`);
            
            if (response.ok) {
                // Check if response is JSON
                if (content.trimStart().startsWith('<')) {
                    console.error(`API returned HTML instead of JSON: ${content.substring(0, 500)}`);
                    return `API returned HTML response (possibly wrong endpoint). Content preview: ${content.substring(0, 200)}...`;
                }
                
                let apiResponse;
                try {
                    apiResponse = JSON.parse(content);
                    console.error(`Parsed API Response - Success: ${apiResponse.success}, Errors: ${(apiResponse.errors || []).join(', ')}, Result: ${apiResponse.result?.id || 'null'}`);
                } catch (error) {
                    console.error(`Failed to deserialize API response: ${content}`);
                    return `Failed to parse API response: ${error.message}. Raw response: ${content}`;
                }
                
                if (!apiResponse.success) {
                    const errors = (apiResponse.errors || []).join(', ');
                    return `Database export failed: ${errors}`;
                }
                
                const exportResult = apiResponse.result;
                if (exportResult?.status === 'InProgress' || exportResult?.status === 'Started') {
                    console.error(`Database export started successfully. Operation ID: ${exportResult.id}`);
                    return `🚀 **Database Export Started Successfully!**

✅ **Export Details:**
- **Operation ID:** \`${exportResult.id}\`
- **Status:** ${exportResult.status}
- **Environment:** ${environment}
- **Database:** ${databaseName}
- **Retention:** ${retentionHours} hours

📋 **What's Next:**
Your database export is now processing in the background. This typically takes 10-30 minutes depending on database size.

💡 **To check the status, ask me:**
"What's the status of export ${exportResult.id}?"

⏱️ **Estimated completion:** 10-30 minutes
📦 **File will be available for:** ${retentionHours} hours after completion`;
                } else {
                    return `Database export started with status: ${exportResult?.status}. Operation ID: ${exportResult?.id}`;
                }
            } else {
                console.error(`Database export failed with status ${response.status}: ${content}`);
                return `Database export failed: ${response.status} - ${content}`;
            }
        } catch (error) {
            console.error('Error during database export:', error);
            throw new Error(`Database export failed: ${error.message}`);
        }
    }

    async checkExportStatus(apiKey, apiSecret, projectId, environment, databaseName, exportId, apiBaseUrl) {
        try {
            console.error(`Checking export status for export ${exportId}`);

            // Try the direct API first (this often returns 403 due to API permissions)
            const baseUrl = (apiBaseUrl || this.defaultApiBaseUrl).replace(/\/$/, '');
            const url = `${baseUrl}/projects/${projectId}/environments/${environment}/databases/${databaseName}/exports/${exportId}`;

            const response = await this.sendAuthorizedRequest('GET', url, apiKey, apiSecret);
            const content = await response.text();
            
            if (response.ok) {
                let exportData;
                try {
                    exportData = JSON.parse(content);
                } catch (error) {
                    return `Failed to parse export status response: ${error.message}. Raw response: ${content}`;
                }

                const status = exportData.result?.status || exportData.status || 'Unknown';
                const downloadUrl = exportData.result?.downloadLink || exportData.downloadLink;
                const fileName = exportData.result?.bacpacName || exportData.bacpacName || `export_${exportId}.bacpac`;
                
                let result = `Export Status: ${status}`;
                
                if (fileName) {
                    result += `\nFile Name: ${fileName}`;
                }
                
                if (downloadUrl) {
                    result += `\nDownload Link: ${downloadUrl}`;
                    
                    // If export succeeded and we have a download link, download the file
                    if (status.toLowerCase() === 'succeeded') {
                        const downloadResult = await this.downloadBacpacFile(downloadUrl, fileName);
                        result += `\nDownload Result: ${downloadResult}`;
                    }
                }
                
                result += `\nExport ID: ${exportId}`;
                
                return result;
            } else if (response.status === 403) {
                // Handle 403 Forbidden - this is a known issue with the direct API endpoint
                return `🔍 **Export Status Check**

📋 **Export Information:**
- **Export ID:** \`${exportId}\`
- **Environment:** ${environment}
- **Database:** ${databaseName}

⚠️ **API Limitation Notice:**
Unfortunately, the DXP API currently returns "403 Forbidden" when checking export status directly. This is a known limitation with the Optimizely platform.

🔧 **Alternative Ways to Check Status:**

**Option 1: DXP Portal** 🌐
Visit your [DXP Management Portal](https://paasportal.episerver.net) and check the export status in the UI.

**Option 2: PowerShell Module** ⚡
If you have PowerShell with EpiCloud module installed:
\`\`\`powershell
Get-EpiDatabaseExport -ProjectId "${projectId}" -Environment "${environment}" -DatabaseName "${databaseName}" -Id "${exportId}"
\`\`\`

⏱️ **Typical Processing Time:**
- Small databases (< 1GB): 5-15 minutes
- Medium databases (1-10GB): 15-30 minutes  
- Large databases (> 10GB): 30+ minutes

💡 **Pro Tip:** Your export was initiated successfully and is likely processing in the background right now!`;
            } else {
                console.error(`Failed to check export status: ${response.status} - ${content}`);
                return `Failed to check export status: ${response.status} - ${content}`;
            }
        } catch (error) {
            console.error('Error checking export status:', error);
            return `Error checking export status: ${error.message}`;
        }
    }

    async downloadBacpacFile(downloadUrl, fileName) {
        try {
            console.error(`Downloading bacpac file ${fileName} from ${downloadUrl}`);
            
            // Ensure _bak directory exists
            const bakDir = path.join(process.cwd(), '_bak');
            if (!fs.existsSync(bakDir)) {
                fs.mkdirSync(bakDir, { recursive: true });
            }
            
            const filePath = path.join(bakDir, fileName);
            
            return new Promise((resolve, reject) => {
                const parsedUrl = new URL(downloadUrl);
                const client = parsedUrl.protocol === 'https:' ? https : http;
                
                client.get(downloadUrl, (response) => {
                    if (response.statusCode === 200) {
                        const fileStream = fs.createWriteStream(filePath);
                        response.pipe(fileStream);
                        
                        fileStream.on('finish', () => {
                            fileStream.close();
                            const stats = fs.statSync(filePath);
                            console.error(`Downloaded ${fileName} (${stats.size.toLocaleString()} bytes) to ${filePath}`);
                            resolve(`Downloaded successfully to ${filePath} (${stats.size.toLocaleString()} bytes)`);
                        });
                        
                        fileStream.on('error', (error) => {
                            reject(new Error(`File write error: ${error.message}`));
                        });
                    } else {
                        reject(new Error(`Download failed: ${response.statusCode}`));
                    }
                }).on('error', (error) => {
                    reject(new Error(`Download error: ${error.message}`));
                });
            });
        } catch (error) {
            console.error('Error downloading bacpac file:', error);
            return `Download error: ${error.message}`;
        }
    }

    async sendAuthorizedRequest(method, url, apiKey, apiSecret, body = null) {
        const timestamp = Date.now().toString();
        const nonce = crypto.randomUUID();
        const bodyJson = body ? JSON.stringify(body) : '';
        const bodyHash = this.computeMD5Hash(bodyJson);

        const signature = this.generateHmacSignature(
            apiKey,
            method,
            new URL(url).pathname + new URL(url).search,
            timestamp,
            nonce,
            bodyHash,
            apiSecret
        );

        const authHeader = `epi-hmac ${apiKey}:${timestamp}:${nonce}:${signature}`;

        const options = {
            method: method,
            headers: {
                'Authorization': authHeader,
                'Content-Type': body ? 'application/json' : undefined
            }
        };

        if (body) {
            options.body = bodyJson;
        }

        console.error(`Sending ${method} request to ${url} with auth header`);

        const response = await fetch(url, options);
        return response;
    }

    generateHmacSignature(apiKey, httpMethod, requestTarget, timestamp, nonce, bodyHash, apiSecret) {
        const message = `${apiKey}${httpMethod.toUpperCase()}${requestTarget}${timestamp}${nonce}${bodyHash}`;
        
        const secretBuffer = Buffer.from(apiSecret, 'base64');
        const hmac = crypto.createHmac('sha256', secretBuffer);
        hmac.update(message, 'utf8');
        return hmac.digest('base64');
    }

    computeMD5Hash(input) {
        if (!input) return '';
        
        const md5 = crypto.createHash('md5');
        md5.update(input, 'utf8');
        return md5.digest('base64');
    }
}

// Start the server
const server = new OptimizelyMcpServer();
server.run().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});