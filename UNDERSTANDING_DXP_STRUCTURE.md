# DXP Quick Reference

## Structure
```
Project (your DXP instance)
├── Integration (development)
├── Preproduction (staging)
└── Production (live)
```

## Environment Names
- **Integration** - Development environment
- **Preproduction** - Staging/testing
- **Production** - Live website

The MCP accepts abbreviations (INT, PREP, PROD) but always use full names in the DXP portal.

## Deployment Flows
- **Code**: Integration → Preproduction → Production
- **Content**: Production → Preproduction → Integration

## API Keys
One key typically accesses all three environments. Get yours from the [DXP Portal](https://paasportal.episerver.net/).

For multi-project setup, see [Multi-Project Config](MULTI_PROJECT_CONFIG.md).