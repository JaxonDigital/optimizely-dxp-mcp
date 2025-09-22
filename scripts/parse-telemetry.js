#!/usr/bin/env node

/**
 * Telemetry Log Parser for Jaxon Digital MCP
 * Parses and aggregates telemetry data from server log files
 * 
 * Usage:
 * node parse-telemetry.js <log-directory>
 * node parse-telemetry.js /path/to/App_Data/Telemetry
 */

const fs = require('fs');
const path = require('path');

class TelemetryParser {
    constructor() {
        this.sessions = new Map();
        this.tools = new Map();
        this.errors = new Map();
        this.deployments = new Map();
        this.performance = new Map();
        this.platforms = new Map();
        this.versions = new Map();
        this.dailyStats = new Map();
        this.environments = new Set();
    }

    /**
     * Parse all telemetry files in a directory
     */
    async parseDirectory(dirPath) {
        console.log(`\n📂 Parsing telemetry directory: ${dirPath}\n`);
        
        if (!fs.existsSync(dirPath)) {
            console.error(`❌ Directory not found: ${dirPath}`);
            process.exit(1);
        }

        // Get all JSON files
        const files = fs.readdirSync(dirPath)
            .filter(f => f.startsWith('mcp-telemetry-') && f.endsWith('.json'))
            .sort();

        if (files.length === 0) {
            console.log('⚠️  No telemetry files found');
            return;
        }

        console.log(`Found ${files.length} telemetry files\n`);

        // Parse each file
        for (const file of files) {
            await this.parseFile(path.join(dirPath, file));
        }

        // Generate report
        this.generateReport();
    }

    /**
     * Parse a single telemetry log file
     */
    async parseFile(filePath) {
        const fileName = path.basename(filePath);
        console.log(`  📄 Processing: ${fileName}`);
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            
            // Split by separator (---) to get individual entries
            const entries = content.split('---\n').filter(e => e.trim());
            
            for (const entry of entries) {
                try {
                    const data = JSON.parse(entry.trim());
                    this.processEntry(data);
                } catch (e) {
                    // Skip malformed entries
                    continue;
                }
            }
        } catch (error) {
            console.error(`    ⚠️  Error reading ${fileName}: ${error.message}`);
        }
    }

    /**
     * Process a single telemetry entry
     */
    processEntry(entry) {
        // Track session
        if (entry.SessionId) {
            if (!this.sessions.has(entry.SessionId)) {
                this.sessions.set(entry.SessionId, {
                    id: entry.SessionId,
                    version: entry.Version,
                    platform: entry.Platform,
                    firstSeen: entry.Timestamp,
                    lastSeen: entry.Timestamp,
                    eventCount: 0,
                    tools: new Set(),
                    errors: 0
                });
            }
            
            const session = this.sessions.get(entry.SessionId);
            session.lastSeen = entry.Timestamp;
            session.eventCount += entry.EventCount || 0;
            
            // Track platform
            if (entry.Platform) {
                this.platforms.set(entry.Platform, (this.platforms.get(entry.Platform) || 0) + 1);
            }
            
            // Track version
            if (entry.Version) {
                this.versions.set(entry.Version, (this.versions.get(entry.Version) || 0) + 1);
            }
        }

        // Track daily stats
        if (entry.Timestamp) {
            const date = entry.Timestamp.split('T')[0];
            if (!this.dailyStats.has(date)) {
                this.dailyStats.set(date, {
                    sessions: new Set(),
                    events: 0,
                    tools: new Map(),
                    errors: 0
                });
            }
            const daily = this.dailyStats.get(date);
            if (entry.SessionId) daily.sessions.add(entry.SessionId);
            daily.events += entry.EventCount || 0;
        }

        // Process events
        if (entry.Events && Array.isArray(entry.Events)) {
            for (const event of entry.Events) {
                this.processEvent(event, entry.SessionId);
            }
        }
    }

    /**
     * Process individual events
     */
    processEvent(event, sessionId) {
        const session = this.sessions.get(sessionId);
        
        // Tool usage events
        if (event.type === 'tool_usage' || event.tool) {
            const toolName = event.tool || event.Event;
            
            if (!this.tools.has(toolName)) {
                this.tools.set(toolName, {
                    name: toolName,
                    count: 0,
                    sessions: new Set(),
                    environments: new Set(),
                    errors: 0,
                    firstUsed: event.timestamp,
                    lastUsed: event.timestamp
                });
            }
            
            const tool = this.tools.get(toolName);
            tool.count++;
            tool.sessions.add(sessionId);
            tool.lastUsed = event.timestamp;
            
            if (event.environment) {
                tool.environments.add(event.environment);
                this.environments.add(event.environment);
            }
            
            if (session) {
                session.tools.add(toolName);
            }
        }
        
        // Error events
        if (event.type === 'error' || event.error) {
            const errorCategory = event.error?.category || 'unknown';
            this.errors.set(errorCategory, (this.errors.get(errorCategory) || 0) + 1);
            
            if (session) {
                session.errors++;
            }
            
            // Track error by tool
            if (event.context?.tool) {
                const tool = this.tools.get(event.context.tool);
                if (tool) tool.errors++;
            }
        }
        
        // Deployment events
        if (event.type === 'deployment' || event.deployment) {
            const path = event.deployment?.path || 'unknown';
            
            if (!this.deployments.has(path)) {
                this.deployments.set(path, {
                    path: path,
                    count: 0,
                    directDeploy: 0,
                    withMaintenance: 0,
                    codeOnly: 0,
                    contentOnly: 0,
                    both: 0
                });
            }
            
            const deployment = this.deployments.get(path);
            deployment.count++;
            
            if (event.deployment?.directDeploy) deployment.directDeploy++;
            if (event.deployment?.useMaintenancePage) deployment.withMaintenance++;
            if (event.deployment?.hasCode && !event.deployment?.hasContent) deployment.codeOnly++;
            if (!event.deployment?.hasCode && event.deployment?.hasContent) deployment.contentOnly++;
            if (event.deployment?.hasCode && event.deployment?.hasContent) deployment.both++;
        }
        
        // Performance events
        if (event.type === 'performance' || event.duration) {
            const operation = event.operation || 'unknown';
            
            if (!this.performance.has(operation)) {
                this.performance.set(operation, {
                    operation: operation,
                    count: 0,
                    totalDuration: 0,
                    avgDuration: 0,
                    minDuration: event.duration || 0,
                    maxDuration: event.duration || 0
                });
            }
            
            const perf = this.performance.get(operation);
            perf.count++;
            perf.totalDuration += event.duration || 0;
            perf.avgDuration = perf.totalDuration / perf.count;
            perf.minDuration = Math.min(perf.minDuration, event.duration || 0);
            perf.maxDuration = Math.max(perf.maxDuration, event.duration || 0);
        }
    }

    /**
     * Generate and display the analytics report
     */
    generateReport() {
        console.log('\n' + '='.repeat(60));
        console.log('📊 TELEMETRY ANALYTICS REPORT');
        console.log('='.repeat(60));

        // Overall stats
        console.log('\n📈 OVERALL STATISTICS');
        console.log('─'.repeat(40));
        console.log(`Total Sessions: ${this.sessions.size}`);
        console.log(`Total Tools Used: ${this.tools.size}`);
        console.log(`Total Errors: ${Array.from(this.errors.values()).reduce((a, b) => a + b, 0)}`);
        console.log(`Date Range: ${Array.from(this.dailyStats.keys()).sort()[0]} to ${Array.from(this.dailyStats.keys()).sort().pop()}`);

        // Platform distribution
        if (this.platforms.size > 0) {
            console.log('\n💻 PLATFORM DISTRIBUTION');
            console.log('─'.repeat(40));
            const sortedPlatforms = Array.from(this.platforms.entries())
                .sort((a, b) => b[1] - a[1]);
            for (const [platform, count] of sortedPlatforms) {
                const percentage = ((count / this.sessions.size) * 100).toFixed(1);
                console.log(`${platform.padEnd(15)} ${count.toString().padStart(5)} sessions (${percentage}%)`);
            }
        }

        // Version distribution
        if (this.versions.size > 0) {
            console.log('\n📦 VERSION DISTRIBUTION');
            console.log('─'.repeat(40));
            const sortedVersions = Array.from(this.versions.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5);
            for (const [version, count] of sortedVersions) {
                const percentage = ((count / this.sessions.size) * 100).toFixed(1);
                console.log(`v${version.padEnd(14)} ${count.toString().padStart(5)} sessions (${percentage}%)`);
            }
        }

        // Top tools
        if (this.tools.size > 0) {
            console.log('\n🔧 TOP TOOLS BY USAGE');
            console.log('─'.repeat(40));
            const sortedTools = Array.from(this.tools.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            
            for (const tool of sortedTools) {
                const errorRate = tool.errors > 0 ? ` (${tool.errors} errors)` : '';
                console.log(`${tool.name.padEnd(30)} ${tool.count.toString().padStart(6)} uses by ${tool.sessions.size} sessions${errorRate}`);
                if (tool.environments.size > 0) {
                    console.log(`  Environments: ${Array.from(tool.environments).join(', ')}`);
                }
            }
        }

        // Deployment patterns
        if (this.deployments.size > 0) {
            console.log('\n🚀 DEPLOYMENT PATTERNS');
            console.log('─'.repeat(40));
            const sortedDeployments = Array.from(this.deployments.values())
                .sort((a, b) => b.count - a.count);
            
            for (const dep of sortedDeployments) {
                console.log(`${dep.path.padEnd(25)} ${dep.count.toString().padStart(5)} deployments`);
                const details = [];
                if (dep.directDeploy > 0) details.push(`${dep.directDeploy} direct`);
                if (dep.codeOnly > 0) details.push(`${dep.codeOnly} code-only`);
                if (dep.contentOnly > 0) details.push(`${dep.contentOnly} content-only`);
                if (dep.both > 0) details.push(`${dep.both} code+content`);
                if (details.length > 0) {
                    console.log(`  Details: ${details.join(', ')}`);
                }
            }
        }

        // Error distribution
        if (this.errors.size > 0) {
            console.log('\n❌ ERROR DISTRIBUTION');
            console.log('─'.repeat(40));
            const sortedErrors = Array.from(this.errors.entries())
                .sort((a, b) => b[1] - a[1]);
            
            for (const [category, count] of sortedErrors) {
                console.log(`${category.padEnd(20)} ${count.toString().padStart(5)} occurrences`);
            }
        }

        // Performance metrics
        if (this.performance.size > 0) {
            console.log('\n⚡ PERFORMANCE METRICS');
            console.log('─'.repeat(40));
            const sortedPerf = Array.from(this.performance.values())
                .sort((a, b) => b.count - a.count)
                .slice(0, 10);
            
            for (const perf of sortedPerf) {
                console.log(`${perf.operation.padEnd(25)} Avg: ${Math.round(perf.avgDuration)}ms (${perf.count} operations)`);
                console.log(`  Range: ${Math.round(perf.minDuration)}ms - ${Math.round(perf.maxDuration)}ms`);
            }
        }

        // Daily activity
        if (this.dailyStats.size > 0) {
            console.log('\n📅 DAILY ACTIVITY (Last 7 Days)');
            console.log('─'.repeat(40));
            const sortedDays = Array.from(this.dailyStats.entries())
                .sort((a, b) => b[0].localeCompare(a[0]))
                .slice(0, 7);
            
            for (const [date, stats] of sortedDays) {
                console.log(`${date}  ${stats.sessions.size.toString().padStart(3)} sessions, ${stats.events.toString().padStart(5)} events`);
            }
        }

        // Environment usage
        if (this.environments.size > 0) {
            console.log('\n🌍 ENVIRONMENTS USED');
            console.log('─'.repeat(40));
            for (const env of Array.from(this.environments).sort()) {
                console.log(`  • ${env}`);
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📧 Report generated at:', new Date().toISOString());
        console.log('='.repeat(60) + '\n');
    }
}

// Main execution
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
📊 Jaxon Digital MCP Telemetry Parser

Usage:
  node parse-telemetry.js <log-directory>

Examples:
  node parse-telemetry.js /path/to/App_Data/Telemetry
  node parse-telemetry.js ./telemetry-logs

The script will parse all mcp-telemetry-*.json files in the directory
and generate an analytics report.
        `);
        process.exit(0);
    }

    const parser = new TelemetryParser();
    await parser.parseDirectory(args[0]);
}

// Run if executed directly
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
    });
}

module.exports = { TelemetryParser };