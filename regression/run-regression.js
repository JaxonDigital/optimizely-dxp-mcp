#!/usr/bin/env node

/**
 * Main Regression Test Runner
 * Orchestrates all regression test suites
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

class RegressionRunner {
    constructor(options = {}) {
        this.mode = options.mode || 'quick'; // quick, full, integration
        this.platform = options.platform || process.platform;
        this.verbose = options.verbose || false;
        this.testPattern = options.testPattern || null;
        this.results = [];
        this.startTime = Date.now();
    }

    /**
     * Run regression tests based on mode
     */
    async run() {
        console.log('🚀 DXP MCP Regression Test Suite');
        console.log('═'.repeat(60));
        console.log(`Mode: ${this.mode.toUpperCase()}`);
        console.log(`Platform: ${this.platform}`);
        console.log(`Node: ${process.version}`);
        console.log('═'.repeat(60));

        const testSuites = this.getTestSuites();
        
        for (const suite of testSuites) {
            await this.runTestSuite(suite);
        }

        this.printResults();
        return this.results.every(r => r.exitCode === 0);
    }

    /**
     * Get test suites based on mode
     */
    getTestSuites() {
        const suites = [];
        
        switch (this.mode) {
            case 'quick':
                // Priority 1 tests only (5 min)
                suites.push({
                    name: 'Priority 1 - Critical Path',
                    file: 'test-priority-1-tools.js',
                    timeout: 300000 // 5 min
                });
                break;

            case 'full':
                // All priority tests (15 min)
                suites.push({
                    name: 'Priority 1 - Critical Path',
                    file: 'test-priority-1-tools.js',
                    timeout: 300000
                });
                suites.push({
                    name: 'Priority 2 - Core Operations',
                    file: 'test-priority-2-tools.js',
                    timeout: 300000
                });
                suites.push({
                    name: 'Priority 3 - Extended Features',
                    file: 'test-priority-3-tools.js',
                    timeout: 300000
                });
                break;

            case 'integration':
                // Integration tests with real PowerShell
                suites.push({
                    name: 'Integration - PowerShell Commands',
                    file: 'test-integration-powershell.js',
                    timeout: 600000,
                    env: { USE_REAL_POWERSHELL: 'true' }
                });
                suites.push({
                    name: 'Integration - Multi-Project',
                    file: 'test-integration-multiproject.js',
                    timeout: 300000
                });
                break;

            case 'platform':
                // Platform-specific tests
                suites.push({
                    name: `Platform - ${this.platform}`,
                    file: `test-platform-${this.platform}.js`,
                    timeout: 300000
                });
                break;

            default:
                // Custom pattern matching
                if (this.testPattern) {
                    const files = fs.readdirSync(__dirname)
                        .filter(f => f.startsWith('test-') && f.endsWith('.js'))
                        .filter(f => f.includes(this.testPattern));
                    
                    files.forEach(file => {
                        suites.push({
                            name: file.replace('.js', ''),
                            file: file,
                            timeout: 300000
                        });
                    });
                }
        }

        // Filter out non-existent test files
        return suites.filter(suite => {
            const filePath = path.join(__dirname, suite.file);
            if (!fs.existsSync(filePath)) {
                console.log(`⚠️  Skipping ${suite.name} (file not found: ${suite.file})`);
                return false;
            }
            return true;
        });
    }

    /**
     * Run a single test suite
     */
    async runTestSuite(suite) {
        console.log(`\n▶️  Running ${suite.name}...`);
        const startTime = Date.now();

        return new Promise((resolve) => {
            const testPath = path.join(__dirname, suite.file);
            const env = { ...process.env, ...suite.env };
            
            const child = spawn('node', [testPath], {
                env,
                stdio: this.verbose ? 'inherit' : 'pipe'
            });

            let output = '';
            let errorOutput = '';
            
            if (!this.verbose) {
                child.stdout.on('data', (data) => {
                    output += data.toString();
                    // Show progress indicators
                    if (data.toString().includes('✅')) process.stdout.write('.');
                    if (data.toString().includes('❌')) process.stdout.write('F');
                });
                
                child.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
            }

            // Set timeout
            const timeout = setTimeout(() => {
                console.log(`\n⏱️  Timeout for ${suite.name}`);
                child.kill('SIGTERM');
            }, suite.timeout);

            child.on('close', (code) => {
                clearTimeout(timeout);
                const duration = Date.now() - startTime;
                
                if (!this.verbose && (code !== 0 || this.verbose)) {
                    console.log('\n' + output);
                    if (errorOutput) console.error(errorOutput);
                }

                this.results.push({
                    suite: suite.name,
                    exitCode: code,
                    duration,
                    output,
                    errorOutput
                });

                console.log(`\n${code === 0 ? '✅' : '❌'} ${suite.name} completed in ${duration}ms`);
                resolve();
            });
        });
    }

    /**
     * Print overall results
     */
    printResults() {
        const totalDuration = Date.now() - this.startTime;
        const passed = this.results.filter(r => r.exitCode === 0).length;
        const failed = this.results.filter(r => r.exitCode !== 0).length;

        console.log('\n' + '═'.repeat(60));
        console.log('📊 Regression Test Results');
        console.log('═'.repeat(60));
        console.log(`Total Suites: ${this.results.length}`);
        console.log(`  ✅ Passed: ${passed}`);
        console.log(`  ❌ Failed: ${failed}`);
        console.log(`Total Duration: ${totalDuration}ms (${Math.round(totalDuration / 1000)}s)`);

        if (failed > 0) {
            console.log('\n❌ Failed Suites:');
            this.results.filter(r => r.exitCode !== 0).forEach(result => {
                console.log(`  - ${result.suite} (exit code: ${result.exitCode})`);
            });
        }

        // Generate report file
        this.generateReport();
    }

    /**
     * Generate test report
     */
    generateReport() {
        const reportDir = path.join(__dirname, 'reports');
        if (!fs.existsSync(reportDir)) {
            fs.mkdirSync(reportDir);
        }

        const report = {
            timestamp: new Date().toISOString(),
            mode: this.mode,
            platform: this.platform,
            nodeVersion: process.version,
            totalDuration: Date.now() - this.startTime,
            results: this.results,
            summary: {
                total: this.results.length,
                passed: this.results.filter(r => r.exitCode === 0).length,
                failed: this.results.filter(r => r.exitCode !== 0).length
            }
        };

        const reportPath = path.join(reportDir, `regression-${Date.now()}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n📄 Report saved to: ${reportPath}`);
    }
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--mode':
            case '-m':
                options.mode = args[++i];
                break;
            case '--platform':
            case '-p':
                options.platform = args[++i];
                break;
            case '--verbose':
            case '-v':
                options.verbose = true;
                break;
            case '--pattern':
                options.testPattern = args[++i];
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
        }
    }

    return options;
}

function printHelp() {
    console.log(`
DXP MCP Regression Test Runner

Usage: node run-regression.js [options]

Options:
  -m, --mode <mode>      Test mode: quick, full, integration, platform
  -p, --platform <os>    Platform: darwin, win32, linux
  -v, --verbose          Verbose output
  --pattern <pattern>    Run tests matching pattern
  -h, --help            Show this help

Examples:
  node run-regression.js                    # Quick regression
  node run-regression.js -m full           # Full regression
  node run-regression.js -m integration    # Integration tests
  node run-regression.js --pattern deploy  # Run deploy tests
`);
}

// Main execution
async function main() {
    const options = parseArgs();
    const runner = new RegressionRunner(options);
    
    try {
        const success = await runner.run();
        process.exit(success ? 0 : 1);
    } catch (error) {
        console.error('Regression runner failed:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = RegressionRunner;