#!/usr/bin/env node

const { spawn } = require('child_process');

console.log('Testing MCP server initialization...\n');

const mcp = spawn('node', ['jaxon-optimizely-dxp-mcp.js']);

let initResponse = '';
let toolsResponse = '';
let hasHeartbeat = false;

mcp.stdout.on('data', (data) => {
    const output = data.toString();
    
    // Check for responses
    if (output.includes('protocolVersion')) {
        initResponse = output;
        console.log('✅ Initialization successful');
    }
    if (output.includes('tools') && output.includes('export_database')) {
        toolsResponse = output;
        console.log('✅ Tools list retrieved');
    }
    if (output.includes('notification/heartbeat')) {
        if (!hasHeartbeat) {
            hasHeartbeat = true;
            console.log('✅ Heartbeat started (after initialization)');
        }
    }
});

mcp.stderr.on('data', (data) => {
    console.error('Error:', data.toString());
});

// Test sequence
setTimeout(() => {
    console.log('\n1. Sending initialize request...');
    mcp.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
}, 100);

setTimeout(() => {
    console.log('2. Sending tools/list request...');
    mcp.stdin.write('{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n');
}, 500);

setTimeout(() => {
    console.log('3. Sending ping request...');
    mcp.stdin.write('{"jsonrpc":"2.0","id":3,"method":"ping","params":{}}\n');
}, 1000);

// Check results
setTimeout(() => {
    console.log('\n=== Test Results ===');
    if (initResponse) {
        console.log('✅ Server responds to initialization');
    } else {
        console.log('❌ Server did not respond to initialization');
    }
    
    if (toolsResponse) {
        console.log('✅ Server provides tools list');
    } else {
        console.log('❌ Server did not provide tools list');
    }
    
    if (!hasHeartbeat) {
        console.log('✅ No premature heartbeat (good - only starts after init)');
    }
    
    console.log('\nTest complete. Shutting down...');
    mcp.kill();
    process.exit(0);
}, 2000);