# Advanced Features

## Blob Storage Operations

### Preview Mode (No Download Required)
Analyze blob storage without downloading files:

```bash
# Preview storage statistics
claude "preview production blobs"

# Returns:
# - Total files and size
# - File type distribution  
# - Largest files list
```

### Filtered Downloads
Download specific file types or patterns:

```bash
# Download only specific file types
claude "download PDF files from production"
claude "download images (JPG and PNG) from staging"
```

### Smart Detection
The MCP automatically:
- Detects the correct storage container name
- Uses appropriate permissions based on your API key
- Finds project-specific download paths

## Log Operations

### Log Downloads
Download Application Insights logs from Azure Storage:

```bash
# Time-based filtering
claude "download logs from last 7 days"
claude "download logs from August 24"

# Environment-specific
claude "download staging logs from last 48 hours"
```

### Log Analysis
AI-powered analysis of log files:

```bash
# Analyze for issues
claude "analyze production logs for errors"

# Pattern detection
claude "find performance issues in logs"
```

## Configuration

### Custom Download Paths
Set project-specific paths for downloads:

```bash
# In environment configuration
PROJECT_NAME="blobPath=/path/to/blobs;logPath=/path/to/logs"
```

### Multi-Project Support
Configure multiple projects with different credentials:

```bash
# In .mcp.json
"PROJECT_A": "id=xxx;key=yyy;secret=zzz",
"PROJECT_B": "id=aaa;key=bbb;secret=ccc;default=true"
```

## Performance Features

### Progress Tracking
- Real-time download progress with ETA
- File count and size tracking
- Automatic retry on failures

### Smart Caching
- Reuses recent operation results
- Reduces API calls
- Improves response times

## Best Practices

1. **Always preview** before large downloads
2. **Use time filters** for log operations
3. **Specify environments** explicitly when needed
4. **Check permissions** if operations fail

For complete documentation of all features, see the main README.md.