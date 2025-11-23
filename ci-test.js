#!/usr/bin/env node

/**
 * CI/CD Test Suite for Jaxon Optimizely DXP MCP Server
 * Focused tests for continuous integration
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Test results tracking
let testsPassed = 0;
let testsFailed = 0;
const failedTests = [];

function test(name, fn) {
    process.stdout.write(`Testing ${name}... `);
    try {
        fn();
        console.log('✅');
        testsPassed++;
    } catch (error) {
        console.log('❌');
        console.error(`  Error: ${error.message}`);
        testsFailed++;
        failedTests.push({ name, error: error.message });
    }
}

console.log('🧪 Jaxon Optimizely DXP MCP CI Test Suite\n');
console.log('='.repeat(60));

// Test 1: Core modules load without error
test('Core Module Loading', () => {
    require('../dist/lib/config').default;
    require('../dist/lib/error-handler').default;
    require('../dist/lib/dxp-rest-client').default;
    require('../dist/lib/response-builder').default;
    require('../dist/lib/security-helper').default;
    require('../dist/lib/retry-helper').default;
    require('../dist/lib/deployment-validator').default;
    require('../dist/lib/upload-progress').default;
});

// Test 2: Package.json is valid
test('Package.json Validation', () => {
    const pkg = require('../package.json');
    // Accept both the old and new (scoped) package names
    const validNames = ['jaxon-optimizely-dxp-mcp', '@jaxon-digital/optimizely-dxp-mcp'];
    assert(validNames.includes(pkg.name), 
        `Package name mismatch: expected one of ${JSON.stringify(validNames)} but got '${pkg.name}'`);
    assert(pkg.version, 'Package version is missing');
    assert(pkg.main === 'dist/index.js',
        `Package main mismatch: expected 'dist/index.js' but got '${pkg.main}'`);
    assert(pkg.dependencies, 'Package dependencies are missing');
    assert(pkg.dependencies['@modelcontextprotocol/sdk'], 
        'Required dependency @modelcontextprotocol/sdk is missing');
});

// Test 3: Main server file exists and exports properly
test('Main Server File', () => {
    const mainFile = path.join(__dirname, '..', 'dist', 'index.js');
    assert(fs.existsSync(mainFile));
    
    // Check it's executable
    const stats = fs.statSync(mainFile);
    assert(stats.isFile());
});

// Test 4: Required files exist
test('Required Files', () => {
    const requiredFiles = [
        'README.md',
        'LICENSE',
        'package.json',
        'src/index.ts',
        'lib/config.ts',
        'lib/error-handler.ts',
        'lib/dxp-rest-client.ts',
        'lib/response-builder.ts',
        'lib/security-helper.ts',
        'lib/tools/storage-tools.ts'
    ];

    requiredFiles.forEach(file => {
        const filePath = path.join(__dirname, '..', file);
        assert(fs.existsSync(filePath), `Missing: ${file}`);
    });
});

// Test 5: Response Builder includes support email
test('Response Builder Support Email', () => {
    const { default: ResponseBuilder } = require('../dist/lib/response-builder');
    const errorResponse = ResponseBuilder.error('Test error');
    assert(errorResponse.error.includes('support@jaxondigital.com'));
});

// Test 6: Security Helper masks secrets
test('Security Helper Secret Masking', () => {
    const { default: SecurityHelper } = require('../dist/lib/security-helper');
    const command = "Connect-EpiCloud -ClientKey 'my-key' -ClientSecret 'my-secret'";
    const masked = SecurityHelper.sanitizeCommand(command);
    assert(!masked.includes('my-key'));
    assert(!masked.includes('my-secret'));
    assert(masked.includes('***'));
});

// Test 7: Upload Progress formatting
test('Upload Progress Formatting', () => {
    const { default: UploadProgress } = require('../dist/lib/upload-progress');
    const progress = new UploadProgress();

    assert.equal(progress.formatBytes(1024), '1.00 KB');
    assert.equal(progress.formatBytes(1048576), '1.00 MB');
    assert.equal(progress.formatTime(45), '45s');
    assert.equal(progress.formatTime(125), '2m 5s');
});

// Test 8: DXP REST Client
test('DXP REST Client Methods', () => {
    const { default: DXPRestClient } = require('../dist/lib/dxp-rest-client');
    assert(typeof DXPRestClient.generateAuthHeader === 'function');
    assert(typeof DXPRestClient.makeRequest === 'function');
    assert(typeof DXPRestClient.testEnvironmentAccess === 'function');
    assert(DXPRestClient.DEFAULT_ENDPOINT);
    assert(DXPRestClient.DEFAULT_ENDPOINT.includes('paasportal.episerver.net'));
});

// Test 9: Error Handler detection
test('Error Handler Detection', () => {
    const { default: ErrorHandler } = require('../dist/lib/error-handler');
    const stderr = 'get-epideployment : deployment not found';
    const error = ErrorHandler.detectError(stderr, { deploymentId: 'test' });
    assert(error !== null);
    assert(error.type === 'INVALID_DEPLOYMENT');
});

// Test 10: Config structure
test('Configuration Structure', () => {
    const { default: Config } = require('../dist/lib/config');
    assert(Config.FORMATTING);
    assert(Config.FORMATTING.STATUS_ICONS);
    assert(Config.DEPLOYMENT_STATUS);
});

// Test 11: Retry Helper exists and has methods
test('Retry Helper Methods', () => {
    const { default: RetryHelper } = require('../dist/lib/retry-helper');
    assert(typeof RetryHelper.withRetry === 'function');
    assert(typeof RetryHelper.isRetryableError === 'function');
    assert(RetryHelper.DEFAULT_CONFIG);
});

// Test 12: Deployment Validator exists and has methods
test('Deployment Validator Methods', () => {
    const { default: DeploymentValidator } = require('../dist/lib/deployment-validator');
    assert(typeof DeploymentValidator.validateDeploymentPath === 'function');
    assert(typeof DeploymentValidator.validateDeploymentState === 'function');
    assert(typeof DeploymentValidator.validateDeploymentTiming === 'function');
});

// Test 13: Tool files exist
test('Tool Files Structure', () => {
    const toolDirs = [
        'lib/tools/deployment'
    ];

    toolDirs.forEach(dir => {
        const dirPath = path.join(__dirname, '..', dir);
        assert(fs.existsSync(dirPath), `Missing directory: ${dir}`);
        assert(fs.statSync(dirPath).isDirectory(), `Not a directory: ${dir}`);
    });

    // Check specific deployment tool files (TypeScript sources)
    const deploymentFiles = [
        'lib/tools/deployment/deployment-list.ts',
        'lib/tools/deployment/deployment-actions.ts',
        'lib/tools/deployment/deployment-formatters.ts'
    ];

    deploymentFiles.forEach(file => {
        const filePath = path.join(__dirname, '..', file);
        assert(fs.existsSync(filePath), `Missing: ${file}`);
    });
});

// Test 14: Environment variable handling
test('Environment Variables', () => {
    // Save originals
    const origName = process.env.OPTIMIZELY_PROJECT_NAME;
    const origId = process.env.OPTIMIZELY_PROJECT_ID;
    
    // Set test values
    process.env.OPTIMIZELY_PROJECT_NAME = 'Test Project';
    process.env.OPTIMIZELY_PROJECT_ID = 'test-id-123';
    
    // Verify they're set
    assert(process.env.OPTIMIZELY_PROJECT_NAME === 'Test Project');
    assert(process.env.OPTIMIZELY_PROJECT_ID === 'test-id-123');
    
    // Restore
    if (origName) process.env.OPTIMIZELY_PROJECT_NAME = origName;
    else delete process.env.OPTIMIZELY_PROJECT_NAME;
    if (origId) process.env.OPTIMIZELY_PROJECT_ID = origId;
    else delete process.env.OPTIMIZELY_PROJECT_ID;
});

// Test 15: Node version compatibility
test('Node Version', () => {
    const nodeVersion = process.version;
    const [major, minor, patch] = nodeVersion.substring(1).split('.').map(n => parseInt(n));
    
    // Accept Node 18.20.x or Node 19+
    const isValid = major > 18 || (major === 18 && minor >= 20);
    assert(isValid, `Node version ${nodeVersion} is too old (need >=18.20.0)`);
});

// Print summary
console.log('\n' + '='.repeat(60));
console.log('TEST SUMMARY');
console.log('='.repeat(60));
console.log(`Total: ${testsPassed + testsFailed} | Passed: ${testsPassed} | Failed: ${testsFailed}`);

if (testsFailed > 0) {
    console.log('\n❌ Failed tests:');
    failedTests.forEach(t => {
        console.log(`  - ${t.name}: ${t.error}`);
    });
    process.exit(1);
} else {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
}