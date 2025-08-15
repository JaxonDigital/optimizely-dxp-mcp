# Multi-Project Configuration Guide

> **Simple Configuration Available!**  
> See [SIMPLE_MULTI_PROJECT.md](SIMPLE_MULTI_PROJECT.md) for the clean `OPTIMIZELY_PROJECT_<NAME>` format.

## Overview

The Optimizely DXP MCP Server supports managing multiple projects with a clean, readable configuration format.

## Configuration Format

Each project is defined with an environment variable:
```
OPTIMIZELY_PROJECT_<NAME>="id=<uuid>;key=<apikey>;secret=<apisecret>"
```

### Claude Desktop Example

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_ACME_CORP": "id=acme-uuid;key=acme-key;secret=acme-secret;default=true",
        "OPTIMIZELY_PROJECT_CONTOSO": "id=contoso-uuid;key=contoso-key;secret=contoso-secret",
        "OPTIMIZELY_PROJECT_FABRIKAM": "id=fabrikam-uuid;key=fabrikam-key;secret=fabrikam-secret"
      }
    }
  }
}
```

### Claude Code CLI Example

```bash
# Add the MCP globally
claude mcp add --scope user jaxon-optimizely-dxp "jaxon-optimizely-dxp-mcp"

# Edit to add projects
claude mcp edit jaxon-optimizely-dxp
```

Then add your projects:
```json
"env": {
  "OPTIMIZELY_PROJECT_CLIENT_A": "id=aaa;key=xxx;secret=yyy",
  "OPTIMIZELY_PROJECT_CLIENT_B": "id=bbb;key=xxx;secret=yyy",
  "OPTIMIZELY_PROJECT_CLIENT_C": "id=ccc;key=xxx;secret=yyy;default=true"
}
```

## Dynamic Project Registration

You can also provide credentials inline and they'll be remembered:

```
"Deploy for ClientX with projectName ClientX, projectId xxx, apiKey yyy, apiSecret zzz"
```

After first use, just reference by name:
```
"Deploy on ClientX"
"List deployments for ClientX"
```

## Understanding Projects vs Environments

**Key Concept:** Each Optimizely DXP project contains 3 environments:
- **Integration** - Development environment
- **Preproduction** - Staging/testing environment
- **Production** - Live website

One API key typically provides access to all 3 environments within a project.

## Project Name Rules

- Variable name becomes the project name
- `OPTIMIZELY_PROJECT_ACME_CORP` → "ACME CORP"
- `OPTIMIZELY_PROJECT_MY_WEBSITE` → "MY WEBSITE" (underscores become spaces)
- Names are case-insensitive when referencing

## Optional Parameters

- `default=true` - Mark as default project
- `environments=Integration,Preproduction` - Limit allowed environments

## Usage Examples

### With Default Project
```
"List deployments"  # Uses default project
"Deploy Integration to Preproduction"  # Uses default
```

### Specify Project by Name
```
"Deploy Integration to Production on Acme Corp"
"List deployments for Contoso"
"Export Production database from Fabrikam"
```

### List All Projects
```
"Show all projects"
"List configured projects"
```

## Best Practices

### For Agencies
- Use descriptive client names: `OPTIMIZELY_PROJECT_ACME_CORP`
- Set your most-used client as default
- Keep credentials in a password manager

### For Teams
- Use descriptive project names: `MAIN_WEBSITE`, `BLOG`, `DOCUMENTATION`
- Share configuration templates, not actual credentials
- Document which project is which in your team wiki

### For Individual Developers
- Keep it simple with just the projects you need
- Use `default=true` for your main project
- Consider using generic names if working with one client

## Troubleshooting

### Projects Not Showing?
1. Check variable names start with `OPTIMIZELY_PROJECT_`
2. Ensure all required fields: `id`, `key`, `secret`
3. Restart Claude Desktop/Code after changes

### Can't Find a Project?
- Project names are case-insensitive
- Try `"List all projects"` to see exact names
- Check for typos in environment variable names

## Security Notes

- Never commit real credentials to version control
- Use placeholder values in documentation
- Consider using a secrets manager for production
- Credentials are only stored in your local Claude configuration