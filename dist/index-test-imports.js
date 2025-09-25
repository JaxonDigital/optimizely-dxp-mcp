#!/usr/bin/env node

/**
 * Test imports one by one to find the culprit
 */

const fs = require('fs');
const path = require('path');

// MCP SDK imports - these should be safe
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

// Now let's test local imports one by one
const libPath = path.join(__dirname, '..', 'lib');

console.error('Testing Config...');
const Config = require(path.join(libPath, 'config'));
console.error('✅ Config OK');

console.error('Testing ErrorHandler...');
const ErrorHandler = require(path.join(libPath, 'error-handler'));
console.error('✅ ErrorHandler OK');

console.error('Testing ResponseBuilder...');
const ResponseBuilder = require(path.join(libPath, 'response-builder'));
console.error('✅ ResponseBuilder OK');

console.error('Testing OutputLogger...');
const OutputLogger = require(path.join(libPath, 'output-logger'));
console.error('✅ OutputLogger OK');

console.error('Testing tools/index...');
const tools = require(path.join(libPath, 'tools'));
console.error('✅ tools OK');

console.error('Testing ProjectTools...');
const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
console.error('✅ ProjectTools OK');

console.error('Testing telemetry...');
const { getTelemetry } = require(path.join(libPath, 'telemetry'));
const telemetry = getTelemetry();
console.error('✅ Telemetry OK');

// Now try connecting
async function main() {
    console.error('Creating server...');
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    
    const server = new Server(
        {
            name: Config.PROJECT.NAME,
            version: pkg.version
        },
        {
            capabilities: {
                tools: {},
                resources: {},
                prompts: {}
            }
        }
    );
    
    console.error('Connecting...');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    console.error('✅ Connected successfully!');
}

main().catch(e => {
    console.error('❌ Failed:', e.message);
    process.exit(1);
});