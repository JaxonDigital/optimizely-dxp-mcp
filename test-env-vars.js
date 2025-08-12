#!/usr/bin/env node

// Log environment variables to stderr
console.error('Environment variables received:');
console.error('OPTIMIZELY_API_KEY:', process.env.OPTIMIZELY_API_KEY ? 'SET' : 'NOT SET');
console.error('OPTIMIZELY_API_SECRET:', process.env.OPTIMIZELY_API_SECRET ? 'SET' : 'NOT SET');  
console.error('OPTIMIZELY_PROJECT_ID:', process.env.OPTIMIZELY_PROJECT_ID || 'NOT SET');

// Then run the actual server
require('/Users/bgerby/.nvm/versions/node/v22.16.0/lib/node_modules/jaxon-optimizely-dxp-mcp/jaxon-optimizely-dxp-mcp.js');