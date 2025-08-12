# MCP Server Setup Notes for Claude Code

## Summary
After extensive testing, we've identified that Claude Code (as of August 2024) has difficulties connecting to custom local MCP servers. The server itself works correctly when tested directly, but Claude Code fails to establish connections to custom servers.

## What Works
✅ The MCP server responds correctly to all MCP protocol messages
✅ Server can be run directly with: `node jaxon-optimizely-dxp-mcp.js`
✅ Server works when tested with manual JSON-RPC input
✅ All PowerShell integrations function correctly
✅ Server can be installed globally via `npm link`

## Current Limitations with Claude Code
❌ Claude Code cannot connect to custom local MCP servers
❌ Various configuration approaches all result in "Failed to connect"
❌ Only built-in MCP servers (like playwright) successfully connect

## Configurations Attempted
1. **Direct node execution**: `node /path/to/server.js`
2. **With working directory**: `cwd` parameter in mcp.json
3. **Global npm command**: After `npm link`
4. **Shell script wrapper**: To handle PATH issues
5. **NPX execution**: `npx -y package-name`
6. **Absolute paths**: Full paths to node and script

## Working Alternative: Claude Desktop
The MCP server DOES work with Claude Desktop app using this configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "node",
      "args": ["/full/path/to/jaxon-optimizely-dxp-mcp.js"]
    }
  }
}
```

## For Testing the Server
You can test the server directly without Claude Code:

```bash
# Test initialization
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node jaxon-optimizely-dxp-mcp.js

# Test tools list
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node jaxon-optimizely-dxp-mcp.js
```

## Next Steps
1. **Use with Claude Desktop**: The server works perfectly with the desktop app
2. **Wait for Claude Code updates**: The MCP integration in Claude Code may improve
3. **Publish to npm**: Once published, it may work better as an official package
4. **Report issue**: Consider reporting this to the Claude Code team

## Technical Details
- MCP Protocol Version: 0.1.0
- Server includes proper handling for:
  - initialize/initialized handshake
  - tools/list enumeration  
  - tools/call execution
  - Error responses
  - Silent stderr (no debug output unless DEBUG=1)

## Files Created During Testing
- `/jodmcp/test-mcp.js` - Minimal test server
- `/jodmcp/simple-mcp.js` - Simple working server
- `/jodmcp/debug-wrapper.js` - Debug logging wrapper
- `/jodmcp/mcp-wrapper.js` - Path resolution wrapper
- `/jodmcp/run-mcp.sh` - Shell script with environment setup

These can be removed as they were only for debugging.