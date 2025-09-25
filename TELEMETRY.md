# Telemetry & Privacy

## What We Collect (Opt-in)

Anonymous usage data to improve the product:
- Tool usage frequency (which tools are popular)
- Error types (to fix common issues)
- Performance metrics (operation timing)
- Platform info (OS type, MCP version)

## What We DON'T Collect

- API keys or credentials
- Project IDs or names  
- Personal information (usernames, hostnames)
- File contents, paths, or package names
- Network details, IP addresses
- Environment variables or system details
- Error messages (only error categories)

## How to Opt Out

### Method 1: Environment Variable
Add to your MCP configuration:
```json
{
  "env": {
    "OPTIMIZELY_MCP_TELEMETRY": "false"
  }
}
```

### Method 2: Use the Tool
Ask your AI: "Disable telemetry"

## Data Storage

- **Local only**: Data stays on your machine in `/tmp`
- **Auto-cleanup**: Deleted after 30 days
- **Small size**: ~100KB maximum

## Why Telemetry Helps

- Prioritize features users actually need
- Fix bugs affecting most users first
- Optimize performance for common operations
- Understand usage patterns

## Technical Details

For developers and analytics teams, see the comprehensive technical specification:
- **[TELEMETRY_EVENT_FORMAT.md](./TELEMETRY_EVENT_FORMAT.md)** - Complete event format specification, validation rules, and implementation details

## Questions?

Contact: support@jaxondigital.com