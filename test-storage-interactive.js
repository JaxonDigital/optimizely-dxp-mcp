#!/usr/bin/env node

const readline = require('readline');
const { spawn } = require('child_process');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log('=== Optimizely DXP Storage Container Test ===\n');
    
    const projectId = await question('Enter your Project ID (or press Enter for caecbb62-0fd4-4d09-8627-ae7e018b595e): ') 
        || 'caecbb62-0fd4-4d09-8627-ae7e018b595e';
    const apiKey = await question('Enter your API Key: ');
    const apiSecret = await question('Enter your API Secret: ');
    const environment = await question('Enter environment (Integration/Preproduction/Production): ') 
        || 'Integration';
    
    rl.close();
    
    console.log('\nCalling MCP server...\n');
    
    // Create the request
    const request = {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
            name: "list_storage_containers",
            arguments: {
                apiKey: apiKey,
                apiSecret: apiSecret,
                projectId: projectId,
                environment: environment
            }
        }
    };
    
    // Spawn the MCP server
    const mcp = spawn('node', ['jaxon-optimizely-dxp-mcp.js']);
    
    // Send the request
    mcp.stdin.write(JSON.stringify(request) + '\n');
    
    // Handle the response
    mcp.stdout.on('data', (data) => {
        try {
            const response = JSON.parse(data.toString());
            
            if (response.error) {
                console.error('Error from MCP server:', response.error);
            } else if (response.result && response.result.content) {
                console.log('=== Storage Containers ===');
                response.result.content.forEach(item => {
                    if (item.type === 'text') {
                        try {
                            const content = JSON.parse(item.text);
                            if (content.containers) {
                                content.containers.forEach(container => {
                                    console.log(`  📁 ${container}`);
                                });
                                console.log(`\nTotal: ${content.containers.length} containers`);
                            } else if (content.error) {
                                console.error('Error:', content.error);
                            }
                        } catch (e) {
                            console.log(item.text);
                        }
                    }
                });
            } else {
                console.log('Unexpected response:', JSON.stringify(response, null, 2));
            }
        } catch (e) {
            console.log('Could not parse response:', data.toString());
        }
        process.exit(0);
    });
    
    mcp.stderr.on('data', (data) => {
        console.error('MCP Server Error:', data.toString());
    });
    
    mcp.on('close', (code) => {
        if (code !== 0) {
            console.log(`MCP server exited with code ${code}`);
        }
    });
}

main().catch(console.error);