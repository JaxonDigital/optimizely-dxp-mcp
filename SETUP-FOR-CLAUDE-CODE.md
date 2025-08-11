# Setup Optimizely MCP Server for Claude Code

## Quick Installation

### 1. Copy the MCP Server
Copy `optimizely-mcp-server.js` to your project directory:
```bash
cp /Users/bgerby/Documents/dev/deployment-mcp/optimizely-mcp-server.js /path/to/your/project/
```

### 2. Create MCP Configuration
Create `mcp.json` in your project root:
```json
{
  "mcpServers": {
    "optimizely-dxp": {
      "command": "node",
      "args": ["optimizely-mcp-server.js"],
      "env": {}
    }
  }
}
```

### 3. Restart Claude Code
Close and restart your Claude Code session to load the new MCP server.

### 4. Verify Installation
In Claude Code, run:
```
/mcp
```

You should see "optimizely-dxp" listed as an available MCP server.

## Test the Integration

### Natural Language Test
Try asking Claude:
> "Can you help me export a database from my Optimizely DXP Integration environment?"

Claude should respond conversationally and ask for your API credentials.

### Manual Tool Test (if needed)
If you need to test the raw tool:
```
/tools
```
Should show `export_database` and `check_export_status` tools.

## Troubleshooting

### MCP Server Not Showing Up
1. Check `mcp.json` is in project root
2. Check file permissions on `optimizely-mcp-server.js`
3. Restart Claude Code completely
4. Run `/doctor` to check for issues

### Still Seeing Raw JSON
If you're still seeing JSON-RPC messages, it means:
1. MCP server isn't loaded properly
2. Claude is falling back to direct tool usage
3. Configuration file wasn't found

### Debug Commands
- `/mcp` - List MCP servers
- `/tools` - List available tools  
- `/doctor` - Check Claude Code health

## Expected User Experience

**Instead of seeing:**
```json
{"jsonrpc": "2.0", "method": "tools/call"...}
```

**Users should see:**
> User: "Export my database"
> 
> Claude: "I'll help you export your database from Optimizely DXP. I'll need a few details from you..."
> 
> [Conversational back-and-forth]
> 
> Claude: "🚀 Database Export Started Successfully!..."