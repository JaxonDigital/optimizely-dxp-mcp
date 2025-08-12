#!/usr/bin/env node

/**
 * Interactive MCP Client for Jaxon Optimizely DXP MCP Server
 * Prompts for project ID first, then credentials
 */

const readline = require('readline');
const { spawn } = require('child_process');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function callMcpServer(toolName, args) {
    const request = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
            name: toolName,
            arguments: args
        }
    };
    
    return new Promise((resolve, reject) => {
        const mcp = spawn('node', ['jaxon-optimizely-dxp-mcp.js']);
        let responseData = '';
        
        mcp.stdin.write(JSON.stringify(request) + '\n');
        
        mcp.stdout.on('data', (data) => {
            responseData += data.toString();
        });
        
        mcp.on('close', () => {
            try {
                const response = JSON.parse(responseData);
                resolve(response);
            } catch (e) {
                reject(new Error('Failed to parse response: ' + responseData));
            }
        });
        
        mcp.on('error', reject);
    });
}

function parseResponse(response) {
    if (response.error) {
        console.error('❌ Error:', response.error.message || response.error);
        return null;
    }
    
    if (response.result && response.result.content) {
        response.result.content.forEach(item => {
            if (item.type === 'text') {
                try {
                    const content = JSON.parse(item.text);
                    return content;
                } catch (e) {
                    console.log(item.text);
                }
            }
        });
    }
    
    return response.result;
}

async function listStorageContainers(projectId, apiKey, apiSecret) {
    const environment = await question('Enter environment (Integration/Preproduction/Production): ') || 'Integration';
    
    console.log('\n📦 Fetching storage containers...\n');
    
    const response = await callMcpServer('list_storage_containers', {
        projectId,
        apiKey,
        apiSecret,
        environment
    });
    
    parseResponse(response);
}

async function checkDeploymentStatus(projectId, apiKey, apiSecret) {
    const deploymentId = await question('Enter deployment ID (or press Enter for all): ');
    
    console.log('\n🔄 Checking deployment status...\n');
    
    const args = { projectId, apiKey, apiSecret };
    if (deploymentId) args.deploymentId = deploymentId;
    
    const response = await callMcpServer('get_deployment_status', args);
    parseResponse(response);
}

async function exportDatabase(projectId, apiKey, apiSecret) {
    const environment = await question('Enter environment (Integration/Preproduction/Production): ') || 'Integration';
    const databaseName = await question('Enter database (epicms/epicommerce): ') || 'epicms';
    const retentionHours = await question('Retention hours (default 24): ') || '24';
    
    console.log('\n💾 Starting database export...\n');
    
    const response = await callMcpServer('export_database', {
        projectId,
        apiKey,
        apiSecret,
        environment,
        databaseName,
        retentionHours: parseInt(retentionHours)
    });
    
    parseResponse(response);
}

async function main() {
    console.log('=================================');
    console.log('🚀 Jaxon Optimizely DXP MCP Client');
    console.log('=================================\n');
    
    // Ask for project ID first
    const projectId = await question('Enter your Project ID: ');
    if (!projectId) {
        console.log('Project ID is required!');
        process.exit(1);
    }
    
    // Then credentials
    const apiKey = await question('Enter your API Key: ');
    const apiSecret = await question('Enter your API Secret: ');
    
    if (!apiKey || !apiSecret) {
        console.log('API credentials are required!');
        process.exit(1);
    }
    
    console.log('\n✅ Credentials loaded for project:', projectId);
    
    while (true) {
        console.log('\n=== Available Operations ===');
        console.log('1. List Storage Containers');
        console.log('2. Check Deployment Status');
        console.log('3. Export Database');
        console.log('4. Exit');
        
        const choice = await question('\nSelect operation (1-4): ');
        
        try {
            switch (choice) {
                case '1':
                    await listStorageContainers(projectId, apiKey, apiSecret);
                    break;
                case '2':
                    await checkDeploymentStatus(projectId, apiKey, apiSecret);
                    break;
                case '3':
                    await exportDatabase(projectId, apiKey, apiSecret);
                    break;
                case '4':
                    console.log('\n👋 Goodbye!');
                    rl.close();
                    process.exit(0);
                default:
                    console.log('Invalid choice. Please select 1-4.');
            }
        } catch (error) {
            console.error('Operation failed:', error.message);
        }
        
        await question('\nPress Enter to continue...');
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});