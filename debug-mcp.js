#!/usr/bin/env node

// Debug script to test MCP server functionality
const { spawn } = require('child_process');
const path = require('path');

function sendMcpMessage(message) {
    return new Promise((resolve, reject) => {
        const serverPath = path.join(__dirname, 'optimizely-mcp-server.js');
        const process = spawn('node', [serverPath]);
        
        let stdout = '';
        let stderr = '';
        
        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`Process exited with code ${code}: ${stderr}`));
            }
        });
        
        // Send message and close stdin
        process.stdin.write(JSON.stringify(message) + '\n');
        process.stdin.end();
    });
}

async function testMcpServer() {
    console.log('🔍 Testing MCP Server...\n');
    
    try {
        // Test 1: Initialize
        console.log('1. Testing initialization...');
        const initResponse = await sendMcpMessage({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' }
            }
        });
        console.log('✅ Initialize response:', JSON.parse(initResponse.stdout.split('\n')[0]));
        
        // Test 2: List tools
        console.log('\n2. Testing tools list...');
        const toolsResponse = await sendMcpMessage({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {}
        });
        const toolsResult = JSON.parse(toolsResponse.stdout.split('\n')[0]);
        console.log('✅ Available tools:');
        toolsResult.result.tools.forEach(tool => {
            console.log(`   - ${tool.name}: ${tool.description}`);
        });
        
        console.log('\n🎉 MCP Server is working correctly!');
        console.log('\n📋 Next steps:');
        console.log('1. Copy optimizely-mcp-server.js to your other project');
        console.log('2. Create mcp.json in your project root with the server config');
        console.log('3. Restart Claude Code');
        console.log('4. Run /mcp command to verify server is loaded');
        
    } catch (error) {
        console.error('❌ Error testing MCP server:', error.message);
    }
}

testMcpServer();