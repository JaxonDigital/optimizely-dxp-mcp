# Multi-Project Configuration

Configure multiple Optimizely DXP projects for agencies or enterprises managing multiple sites.

## Configuration Format

Each project needs: `id=UUID;key=KEY;secret=SECRET`

## Examples

### Single Company, Multiple Environments
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "@jaxon-digital/optimizely-dxp-mcp",
      "env": {
        "PRODUCTION": "id=abc-123;key=prod-key;secret=prod-secret;default=true",
        "STAGING": "id=abc-123;key=stage-key;secret=stage-secret",
        "DEVELOPMENT": "id=abc-123;key=dev-key;secret=dev-secret"
      }
    }
  }
}
```

### Agency with Multiple Clients
```json
{
  "mcpServers": {
    "optimizely": {
      "command": "@jaxon-digital/optimizely-dxp-mcp",
      "env": {
        "ACME_CORP": "id=uuid1;key=key1;secret=secret1;default=true",
        "CONTOSO": "id=uuid2;key=key2;secret=secret2",
        "FABRIKAM": "id=uuid3;key=key3;secret=secret3"
      }
    }
  }
}
```

## Usage

### Default Project
The first project or one marked `default=true` is used by default:
```
"Deploy to Production"  # Uses default project
```

### Specific Project
Reference by name:
```
"Deploy to Production for ACME_CORP"
"List deployments for Contoso"
```

### Inline Credentials
Provide credentials directly:
```
"Deploy for project MyClient with id UUID, key KEY, secret SECRET"
```

## Best Practices

1. **Use descriptive names**: CLIENT_NAME or ENVIRONMENT_TYPE
2. **Set a default**: Add `default=true` to your primary project
3. **Secure your config**: Never commit credentials to version control
4. **Rotate keys regularly**: Update API keys periodically

## Troubleshooting

- **"No projects configured"**: Check environment variable format
- **"Project not found"**: Verify project name matches exactly
- **"Authentication failed"**: Validate API credentials in DXP Portal

For more details, see the main [README](README.md).