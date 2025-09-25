#!/usr/bin/env node

/**
 * Minimal working MCP server based on progressive test
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

const libPath = path.join(__dirname, '..', 'lib');
const Config = require(path.join(libPath, 'config'));
const pkg = require(path.join(__dirname, '..', 'package.json'));

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