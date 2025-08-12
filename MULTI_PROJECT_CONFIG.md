# Multi-Project Configuration Guide

The Optimizely DXP MCP Server supports managing multiple projects seamlessly! You can configure multiple projects and switch between them during conversations with your AI assistant.

## 🎯 Key Features

- **Multiple Project Support**: Configure unlimited projects
- **Named Projects**: Give friendly names to each project
- **Environment Access Control**: Specify which environments each project can access
- **Credential Override**: Switch projects on-the-fly without restarting

## 📋 Configuration Examples

### Option 1: Single Default Project (Simple)
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

### Option 2: Multiple Projects with Names (Recommended)
```json
{
  "mcpServers": {
    "jaxon-optimizely-dxp": {
      "command": "jaxon-optimizely-dxp-mcp",
      "env": {
        "OPTIMIZELY_DEFAULT_PROJECT": "production",
        "OPTIMIZELY_PROJECTS": "[{\"name\":\"production\",\"id\":\"caecbb62-0fd4-4d09-8627-ae7e018b595e\",\"environments\":[\"Production\",\"Preproduction\"]},{\"name\":\"development\",\"id\":\"4d564ff8-2e44-4609-8d29-af86012acbf5\",\"environments\":[\"Integration\",\"Preproduction\"]}]",
        "OPTIMIZELY_API_KEY": "your-api-key",
        "OPTIMIZELY_API_SECRET": "your-api-secret"
      }
    }
  }
}
```

### Option 3: Separate Credentials Per Project
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

## 💬 Usage Examples

### With Default Project
```
User: "List deployments"
AI: [Lists deployments for default project]

User: "List deployments for project 4d564ff8-2e44-4609-8d29-af86012acbf5"
AI: [Lists deployments for specified project]
```

### With Named Projects
```
User: "Deploy code from Integration to Preproduction on development project"
AI: [Deploys on development project]

User: "Copy content from Production to Preproduction on production project"
AI: [Copies content on production project]
```

### With Credential Override
```
User: "List deployments using project: abc-123, key: xxx, secret: yyy"
AI: [Lists deployments for project abc-123 with provided credentials]
```

## 🔐 Security Considerations

1. **Environment Restrictions**: Use `OPTIMIZELY_ALLOWED_ENVIRONMENTS` to limit access
2. **Separate Credentials**: Use different API keys for production vs development
3. **Read-Only Access**: Create API keys with limited permissions for safer operations

## 🎯 Best Practices

1. **Name Your Projects**: Use descriptive names like "production", "staging", "client-xyz"
2. **Limit Environments**: Only allow access to environments each project needs
3. **Default Project**: Set a default for the most commonly used project
4. **Group by Purpose**: Separate production from development configurations

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

## 🚀 Advanced: Project Switching in AI Conversation

The AI assistant can seamlessly switch between projects:

```
User: "Show me deployments for all my projects"
AI: 
  Production Project:
  - [Lists deployments]
  
  Development Project:
  - [Lists deployments]

User: "Deploy Integration to Preproduction on dev, then copy Production content to Preproduction on prod"
AI: 
  1. Starting deployment on Development project...
  2. Starting content copy on Production project...
```

## 📌 Quick Setup

1. Choose a configuration option above
2. Update your Claude Desktop config file
3. Restart Claude Desktop
4. Ask your AI to "check Optimizely configuration" to verify

The multi-project support makes it easy to manage entire portfolios of Optimizely DXP sites through a single AI assistant!