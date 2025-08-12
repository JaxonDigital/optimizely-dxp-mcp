# Multi-Project Configuration Guide

The Optimizely DXP MCP Server supports managing multiple projects through a **single MCP instance**! Configure all your projects once and switch between them seamlessly during conversations.

## 🎯 Key Features

- **Single MCP Instance**: One server managing all your projects
- **Named Projects**: Use friendly names instead of GUIDs
- **Per-Project Credentials**: Different API keys for each project
- **Dynamic Switching**: Change projects mid-conversation
- **Environment Control**: Limit access per project

## 📋 Configuration Examples

### Option 1: Single MCP Instance with Multiple Projects (🌟 RECOMMENDED)
This is the best approach - one MCP server managing all your projects!

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        // Default project (optional - used when no project specified)
        "OPTIMIZELY_PROJECT_ID": "caecbb62-0fd4-4d09-8627-ae7e018b595e",
        "OPTIMIZELY_API_KEY": "your-api-key",
        "OPTIMIZELY_API_SECRET": "your-api-secret",
        
        // Configure ALL your projects here
        "OPTIMIZELY_PROJECTS": JSON.stringify([
          {
            "name": "production",
            "id": "caecbb62-0fd4-4d09-8627-ae7e018b595e",
            "apiKey": "prod-api-key",
            "apiSecret": "prod-api-secret",
            "environments": ["Production", "Preproduction"]
          },
          {
            "name": "development",
            "id": "4d564ff8-2e44-4609-8d29-af86012acbf5",
            "apiKey": "dev-api-key",
            "apiSecret": "dev-api-secret",
            "environments": ["Integration", "Preproduction"]
          },
          {
            "name": "client-xyz",
            "id": "abc-123-def-456",
            "apiKey": "client-api-key",
            "apiSecret": "client-api-secret",
            "environments": ["Production", "Preproduction", "Integration"]
          }
        ])
      }
    }
  }
}
```

**Benefits of this approach:**
- ✅ Single MCP connection to manage
- ✅ Switch projects mid-conversation
- ✅ No need to restart or reconfigure
- ✅ Clean and organized configuration
- ✅ One tool for all your DXP projects

### Option 2: Simple Single Project Configuration
For managing just one project:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_ID": "caecbb62-0fd4-4d09-8627-ae7e018b595e",
        "OPTIMIZELY_API_KEY": "your-api-key",
        "OPTIMIZELY_API_SECRET": "your-api-secret"
      }
    }
  }
}
```

### Option 3: Separate MCP Instances (Not Recommended)
While this works, we recommend Option 1 instead for easier management.

```json
{
  "mcpServers": {
    "optimizely-prod": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "Production Website",
        "OPTIMIZELY_PROJECT_ID": "caecbb62-0fd4-4d09-8627-ae7e018b595e",
        "OPTIMIZELY_API_KEY": "prod-api-key",
        "OPTIMIZELY_API_SECRET": "prod-api-secret",
        "OPTIMIZELY_ALLOWED_ENVIRONMENTS": "Production,Preproduction"
      }
    },
    "optimizely-dev": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "Development Site",
        "OPTIMIZELY_PROJECT_ID": "4d564ff8-2e44-4609-8d29-af86012acbf5",
        "OPTIMIZELY_API_KEY": "dev-api-key",
        "OPTIMIZELY_API_SECRET": "dev-api-secret",
        "OPTIMIZELY_ALLOWED_ENVIRONMENTS": "Integration,Preproduction"
      }
    }
  }
}
```

**Why this is not recommended:**
- ❌ Multiple MCP connections to manage
- ❌ Can't switch projects in same conversation
- ❌ More complex configuration
- ❌ Harder to maintain

## 💬 Usage Examples (With Single MCP Instance)

### Working with Default Project
```
User: "List deployments"
AI: [Lists deployments for default project]

User: "Deploy Integration to Preproduction"
AI: [Deploys on default project]
```

### Switching Between Named Projects
```
User: "Deploy code from Integration to Preproduction on development project"
AI: [Switches to development project and deploys]

User: "Now copy content from Production to Preproduction on production project"
AI: [Switches to production project and copies content]

User: "Show me deployments for client-xyz"
AI: [Switches to client-xyz project and lists deployments]
```

### Using Project IDs Directly
```
User: "List deployments for project 4d564ff8-2e44-4609-8d29-af86012acbf5"
AI: [Lists deployments for specified project ID]
```

### Dynamic Credential Override
```
User: "List deployments using project: abc-123, key: xxx, secret: yyy"
AI: [Uses provided credentials for this operation only]
```

### Managing Multiple Projects in One Conversation
```
User: "Compare deployments across all my projects"
AI: 
  Production Project:
  - [Lists deployments]
  
  Development Project:
  - [Lists deployments]
  
  Client XYZ Project:
  - [Lists deployments]
```

## 🔐 Security Considerations

1. **Environment Restrictions**: Use `OPTIMIZELY_ALLOWED_ENVIRONMENTS` to limit access
2. **Separate Credentials**: Use different API keys for production vs development
3. **Read-Only Access**: Create API keys with limited permissions for safer operations

## 🎯 Best Practices

1. **Use Single MCP Instance**: Configure all projects in one MCP server (Option 1)
2. **Name Your Projects**: Use descriptive names like "production", "staging", "client-xyz"
3. **Set a Default**: Configure your most-used project as the default
4. **Limit Environments**: Only allow access to environments each project needs
5. **Group by Purpose**: Separate production from development configurations
6. **Secure Credentials**: Use different API keys for production vs development

## 📝 Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `OPTIMIZELY_PROJECT_ID` | Default project ID | `caecbb62-0fd4-4d09-8627-ae7e018b595e` |
| `OPTIMIZELY_PROJECT_NAME` | Friendly name for project | `Production Website` |
| `OPTIMIZELY_API_KEY` | API key for authentication | `your-api-key` |
| `OPTIMIZELY_API_SECRET` | API secret for authentication | `your-api-secret` |
| `OPTIMIZELY_DEFAULT_PROJECT` | Name of default project | `production` |
| `OPTIMIZELY_PROJECTS` | JSON array of project configs | See examples above |
| `OPTIMIZELY_ALLOWED_ENVIRONMENTS` | Comma-separated environments | `Production,Preproduction` |

## 🚀 Advanced: Single MCP Managing Multiple Projects

With the recommended single MCP instance configuration, your AI assistant can:

- **Seamlessly switch** between projects without reconnecting
- **Remember context** across all your projects in one conversation
- **Execute operations** on different projects in sequence
- **Compare data** across multiple projects easily

Example workflow:
```
User: "Deploy my latest code to all staging environments"
AI: 
  ✓ Deploying to Development project (Integration → Preproduction)
  ✓ Deploying to Staging project (Integration → Preproduction)
  ✓ Deploying to Client-XYZ project (Integration → Preproduction)
  
User: "Now check the deployment status for all of them"
AI: [Shows status for all three deployments across projects]
```

## 📌 Quick Setup for Single MCP Instance

1. Copy the **Option 1** configuration (recommended)
2. Add your project details to the `OPTIMIZELY_PROJECTS` array
3. Update your Claude Desktop config file
4. Restart Claude Desktop
5. Ask your AI to "check Optimizely configuration" to verify

**That's it!** One MCP server now manages ALL your Optimizely DXP projects. No need for multiple connections or complex setups.

## 🎉 Why Single MCP Instance is Better

| Feature | Single MCP (Recommended) | Multiple MCPs |
|---------|--------------------------|---------------|
| Setup Complexity | Simple - one configuration | Complex - multiple configs |
| Project Switching | Instant, mid-conversation | Must specify MCP each time |
| Maintenance | Update one config | Update multiple configs |
| Context Sharing | Works across all projects | Limited to one project |
| Connection Management | One stable connection | Multiple connections |

Choose the single MCP instance approach and manage your entire Optimizely portfolio with ease!