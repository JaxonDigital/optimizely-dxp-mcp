#!/usr/bin/env node

/**
 * Gradual build - start with minimal and add piece by piece
 */

// DISABLE TELEMETRY
process.env.OPTIMIZELY_MCP_TELEMETRY = 'false';
process.env.MCP_TELEMETRY = 'false';

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
    CallToolRequestSchema,
    ListResourcesRequestSchema,
    ListPromptsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const libPath = path.join(__dirname, '..', 'lib');
const Config = require(path.join(libPath, 'config'));
const pkg = require(path.join(__dirname, '..', 'package.json'));

// Add core modules one by one
const ResponseBuilder = require(path.join(libPath, 'response-builder'));
const OutputLogger = require(path.join(libPath, 'output-logger'));
const ErrorHandler = require(path.join(libPath, 'error-handler'));

// Now add main tools module
const { 
    DeploymentTools, 
    StorageTools, 
    PackageTools, 
    LoggingTools,
    ContentTools,
    DeploymentHelperTools 
} = require(path.join(libPath, 'tools'));

// Add individual tool modules  
const ProjectTools = require(path.join(libPath, 'tools', 'project-tools'));
const SimpleTools = require(path.join(libPath, 'tools', 'simple-tools'));
const ConnectionTestTools = require(path.join(libPath, 'tools', 'connection-test-tools'));

// Tool definitions  
const testTools = {
    test_connection: {
        description: 'Test the MCP connection and validate configuration',
        handler: ConnectionTestTools.testConnection
    },
    health_check: {
        description: 'Quick health check (minimal output)',
        handler: ConnectionTestTools.healthCheck
    }
};

// Main function
async function main() {
    try {
        // Create server inside main
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
        
        server.setRequestHandler(ListResourcesRequestSchema, async () => {
            return { resources: [] };
        });
        
        server.setRequestHandler(ListPromptsRequestSchema, async () => {
            return { prompts: [] };
        });
        
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;
            
            if (testTools[name]) {
                return await testTools[name].handler(args || {});
            }
            
            return ResponseBuilder.error(`Unknown tool: ${name}`);
        });
        
        // Create transport
        const transport = new StdioServerTransport();
        
        // Connect
        await server.connect(transport);
        
        // Success message after connection
        OutputLogger.success(`Gradual test - server connected with core modules`);
        
    } catch (error) {
        console.error('Failed:', error.message);
        process.exit(1);
    }
}

// Run main
main();