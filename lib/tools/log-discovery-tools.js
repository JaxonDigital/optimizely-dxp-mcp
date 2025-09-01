/**
 * Log Discovery Tools
 * Enhanced tools for discovering and accessing log containers across all environments
 * Especially important for Production where container names may vary
 */

const PowerShellHelper = require('../powershell-helper');
const PowerShellCommandBuilder = require('../powershell-command-builder');
const ResponseBuilder = require('../response-builder');
const OutputLogger = require('../output-logger');
const ProjectTools = require('./project-tools');
const StorageTools = require('./storage-tools');

class LogDiscoveryTools {
    
    // Known log container patterns
    static LOG_CONTAINER_PATTERNS = [
        // Standard DXP containers
        { pattern: /^appservicelogs$/, type: 'application', description: 'Application logs' },
        { pattern: /^webservicelogs$/, type: 'web', description: 'Web server logs' },
        { pattern: /^cloudflarelogpush$/, type: 'cloudflare', description: 'Cloudflare logs (beta)' },
        
        // App Service Insights containers
        { pattern: /^insights-logs-appserviceconsolelogs$/, type: 'application', description: 'App Service console logs' },
        { pattern: /^insights-logs-appservicehttplogs$/, type: 'web', description: 'App Service HTTP logs' },
        { pattern: /^insights-logs-/, type: 'insights', description: 'Application Insights logs' },
        
        // Alternative Azure containers (commonly found in Production)
        { pattern: /^azure-application-logs$/, type: 'application', description: 'Azure application logs' },
        { pattern: /^azure-web-logs$/, type: 'web', description: 'Azure web server logs' },
        { pattern: /^azure-logs-/, type: 'azure', description: 'Azure logs' },
        
        // Application Insights containers
        { pattern: /applicationinsights/, type: 'appinsights', description: 'Application Insights data' },
        { pattern: /appinsights/, type: 'appinsights', description: 'Application Insights data' },
        
        // Enhanced generic log patterns
        { pattern: /logs?$/, type: 'generic', description: 'Generic log container' },
        { pattern: /log-/, type: 'generic', description: 'Generic log container' },
        { pattern: /-logs?$/, type: 'generic', description: 'Log container (suffix)' },
        { pattern: /diagnostic.*logs?/i, type: 'diagnostic', description: 'Diagnostic logs' },
        { pattern: /inte-.*logs?/i, type: 'integration', description: 'Integration environment logs' },
        { pattern: /backup.*logs?/i, type: 'backup', description: 'Backup logs' },
        { pattern: /^db-backups?-/i, type: 'database', description: 'Database backup container' }
    ];
    
    /**
     * Discover all log containers across environments
     */
    static async discoverLogContainers(args) {
        try {
            OutputLogger.info('🔍 Discovering log containers across all environments...\n');
            
            // Resolve project configuration
            const resolved = ProjectTools.resolveCredentials(args);
            if (!resolved.success || !resolved.credentials) {
                return ResponseBuilder.invalidParams('Missing required project configuration');
            }
            
            const projectConfig = resolved.credentials;
            const projectName = resolved.project ? resolved.project.name : 'Unknown';
            
            OutputLogger.info(`📋 Project: ${projectName}`);
            OutputLogger.info(`🔑 Using API key: ${projectConfig.apiKey?.substring(0, 8)}...`);
            
            // Test each environment
            const environments = ['Production', 'Preproduction', 'Integration'];
            const discoveryResults = {};
            
            for (const env of environments) {
                OutputLogger.info(`\n🌍 Checking ${env} environment...`);
                
                try {
                    const envArgs = {
                        ...projectConfig,
                        environment: env
                    };
                    
                    // Get all containers for this environment
                    const containersResult = await StorageTools.handleListStorageContainers(envArgs);
                    const containers = this.extractContainerList(containersResult);
                    
                    if (!containers || containers.length === 0) {
                        OutputLogger.info(`  ⚠️  No containers accessible in ${env}`);
                        discoveryResults[env] = {
                            accessible: false,
                            containers: [],
                            logContainers: []
                        };
                        continue;
                    }
                    
                    // Identify log containers
                    const logContainers = [];
                    const otherContainers = [];
                    
                    for (const container of containers) {
                        const match = this.identifyLogContainer(container);
                        if (match) {
                            logContainers.push({
                                name: container,
                                type: match.type,
                                description: match.description
                            });
                        } else {
                            otherContainers.push(container);
                        }
                    }
                    
                    discoveryResults[env] = {
                        accessible: true,
                        totalContainers: containers.length,
                        logContainers: logContainers,
                        otherContainers: otherContainers
                    };
                    
                    // Display results for this environment
                    OutputLogger.info(`  ✅ Found ${containers.length} total containers`);
                    
                    if (logContainers.length > 0) {
                        OutputLogger.info(`  📊 Log containers (${logContainers.length}):`);
                        for (const log of logContainers) {
                            OutputLogger.info(`     • ${log.name} (${log.description})`);
                        }
                    } else {
                        OutputLogger.info(`  ⚠️  No log containers found!`);
                    }
                    
                    if (otherContainers.length > 0) {
                        OutputLogger.info(`  📦 ALL other containers (${otherContainers.length}):`);
                        for (const container of otherContainers) {
                            OutputLogger.info(`     • ${container}`);
                        }
                    }
                    
                } catch (error) {
                    OutputLogger.error(`  ❌ Error accessing ${env}: ${error.message}`);
                    discoveryResults[env] = {
                        accessible: false,
                        error: error.message
                    };
                }
            }
            
            // Generate diagnostic report
            return this.generateDiagnosticReport(discoveryResults, projectName);
            
        } catch (error) {
            return ResponseBuilder.error(`Log discovery failed: ${error.message}`);
        }
    }
    
    /**
     * Identify if a container is a log container
     */
    static identifyLogContainer(containerName) {
        for (const pattern of this.LOG_CONTAINER_PATTERNS) {
            if (pattern.pattern.test(containerName)) {
                return pattern;
            }
        }
        return null;
    }
    
    /**
     * Extract container list from response
     */
    static extractContainerList(response) {
        if (!response) {
            return [];
        }
        
        let text = '';
        
        // Handle ResponseBuilder format
        if (typeof response === 'object' && response !== null) {
            if (response.content && Array.isArray(response.content) && response.content[0]) {
                text = response.content[0].text || '';
            } else if (response.result && response.result.content && Array.isArray(response.result.content)) {
                const content = response.result.content[0];
                if (content && content.text) {
                    text = content.text;
                }
            } else if (response.error) {
                OutputLogger.info('Error in container list response:', response.error);
                return [];
            } else {
                text = JSON.stringify(response);
            }
        } else if (typeof response === 'string') {
            text = response;
        }
        
        if (!text) {
            return [];
        }
        
        const containers = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            if (!line.trim()) continue;
            
            // Look for numbered emoji format: "1. 📦 container-name"
            let match = line.match(/^\d+\.\s*📦\s*(.+)$/);
            if (match) {
                containers.push(match[1].trim());
                continue;
            }
            
            // Look for simple bullet format: "- container-name" or "• container-name"
            match = line.match(/^[\s\-•]\s*([^\s\-•].+)$/);
            if (match && !match[1].includes('Storage Container') && !match[1].includes('---')) {
                const name = match[1].trim();
                if (name && !name.includes('|') && !name.includes('Environment')) {
                    containers.push(name);
                }
                continue;
            }
            
            // Look for markdown table format: "| container-name |"
            match = line.match(/\|\s*([^|]+)\s*\|/);
            if (match && !match[1].includes('Storage Container') && !match[1].includes('---')) {
                containers.push(match[1].trim());
                continue;
            }
            
            // Try JSON parsing if it looks like container data
            if (line.includes('{') || line.includes('[')) {
                try {
                    const data = JSON.parse(line);
                    if (Array.isArray(data)) {
                        data.forEach(item => {
                            const name = item.StorageContainer || item.Name || item.ContainerName;
                            if (name) containers.push(name);
                        });
                    } else if (data.StorageContainer || data.Name || data.ContainerName) {
                        containers.push(data.StorageContainer || data.Name || data.ContainerName);
                    }
                } catch (e) {
                    // Not JSON, continue
                }
            }
        }
        
        return containers.filter(Boolean);
    }
    
    /**
     * Generate diagnostic report
     */
    static generateDiagnosticReport(results, projectName) {
        let message = `# 🔍 Log Container Discovery Report\n\n`;
        message += `**Project**: ${projectName}\n`;
        message += `**Timestamp**: ${new Date().toISOString()}\n\n`;
        
        // Check for critical issues
        const prodResult = results['Production'];
        const hasProductionIssue = !prodResult?.accessible || prodResult?.logContainers?.length === 0;
        
        if (hasProductionIssue) {
            message += `## 🚨 CRITICAL ISSUE DETECTED\n\n`;
            
            if (!prodResult?.accessible) {
                message += `❌ **Cannot access Production containers**\n`;
                message += `   Error: ${prodResult?.error || 'Access denied'}\n\n`;
                message += `### Recommended Actions:\n`;
                message += `1. Verify API key has Production access\n`;
                message += `2. Contact Optimizely Support to enable Production logging\n`;
                message += `3. Check if Production environment exists for this project\n\n`;
            } else if (prodResult?.logContainers?.length === 0) {
                message += `⚠️  **No log containers found in Production**\n`;
                message += `   Found ${prodResult.totalContainers} containers, but none are log containers\n\n`;
                message += `### Possible Causes:\n`;
                message += `1. **Logging not enabled**: Contact Optimizely Support to enable Production logging\n`;
                message += `2. **Non-standard names**: Containers may have custom names\n`;
                message += `3. **Permission issue**: API key may lack log container access\n\n`;
                
                if (prodResult.otherContainers?.length > 0) {
                    message += `### ALL containers found in Production (${prodResult.otherContainers.length} total):\n`;
                    for (const container of prodResult.otherContainers) {
                        message += `   • \`${container}\`\n`;
                    }
                    message += `\n`;
                    message += `💡 **Tip**: Any of these might contain logs with non-standard names.\n`;
                    message += `Try: \`download_logs environment: "Production" containerName: "[container-name]"\`\n\n`;
                }
            }
        }
        
        // Environment summary
        message += `## 📊 Environment Summary\n\n`;
        
        for (const [env, result] of Object.entries(results)) {
            const icon = result.accessible ? '✅' : '❌';
            const logCount = result.logContainers?.length || 0;
            
            message += `### ${icon} ${env}\n`;
            
            if (!result.accessible) {
                message += `   Status: **Not accessible**\n`;
                if (result.error) {
                    message += `   Error: ${result.error}\n`;
                }
            } else {
                message += `   Status: **Accessible**\n`;
                message += `   Total containers: ${result.totalContainers}\n`;
                message += `   Log containers: ${logCount}\n`;
                
                if (logCount > 0) {
                    message += `   Available logs:\n`;
                    for (const log of result.logContainers) {
                        message += `     • \`${log.name}\` - ${log.description}\n`;
                    }
                }
            }
            message += `\n`;
        }
        
        // Recommendations
        message += `## 💡 Recommendations\n\n`;
        
        if (hasProductionIssue) {
            message += `### For Production Log Access:\n`;
            message += `1. **Contact Optimizely Support** with this information:\n`;
            message += `   - Request to enable Production logging\n`;
            message += `   - Project ID: Include your project ID\n`;
            message += `   - Mention you need access to Application Insights logs\n`;
            message += `   - Request both console and HTTP logs\n\n`;
            
            message += `2. **Alternative Methods** while waiting:\n`;
            message += `   - Check DXP Management Portal for downloadable logs\n`;
            message += `   - Use Application Insights in Azure Portal (if accessible)\n`;
            message += `   - Request Kudu access from Optimizely Support\n\n`;
        }
        
        // Working examples from other environments
        const workingEnvs = Object.entries(results)
            .filter(([env, r]) => r.accessible && r.logContainers?.length > 0)
            .map(([env, r]) => ({ env, containers: r.logContainers }));
        
        if (workingEnvs.length > 0) {
            message += `### ✅ Working Log Access:\n`;
            for (const { env, containers } of workingEnvs) {
                message += `\n**${env}** - Use these commands:\n`;
                for (const container of containers) {
                    message += `\`\`\`\n`;
                    message += `download_logs environment: "${env}" containerName: "${container.name}"\n`;
                    message += `\`\`\`\n`;
                }
            }
        }
        
        message += `\n## 📞 Support Contact\n`;
        message += `If Production logs remain inaccessible:\n`;
        message += `• **Optimizely Support**: support@optimizely.com\n`;
        message += `• **Reference**: "Production Application Insights log access"\n`;
        message += `• **Include**: This diagnostic report\n`;
        
        return ResponseBuilder.success(message);
    }
}

module.exports = LogDiscoveryTools;