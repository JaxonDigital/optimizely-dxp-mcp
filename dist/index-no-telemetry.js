#!/usr/bin/env node

/**
 * Test without telemetry
 */

// DISABLE TELEMETRY
process.env.OPTIMIZELY_MCP_TELEMETRY = 'false';
process.env.MCP_TELEMETRY = 'false';

const fs = require('fs');
const path = require('path');

// Silent .env loading
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
    // Create server
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
    
    // Connect
    const transport = new StdioServerTransport();
    await server.connect(transport);
    
    // Success
    console.error(`✅ Connected without telemetry!`);
}

main().catch(e => {
    process.exit(1);
});