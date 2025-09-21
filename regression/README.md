# DXP MCP Regression Test Suite

## 🎯 Test Strategy

### Test Levels
1. **Unit Tests** - Component isolation (mock PowerShell)
2. **Integration Tests** - Real PowerShell, mock API  
3. **E2E Tests** - Full stack with test credentials
4. **Smoke Tests** - Critical path validation

### Test Categories

#### Priority 1 - Critical Path (Run Always)
- `deploy` - Deployment initiation
- `status` - Environment status
- `export_database` - Database backups
- `test_connection` - Setup validation
- PowerShell command generation

#### Priority 2 - Core Operations (Run on PR)
- `start_deployment` - Deployment operations
- `get_deployment_status` - Status monitoring
- `complete_deployment` - Deployment completion
- `reset_deployment` - Rollback operations
- `download_blobs` - Media downloads
- Multi-project configuration

#### Priority 3 - Extended Features (Nightly)
- NLP parsing
- Log analysis
- Permission checking
- Rate limiting
- Telemetry

## 🏃 Running Tests

### Quick Regression (5 min)
```bash
npm run test:regression:quick
```

### Full Regression (15 min)
```bash
npm run test:regression:full
```

### Platform-Specific
```bash
npm run test:regression:windows
npm run test:regression:macos
npm run test:regression:linux
```

### With Real API (requires credentials)
```bash
npm run test:regression:integration
```

## 📍 Test Environments

### Mock Mode (Default)
- Uses pre-recorded PowerShell responses
- No external dependencies
- Runs in CI/CD

### Integration Mode
- Real PowerShell commands
- Mock API responses
- Tests command generation

### E2E Mode
- Real PowerShell + Real API
- Requires test project credentials
- Manual trigger only

## 🔄 CI/CD Integration

### GitHub Actions Matrix
- **OS**: Ubuntu, Windows, macOS
- **Node**: 18.x, 20.x, 22.x
- **Triggers**: PR, push to main, nightly
- **Environments**: Mock (always), Integration (nightly)

## 📊 Coverage Goals
- Unit: 80%
- Integration: 60%
- E2E: Critical paths only
- Overall: 70%+