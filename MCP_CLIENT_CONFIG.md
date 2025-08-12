# MCP Client Configuration Guide

## Enhanced Server Features

Your MCP server now supports:
- ✅ **Persistent connections** with heartbeat every 15 seconds
- ✅ **Connection state tracking** 
- ✅ **Ping/pong support** for connection verification
- ✅ **Graceful error handling** for disconnections
- ✅ **Optional WebSocket mode** (using jaxon-optimizely-dxp-mcp-websocket.js)

## Client Configurations

### 1. Claude Desktop App

Edit: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "node",
      "args": ["/Users/bgerby/Documents/dev/deployment-mcp/jaxon-optimizely-dxp-mcp.js"],
      "env": {
        "DEBUG": "false"
      }
    }
  }
}
```

### 2. Cline (VS Code Extension)

Add to VS Code settings.json:

```json
{
  "cline.mcpServers": [
    {
      "name": "jaxon-optimizely-dxp",
      "command": "node",
      "args": ["/Users/bgerby/Documents/dev/deployment-mcp/jaxon-optimizely-dxp-mcp.js"]
    }
  ]
}
```

### 3. Continue.dev (Free VS Code Extension)

Add to `~/.continue/config.json`:

```json
{
  "models": [...],
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "node",
      "args": ["/Users/bgerby/Documents/dev/deployment-mcp/jaxon-optimizely-dxp-mcp.js"]
    }
  }
}
```

### 4. WebSocket Mode (For Custom Clients)

Start server in WebSocket mode:
```bash
node jaxon-optimizely-dxp-mcp-websocket.js websocket
```

Connect to: `ws://localhost:8080`

### 5. Using NPM Global Install

If installed globally via npm:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "args": []
    }
  }
}
```

## Testing Connection

### Test with Inspector
```bash
npx @modelcontextprotocol/inspector node jaxon-optimizely-dxp-mcp.js
```

### Test Ping Support
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' | node jaxon-optimizely-dxp-mcp.js
```

Expected response:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": "pong",
    "timestamp": 1234567890,
    "connected": true
  }
}
```

### Monitor Heartbeat
```bash
node jaxon-optimizely-dxp-mcp.js 2>/dev/null | grep heartbeat
```

You should see heartbeat notifications every 15 seconds:
```json
{"jsonrpc":"2.0","method":"notification/heartbeat","params":{"timestamp":1234567890,"status":"alive"}}
```

## Troubleshooting

### "Not Connected" Status
Even with persistent connection support, some clients may still show "not connected" if they:
1. Don't support the heartbeat protocol extension
2. Use their own connection detection method
3. Have a bug in their connection status display

The server IS working if:
- Tools appear in the client's tool list
- You can execute tools successfully
- The test commands above work

### Debug Mode
Enable debug logging by setting the DEBUG environment variable:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "node",
      "args": ["/path/to/jaxon-optimizely-dxp-mcp.js"],
      "env": {
        "DEBUG": "true"
      }
    }
  }
}
```

### WebSocket Connection Issues
If using WebSocket mode:
1. Ensure port 8080 is available
2. Install ws module: `npm install ws`
3. Check firewall settings
4. Use custom port: `MCP_PORT=3000 node jaxon-optimizely-dxp-mcp-websocket.js websocket`

## Connection Status Verification

The enhanced server provides multiple ways to verify connection:

1. **Heartbeat notifications** - Sent every 15 seconds
2. **Ping/pong** - Request/response pattern for active checking
3. **Connection state** - Tracked internally and reported in responses
4. **Experimental capabilities** - Advertised in initialize response

These features should improve connection reliability and status reporting in compatible MCP clients.