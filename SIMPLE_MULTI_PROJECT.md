# Multi-Project Configuration

Configure multiple Optimizely projects with clean, readable environment variables.

## Configuration Format

```
OPTIMIZELY_PROJECT_<NAME>="id=<uuid>;key=<apikey>;secret=<apisecret>"
```

## Quick Examples

### Claude Desktop

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_ACME_CORP": "id=acme-uuid;key=acme-key;secret=acme-secret;default=true",
        "OPTIMIZELY_PROJECT_CONTOSO": "id=contoso-uuid;key=contoso-key;secret=contoso-secret",
        "OPTIMIZELY_PROJECT_SANDBOX": "id=sandbox-uuid;key=sandbox-key;secret=sandbox-secret"
      }
    }
  }
}
```

### Claude Code CLI

```bash
# Add MCP globally
claude mcp add --scope user jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"

# Edit configuration
claude mcp edit jaxon-optimizely-dxp
```

Add your projects:
```json
"env": {
  "OPTIMIZELY_PROJECT_MAIN_WEBSITE": "id=abc-123;key=xxx;secret=yyy;default=true",
  "OPTIMIZELY_PROJECT_BLOG_SITE": "id=def-456;key=aaa;secret=bbb"
}
```

## How It Works

### Projects vs Environments
- Each **project** in Optimizely DXP has 3 environments: Integration, Preproduction, Production
- One API key typically gives access to all 3 environments in that project
- Configure one entry per DXP project, not per environment

### Project Names
- Come from the variable name:
  - `OPTIMIZELY_PROJECT_ACME_CORP` → "ACME CORP"
  - `OPTIMIZELY_PROJECT_MY_WEBSITE` → "MY WEBSITE" (underscores become spaces)

### Parameters
- **Required**: `id`, `key`, `secret`
- **Optional**: 
  - `default=true` - Makes this the default project
  - `environments=Integration,Preproduction` - Limits allowed environments (rare use case)

## Usage

```
"List deployments"                           # Uses default project
"Deploy Integration to Preproduction"        # Uses default project
"Deploy on Acme Corp"                        # Uses Acme Corp project
"Export Production database from Contoso"    # Exports from Contoso's Production environment
"Show all projects"                          # Lists configured projects
```

## Benefits

✅ **Readable** - No JSON escaping  
✅ **Easy to Edit** - Direct value changes  
✅ **Self-Documenting** - Variable names show projects  
✅ **Flexible** - Add/remove projects easily  

## See Also

- [Full Configuration Guide](MULTI_PROJECT_CONFIG.md) - Detailed examples and best practices
- [README](README.md) - Complete setup instructions