# Multi-Project Configuration Guide

The Optimizely DXP MCP Server supports managing multiple projects through different configuration approaches.

## 🎯 Current Capabilities

- **Single Project Per Instance**: Each MCP instance manages one project
- **Dynamic Credential Override**: Pass different credentials per operation
- **Multiple MCP Instances**: Run separate instances for different projects
- **Environment Variables**: Configure default project credentials

## 📋 Configuration Options

### Option 1: Multiple Projects in One Instance (NEW - v1.6.0) 🎉
Configure all your projects in a single MCP instance:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECTS": "[{\"name\":\"production\",\"id\":\"abc-123\",\"apiKey\":\"prod-key\",\"apiSecret\":\"prod-secret\",\"isDefault\":true},{\"name\":\"development\",\"id\":\"def-456\",\"apiKey\":\"dev-key\",\"apiSecret\":\"dev-secret\"}]"
      }
    }
  }
}
```

**Benefits:**
- ✅ Single MCP instance manages all projects
- ✅ Easy switching by project name
- ✅ Use "list projects" to see all configured projects
- ✅ Default project for quick operations

### Option 2: Single Project Configuration
The simplest approach for managing one project:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "My Project",
        "OPTIMIZELY_PROJECT_ID": "caecbb62-0fd4-4d09-8627-ae7e018b595e",
        "OPTIMIZELY_API_KEY": "your-api-key",
        "OPTIMIZELY_API_SECRET": "your-api-secret"
      }
    }
  }
}
```

### Option 3: Multiple MCP Instances for Different Projects
Configure separate MCP instances for each project:

```json
{
  "mcpServers": {
    "optimizely-production": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "Production Website",
        "OPTIMIZELY_PROJECT_ID": "caecbb62-0fd4-4d09-8627-ae7e018b595e",
        "OPTIMIZELY_API_KEY": "prod-api-key",
        "OPTIMIZELY_API_SECRET": "prod-api-secret"
      }
    },
    "optimizely-development": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "Development Site",
        "OPTIMIZELY_PROJECT_ID": "4d564ff8-2e44-4609-8d29-af86012acbf5",
        "OPTIMIZELY_API_KEY": "dev-api-key",
        "OPTIMIZELY_API_SECRET": "dev-api-secret"
      }
    }
  }
}
```

### Option 4: Dynamic Credential Override
Configure a default project and override credentials as needed:

```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_PROJECT_NAME": "Default Project",
        "OPTIMIZELY_PROJECT_ID": "default-project-id",
        "OPTIMIZELY_API_KEY": "default-api-key",
        "OPTIMIZELY_API_SECRET": "default-api-secret"
      }
    }
  }
}
```

## 💬 Usage Examples

### List All Projects (NEW!)
```
User: "List projects"
AI: Shows all configured projects with their names and IDs
```

### Working with Default Project
```
User: "List deployments"
AI: [Uses default credentials from environment variables]

User: "Deploy Integration to Preproduction"
AI: [Deploys using default project configuration]
```

### Dynamic Credential Override
Every tool supports optional credential parameters:

```
User: "List deployments for project abc-123 with key xxx and secret yyy"
AI: [I'll list deployments using those credentials]
    [Uses projectId: abc-123, apiKey: xxx, apiSecret: yyy]
```

### Using Multiple MCP Instances
When you have multiple MCP servers configured:

```
User: "Use optimizely-production to list deployments"
AI: [Uses the production MCP instance]

User: "Use optimizely-development to deploy Integration to Preproduction"
AI: [Uses the development MCP instance]
```

## 🔐 Security Considerations

1. **Separate Credentials**: Use different API keys for production vs development
2. **Read-Only Access**: Create API keys with limited permissions for safer operations
3. **Environment Files**: Use `.env` files for local development (never commit these)
4. **Secret Masking**: All credentials are automatically masked in outputs

## 📝 Environment Variables Reference

| Variable | Description | Example | Required |
|----------|-------------|---------|----------|
| `OPTIMIZELY_PROJECT_ID` | Project ID (UUID) | `caecbb62-0fd4-4d09-8627-ae7e018b595e` | No* |
| `OPTIMIZELY_PROJECT_NAME` | Friendly project name | `Production Website` | No |
| `OPTIMIZELY_API_KEY` | API key for authentication | `your-api-key` | No* |
| `OPTIMIZELY_API_SECRET` | API secret for authentication | `your-api-secret` | No* |

*Required unless provided as parameters in each tool call

## 🎯 Best Practices

1. **Named Instances**: Give your MCP instances descriptive names
2. **Secure Storage**: Never commit credentials to version control
3. **Minimal Permissions**: Use API keys with only necessary permissions
4. **Environment Separation**: Keep production and development credentials separate
5. **Regular Rotation**: Rotate API keys periodically

## 📌 Quick Setup Steps

1. Choose your configuration approach (single or multiple instances)
2. Update your Claude Desktop config file (`~/Library/Application Support/Claude/claude_desktop_config.json` on Mac)
3. Add your Optimizely credentials
4. Restart Claude Desktop
5. Test with "check Optimizely configuration"

## 🔄 Switching Between Projects

### With Multiple MCP Instances
- Reference the specific MCP server in your request
- Example: "Use optimizely-production to list deployments"

### With Dynamic Override
- Pass credentials directly in your request
- All tools accept optional `projectId`, `apiKey`, and `apiSecret` parameters

## 📝 Using .env Files

For local development, you can use `.env` files instead of hardcoding credentials:

```bash
# .env file in your project directory
OPTIMIZELY_PROJECT_NAME=MyProject
OPTIMIZELY_PROJECT_ID=your-project-uuid
OPTIMIZELY_API_KEY=your-api-key
OPTIMIZELY_API_SECRET=your-api-secret
```

The MCP server will automatically load these when run from the same directory.

**Important**: Never commit `.env` files to version control!

## ✨ New Features (v1.6.0)

### Built-in Project Management
- **list_projects** - View all configured projects
- **get_project_info** - Get details for any project
- **Automatic project switching** - Use project names in commands
- **OPTIMIZELY_PROJECTS** - Configure multiple projects in one place

### Smart Project Switching
Just use the project name or ID in your commands:
- "List deployments for production"
- "Deploy on development project"
- "Check status on project abc-123"

---

Built by Jaxon Digital - Optimizely Gold Partner