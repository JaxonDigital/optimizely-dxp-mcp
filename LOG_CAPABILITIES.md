# 📊 Log Analysis & Download Capabilities

## What We've Built

### 1. **Log Download from Azure Storage** (`download_logs`)
Downloads Application Insights logs from Azure Storage containers.

#### Log Types Available:
- **Application Logs** - Application-specific logging
- **Web Logs** - IIS/web server logs  
- **CloudFlare Logs** - CDN logs (if configured)
- **All** - Downloads all available log types

#### Time-Based Filtering:
```bash
# Simple day-based filtering
claude "download logs from last 7 days"     # daysBack: 7
claude "download logs from last 24 hours"   # daysBack: 1

# Date range filtering
claude "download logs from August 20 to 25"  # startDate/endDate

# Specific date filtering
claude "download logs from 2025/08/24"      # dateFilter
```

#### Timezone Support (NEW):
```bash
# Automatic timezone detection
claude "download logs from August 27"  
# Automatically converts your local August 27 to UTC

# Explicit timezone specification
claude "download logs from August 27 timezone EST"
claude "download logs from August 27 timezone PST"
claude "download logs from August 27 timezone UTC"

# Timezone offset
claude "download logs from August 27 timezone -5"  # EST
claude "download logs from August 27 timezone +2"  # CEST
```

**Important**: Azure logs are stored in UTC, but the system now automatically:
- Detects your local timezone
- Converts your requested dates to UTC
- Expands date ranges to cover the full day in your timezone
- Shows timezone adjustment in descriptions

#### Features:
- **90 days of logs available** (Azure Storage retention)
- **Automatic container detection** (insights-logs-* pattern)
- **Size preview** before downloading
- **Progress tracking** during download
- **Configurable download paths** per project
- **Stale log detection** (NEW) - Alerts if Production logs are >30 days old
- **Timezone-aware filtering** (NEW) - Automatically handles UTC conversion

### 2. **Intelligent Log Analysis** (`analyze_logs`) 
AI-powered log analysis that downloads logs temporarily, analyzes them, then cleans up.

#### Pattern Detection:
- **Errors**: ERROR, FATAL, Exception, Failed, crashes
- **Warnings**: WARN, deprecated, timeout
- **Security**: unauthorized, forbidden, authentication failed
- **Performance**: slow, timeout, latency issues
- **Database**: SQL errors, deadlocks, connection issues
- **HTTP Errors**: 404, 500, 503, etc.

#### Analysis Output:
```bash
claude "analyze logs from production"

# Returns:
# 📊 Log Analysis Report
# - Total Lines: 45,231
# - Errors: 142 (0.31%)
# - Warnings: 523
# - Unique Errors: 27
# 
# 🔍 Pattern Detection
# - HTTP Errors: 89 occurrences
# - Database issues: 12 occurrences
# - Security events: 3 occurrences
#
# 🎯 Recommendations
# - High error rate detected
# - Review authentication failures
# - Database connection pooling issues
```

#### Natural Language Queries:
```bash
# Find specific issues
claude "find errors in production logs from last hour"
claude "show performance issues in staging logs"
claude "detect security events in last 24 hours"

# Get statistics
claude "show log statistics for production"
claude "analyze error trends over last week"
```

## How It Works

### Log Download Process:
1. **Connects to Azure Storage** using project credentials
2. **Lists available containers** (insights-logs-applicationlogs, etc.)
3. **Filters by date** if specified
4. **Shows preview** with file count and total size
5. **Downloads to configured path** (default: ./logs)
6. **Tracks progress** with real-time updates

### Log Analysis Process:
1. **Downloads logs to temp directory**
2. **Parses and analyzes** log content
3. **Detects patterns** using regex matching
4. **Generates insights** based on findings
5. **Creates recommendations**
6. **Cleans up temp files** automatically

## Configuration

### Download Paths:
```bash
# Set project-specific log download path
claude "set log download path to ./logs/project-name"

# Environment variables (in .mcp.json)
"PROJECT_NAME": "logPath=/path/to/logs"
```

### Default Behaviors:
- **Environment**: Production (unless specified)
- **Time Range**: Last 24 hours (daysBack: 1)
- **Log Type**: Application logs
- **Download Path**: ./logs or project-specific path

## Examples

### Basic Log Download:
```bash
# Download today's application logs from production
claude "download logs"

# Download last week's logs from staging
claude "download logs from staging for last 7 days"

# Download specific date range
claude "download logs from August 20 to August 25"
```

### Log Analysis:
```bash
# Quick error check
claude "analyze logs for errors"

# Performance analysis
claude "find performance issues in logs from last hour"

# Security audit
claude "check for security events in production logs"
```

### Advanced Filtering:
```bash
# Specific log type and timeframe
claude "download web logs from last 3 days"

# Multiple filters
claude "analyze application logs from staging environment for last 48 hours"
```

## Limitations

1. **90-day retention** - Azure Storage keeps logs for 90 days
2. **Large file handling** - Very large log files may take time to download/analyze
3. **Temp storage** - Analysis requires temporary local storage
4. **Pattern matching** - Regex-based, may not catch all variations

## Best Practices

1. **Preview First**: Use preview mode to check size before downloading
2. **Time Filtering**: Always specify timeframe to avoid large downloads
3. **Regular Analysis**: Run periodic analyses to catch issues early
4. **Clean Up**: Downloaded logs accumulate - clean old files regularly

## Future Enhancements (Not Yet Implemented)

- Real-time log streaming
- Custom pattern definitions
- Log aggregation across environments
- Automated alerting on patterns
- Historical trend analysis
- Export to monitoring platforms