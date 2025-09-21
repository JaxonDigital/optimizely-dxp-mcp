# Customizable Tools via ENABLED_TOOLS

## Overview

The Optimizely DXP MCP Server now supports customizable tool filtering through the `ENABLED_TOOLS` environment variable. This feature allows you to expose only the tools you need, reducing clutter and improving the AI assistant experience.

## Configuration

### Environment Variables

You can use either of these environment variables:
- `ENABLED_TOOLS` (preferred)
- `OPTIMIZELY_MCP_ENABLED_TOOLS` (alternative)

### Basic Usage

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "PROJECT_NAME": "id=xxx;key=yyy;secret=zzz",
        "ENABLED_TOOLS": "deploy,status,test_connection"
      }
    }
  }
}
```

## Pattern Syntax

### Exact Matching
Specify tool names exactly as they appear:
```
ENABLED_TOOLS="deploy,status,quick"
```

### Wildcard Patterns

#### Asterisk (*) - Match Any Characters
- `deploy*` - Matches: deploy, deploy_package, deployment
- `*status` - Matches: status, export_status, check_export_status
- `*_connection` - Matches: test_connection
- `test_*` - Matches: test_connection, test_anything

#### Question Mark (?) - Match Single Character
- `deploy?` - Matches: deploy1, deployX (but not deploy or deploy12)
- `get_?_status` - Matches: get_X_status (single character in middle)

### Special Values
- `*` or empty string - Enable all tools (default behavior)
- Comma-separated list - Enable only specified tools/patterns

## Examples

### Development Environment
Focus on deployment and testing tools:
```
ENABLED_TOOLS="deploy*,test_*,status,quick"
```

### Production Environment
Limit to monitoring and read-only operations:
```
ENABLED_TOOLS="status,quick,list_*,get_*,check_*"
```

### Database Operations Only
For database-focused workflows:
```
ENABLED_TOOLS="export_database,check_export_status,list_exports,download*"
```

### CI/CD Pipeline
For automated deployment workflows:
```
ENABLED_TOOLS="deploy,start_deployment,complete_deployment,get_deployment_status"
```

### Minimal Setup
Just the essentials:
```
ENABLED_TOOLS="deploy,status,test_connection"
```

## Tool Categories Reference

### Core Deployment
- `deploy` - Smart deployment with defaults
- `start_deployment` - Start a new deployment
- `complete_deployment` - Complete in-progress deployment
- `reset_deployment` - Rollback deployment

### Status & Monitoring
- `status` - Intelligent status overview
- `quick` - Ultra-fast status check
- `get_deployment_status` - Check specific deployment

### Database Operations
- `export_database` - Create database backup
- `check_export_status` - Check export progress
- `list_exports` - List available exports

### Downloads
- `download_logs` - Download log files
- `download_blobs` - Download media/blobs
- `list_active_downloads` - Show active downloads

### Project Management
- `switch_project` - Change active project
- `list_projects` - List all projects
- `current_project` - Show current project

### Setup & Testing
- `test_connection` - Test API connectivity
- `health_check` - Quick health check
- `get_version` - Check MCP version

## Debugging

Enable debug output to see which tools are being filtered:
```json
{
  "env": {
    "ENABLED_TOOLS": "deploy*,status",
    "TOOL_FILTER_DEBUG": "true"
  }
}
```

Debug output will show:
- Which patterns are active
- Number of tools enabled/disabled
- Pattern matching details

## Best Practices

1. **Start Restrictive**: Begin with a minimal set and add tools as needed
2. **Use Wildcards Wisely**: Patterns like `get_*` enable all read operations
3. **Test Your Patterns**: Use `TOOL_FILTER_DEBUG=true` to verify filtering
4. **Document Your Config**: Comment why certain tools are enabled/disabled
5. **Environment-Specific**: Use different patterns for dev/staging/prod

## Pattern Matching Rules

- Patterns are **case-insensitive**
- Exact matches take precedence over wildcards
- Multiple patterns are OR'd together (any match enables the tool)
- Tools not matching any pattern are disabled
- No regex support - only `*` and `?` wildcards

## Troubleshooting

### No Tools Available
If you see no tools, check:
1. Pattern syntax is correct
2. Tool names match exactly (use `list_projects` to see all tools)
3. Environment variable is being passed correctly

### Tool Not Working
If a tool isn't available:
1. Check if it matches your patterns
2. Enable debug mode to see filtering decisions
3. Try adding the exact tool name to test

### Performance Impact
Tool filtering has minimal impact:
- Filtering happens once at startup
- No runtime performance penalty
- Reduces MCP protocol overhead by sending fewer tools

## Implementation Details

The tool filter is implemented in `/lib/tool-filter.js` and integrates with the MCP server at two points:

1. **Tool Listing**: Filters the tool list sent to the AI assistant
2. **Tool Calling**: Validates tool access before execution

This ensures consistent filtering throughout the MCP session.