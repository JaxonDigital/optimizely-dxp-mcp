#!/bin/bash

# Set environment variables directly
export OPTIMIZELY_API_KEY="b3Op2aRBFtZWGybtgOYPfm2UqvKO3ZvFCVXkcyuFEyvmLWNV"
export OPTIMIZELY_API_SECRET="XnMTPaqV+rQ+dRdKZVOqZzG2dyJtJXLyHqnjAm7jwEm1Ky8vpovMAsWrM7L0sDPl"
export OPTIMIZELY_PROJECT_ID="caecbb62-0fd4-4d09-8627-ae7e018b595e"

# Run the actual MCP server (SDK version)
exec /Users/bgerby/.nvm/versions/node/v22.16.0/bin/node /Users/bgerby/.nvm/versions/node/v22.16.0/lib/node_modules/jaxon-optimizely-dxp-mcp/jaxon-optimizely-dxp-mcp-sdk.js