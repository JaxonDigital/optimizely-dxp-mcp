#!/usr/bin/env node

console.error('DIAGNOSTIC: Script started');

try {
    // Test 1: Basic requires
    console.error('DIAGNOSTIC: Testing basic requires...');
    const fs = require('fs');
    const path = require('path');
    console.error('DIAGNOSTIC: fs and path loaded OK');
    
    // Test 2: __dirname
    console.error('DIAGNOSTIC: __dirname =', __dirname);
    console.error('DIAGNOSTIC: process.cwd() =', process.cwd());
    
    // Test 3: libPath
    const libPath = path.join(__dirname, '..', 'lib');
    console.error('DIAGNOSTIC: libPath =', libPath);
    
    // Test 4: Check if lib directory exists
    if (fs.existsSync(libPath)) {
        console.error('DIAGNOSTIC: lib directory exists');
    } else {
        console.error('DIAGNOSTIC: ERROR - lib directory NOT found at', libPath);
        process.exit(1);
    }
    
    // Test 5: Try to load config
    console.error('DIAGNOSTIC: Trying to load config...');
    const configPath = path.join(libPath, 'config');
    console.error('DIAGNOSTIC: Config path =', configPath);
    const Config = require(configPath);
    console.error('DIAGNOSTIC: Config loaded OK');
    
    // Test 6: Try to load MCP SDK
    console.error('DIAGNOSTIC: Trying to load MCP SDK...');
    const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
    console.error('DIAGNOSTIC: MCP SDK loaded OK');
    
    // Test 7: Create minimal server
    console.error('DIAGNOSTIC: Creating server...');
    const server = new Server(
        { name: 'test', version: '1.0.0' },
        { capabilities: { tools: {} } }
    );
    console.error('DIAGNOSTIC: Server created OK');
    
    console.error('DIAGNOSTIC: All tests passed!');
    
} catch (error) {
    console.error('DIAGNOSTIC: ERROR CAUGHT');
    console.error('DIAGNOSTIC: Error message:', error.message);
    console.error('DIAGNOSTIC: Error code:', error.code);
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('DIAGNOSTIC: Module not found - full error:', error.toString());
    }
    console.error('DIAGNOSTIC: Stack:', error.stack);
    process.exit(1);
}

// Don't actually start the server, just exit
console.error('DIAGNOSTIC: Complete - exiting');
process.exit(0);