#!/usr/bin/env node

// Check what tools the MCP server reports
const { spawn } = require('child_process');

async function checkTools() {
    const server = spawn('node', ['jaxon-optimizely-dxp-mcp.js'], {
        stdio: ['pipe', 'pipe', 'pipe']
    });

    // Send initialize request
    const initRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "1.0.0",
            capabilities: {}
        }
    };
    
    server.stdin.write(JSON.stringify(initRequest) + '\n');
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Send tools/list request
    const toolsRequest = {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
    };
    
    server.stdin.write(JSON.stringify(toolsRequest) + '\n');
    
    // Collect output
    let output = '';
    server.stdout.on('data', (data) => {
        output += data.toString();
    });
    
    // Wait for response
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Parse and display tools
    const lines = output.split('\n');
    for (const line of lines) {
        if (line.trim()) {
            try {
                const response = JSON.parse(line);
                if (response.id === 2 && response.result && response.result.tools) {
                    console.log('Available tools:');
                    response.result.tools.forEach(tool => {
                        console.log(`  - ${tool.name}: ${tool.description}`);
                    });
                }
            } catch (e) {
                // Not JSON, skip
            }
        }
    }
    
    server.kill();
}

checkTools().catch(console.error);