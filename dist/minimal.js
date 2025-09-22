#!/usr/bin/env node

// Absolute minimal MCP server to test connection
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

async function main() {
    try {
        // Create minimal server
        const server = new Server(
            {
                name: 'minimal-test',
                version: '1.0.0'
            },
            {
                capabilities: {
                    tools: {}
                }
            }
        );

        // Create transport
        const transport = new StdioServerTransport();
        
        // Connect
        await server.connect(transport);
        
        // Log to stderr (not stdout which would break protocol)
        console.error('Minimal server running');
        
    } catch (error) {
        console.error('Failed to start minimal server:', error.message);
        process.exit(1);
    }
}

main();