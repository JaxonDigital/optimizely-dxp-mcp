#!/usr/bin/env node

/**
 * Minimal working MCP server - v2 with handlers
 */

const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if it exists (silently)
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '.env')
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length > 0) {
          if (!process.env[key.trim()]) {
            process.env[key.trim()] = valueParts.join('=').trim();
          }
        }
      }
    });
    break;
  }
}

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { 
    ListToolsRequestSchema,
    CallToolRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const libPath = path.join(__dirname, '..', 'lib');
const Config = require(path.join(libPath, 'config'));
const pkg = require(path.join(__dirname, '..', 'package.json'));

// Simple test tool
const testTools = {
    test_connection: {
        description: 'Test the MCP connection',
        handler: async () => {
            return { content: [{ 
                type: 'text', 
                text: '✅ Connection successful!' 
            }] };
        }
    }
};

// Main function
async function main() {
    try {
        // Create server inside main (like progressive test)
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
        
        // Add handlers AFTER server creation
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: Object.keys(testTools).map(name => ({
                    name,
                    description: testTools[name].description,
                    inputSchema: { type: 'object' }
                }))
            };
        });
        
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            
            if (testTools[name]) {
                return await testTools[name].handler(args);
            }
            
            return {
                content: [{ 
                    type: 'text', 
                    text: `Unknown tool: ${name}` 
                }]
            };
        });
        
        // Create transport
        const transport = new StdioServerTransport();
        
        // Connect
        await server.connect(transport);
        
        // Success message after connection
        console.error(`✅ Jaxon Optimizely DXP MCP Server v${pkg.version} ready`);
        
    } catch (error) {
        console.error('Failed:', error.message);
        process.exit(1);
    }
}

// Run main
main();