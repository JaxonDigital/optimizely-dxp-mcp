# DXP MCP Testing Guide

## 🎯 Testing Philosophy

Our testing strategy follows these principles:
1. **Prevent Regressions** - Never break working functionality
2. **Fast Feedback** - Quick tests run on every PR
3. **Platform Coverage** - Test across Windows, macOS, Linux
4. **Mock First** - Use mocks for speed, real APIs for validation
5. **Progressive Testing** - Quick → Full → Integration

## 📚 Test Categories

### 1. CI Tests (2 min)
**When**: Every commit
**What**: Basic module loading, package validation
**Command**: `npm test`

### 2. Quick Regression (5 min)
**When**: Every PR
**What**: Critical path tools (deploy, status, export_database)
**Command**: `npm run test:regression:quick`

### 3. Full Regression (15 min)
**When**: Push to main, nightly
**What**: All tools, extended features
**Command**: `npm run test:regression:full`

### 4. Integration Tests (30 min)
**When**: Nightly, manual trigger
**What**: Real PowerShell, mock API
**Command**: `npm run test:regression:integration`

## 🏃 Running Tests Locally

### Prerequisites
```bash
# Install PowerShell (if testing PowerShell generation)
# macOS
brew install --cask powershell

# Ubuntu/Debian
sudo apt-get install -y powershell

# Windows (pre-installed or)
winget install Microsoft.PowerShell
```

### Quick Start
```bash
# Run basic CI tests
npm test

# Run quick regression
npm run test:regression:quick

# Run full regression
npm run test:regression:full

# Run specific test pattern
node tests/regression/run-regression.js --pattern deploy

# Run with verbose output
node tests/regression/run-regression.js -v

# Run platform-specific tests
npm run test:regression:macos
npm run test:regression:windows
npm run test:regression:linux
```

## 🔬 Writing Tests

### Test Structure
```javascript
// tests/regression/test-new-feature.js
const TestFramework = require('./test-framework');

async function runTests() {
    const framework = new TestFramework();
    
    await framework.setup({
        useMockPowerShell: true,
        credentials: {
            projectId: 'test-id',
            apiKey: 'test-key',
            apiSecret: 'test-secret'
        }
    });

    await framework.runSuite('My Feature', async (t) => {
        await t.test('should do something', async () => {
            // Your test code
            const result = await someFunction();
            t.assert(result === expected, 'Result should match');
        });
    });

    await framework.teardown();
    const success = framework.printOverallResults();
    process.exit(success ? 0 : 1);
}

runTests();
```

### Mock PowerShell Responses
```javascript
// Add custom response for specific command
t.addPowerShellResponse(/Get-EpiDeployment -Id 'test'/, {
    output: JSON.stringify({
        Id: 'test',
        Status: 'Succeeded'
    })
});

// Simulate error
t.setPowerShellError(true);

// Assert command was called
t.assertPowerShellCalled(/Start-EpiDeployment/, 1);
```

## 🤖 CI/CD Integration

### GitHub Actions Matrix
- **Operating Systems**: Ubuntu, Windows, macOS
- **Node Versions**: 18.x, 20.x, 22.x
- **Total Jobs**: 9 per test type

### Workflow Triggers
1. **Pull Request**: Quick regression only
2. **Push to Main**: Full regression
3. **Nightly (2 AM UTC)**: Full + Integration
4. **Manual Dispatch**: Choose test mode

### Adding Test Credentials (Optional)
For integration tests with real API:
```yaml
# In GitHub repo settings → Secrets
OPTIMIZELY_TEST_PROJECT_ID=xxx
OPTIMIZELY_TEST_API_KEY=yyy
OPTIMIZELY_TEST_API_SECRET=zzz
```

## 📊 Test Reports

### Location
- Local: `tests/regression/reports/`
- CI: GitHub Actions artifacts

### Report Format
```json
{
  "timestamp": "2025-08-30T...",
  "mode": "quick",
  "platform": "darwin",
  "results": [{
    "suite": "Deploy Tool",
    "exitCode": 0,
    "duration": 1234
  }],
  "summary": {
    "total": 5,
    "passed": 5,
    "failed": 0
  }
}
```

## 🚨 Common Issues & Solutions

### PowerShell Not Found
**Problem**: Tests fail with "PowerShell not found"
**Solution**: Install PowerShell or use mock mode
```javascript
await framework.setup({
    useMockPowerShell: true  // Force mock mode
});
```

### Timeout Issues
**Problem**: Tests timeout in CI
**Solution**: Increase timeout or optimize test
```javascript
await t.test('slow test', async () => {
    // test code
}, { timeout: 10000 }); // 10 second timeout
```

### Module Cache Issues
**Problem**: Changes not reflected in tests
**Solution**: Clear module cache
```javascript
framework.clearModuleCache();
```

### Platform-Specific Failures
**Problem**: Tests pass locally but fail in CI
**Solution**: Check platform-specific code
```javascript
if (process.platform === 'win32') {
    // Windows-specific test
}
```

## 📈 Coverage Goals

### Current Coverage
- Unit Tests: ~60%
- Integration Tests: ~40%
- E2E Tests: Critical paths only

### Target Coverage
- Unit Tests: 80%
- Integration Tests: 60%
- E2E Tests: Critical paths
- Overall: 70%+

## 🔄 Test Maintenance

### Weekly
- Review failed nightly tests
- Update mock responses for API changes

### Monthly
- Review test execution times
- Remove obsolete tests
- Update test documentation

### Per Release
- Run full integration suite
- Update regression baselines
- Verify all platforms

## 📝 Test Checklist for PRs

Before merging any PR:
- [ ] CI tests pass (automatic)
- [ ] Quick regression passes (automatic)
- [ ] New features have tests
- [ ] Breaking changes documented
- [ ] Test documentation updated

## 🆘 Getting Help

### Test Failures
1. Check test output for specific error
2. Run test locally with verbose mode
3. Check recent changes to affected code
4. Ask in #dev-support channel

### Writing New Tests
1. Copy existing test as template
2. Follow naming convention: `test-{category}-{feature}.js`
3. Add to appropriate test suite
4. Update this documentation

### Contact
- **Slack**: #dxp-mcp-dev
- **Email**: support@jaxondigital.com
- **GitHub Issues**: Report test infrastructure issues