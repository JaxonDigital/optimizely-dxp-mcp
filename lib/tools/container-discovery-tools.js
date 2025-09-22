/**
 * Container Discovery Tools
 * Analyzes and documents Azure Storage containers across DXP environments
 * Part of DXP-4: Better understanding of container landscape
 */

const StorageTools = require('./storage-tools');
const ProjectTools = require('./project-tools');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const OutputLogger = require('../output-logger');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { URL } = require('url');

class ContainerDiscoveryTools {
    /**
     * Known container patterns and their typical content
     */
    static KNOWN_PATTERNS = {
        // Log containers
        'azure-application-logs': { type: 'logs', subtype: 'application', description: 'Application/console logs' },
        'azure-web-logs': { type: 'logs', subtype: 'web', description: 'HTTP/IIS web server logs' },
        'cloudflarelogpush': { type: 'logs', subtype: 'cdn', description: 'Cloudflare CDN logs' },
        'insights-logs-appserviceconsolelogs': { type: 'logs', subtype: 'application', description: 'App Service console logs' },
        'insights-logs-appservicehttplogs': { type: 'logs', subtype: 'web', description: 'App Service HTTP logs' },
        
        // Media/asset containers
        'mysitemedia': { type: 'media', subtype: 'blobs', description: 'CMS media assets' },
        'assets': { type: 'media', subtype: 'static', description: 'Static assets' },
        'media': { type: 'media', subtype: 'blobs', description: 'Media files' },
        
        // System containers
        'azure-webjobs-hosts': { type: 'system', subtype: 'webjobs', description: 'WebJobs runtime data' },
        'deployment': { type: 'system', subtype: 'deployment', description: 'Deployment packages' },
        
        // Support containers
        'support': { type: 'support', subtype: 'files', description: 'Support-provided files' },
        'temp': { type: 'support', subtype: 'temporary', description: 'Temporary files' }
    };

    /**
     * Discover all containers across all environments for a project
     */
    static async discoverContainers(args) {
        try {
            const { project, projectName } = args;
            
            OutputLogger.info('🔍 Starting container discovery...');
            
            // Get project configuration
            const projectConfig = await ProjectTools.getProjectCredentials(
                project || projectName || ProjectTools.getCurrentProject()
            );
            
            if (!projectConfig.projectId) {
                return ResponseBuilder.error('No project configured. Specify --project or set a default.');
            }
            
            const environments = ['Integration', 'Preproduction', 'Production'];
            const discovery = {
                project: projectConfig.name || project || projectName,
                timestamp: new Date().toISOString(),
                environments: {}
            };
            
            // Discover containers in each environment
            for (const env of environments) {
                OutputLogger.info(`\n📊 Analyzing ${env} environment...`);
                
                try {
                    // List containers
                    const containersResult = await StorageTools.handleListStorageContainers({
                        apiKey: projectConfig.apiKey,
                        apiSecret: projectConfig.apiSecret,
                        projectId: projectConfig.projectId,
                        environment: env
                    });
                    
                    const containers = this.parseContainerList(containersResult);
                    
                    discovery.environments[env] = {
                        containerCount: containers.length,
                        containers: []
                    };
                    
                    // Analyze each container
                    for (const containerName of containers) {
                        OutputLogger.info(`  📦 Analyzing container: ${containerName}`);
                        
                        const analysis = await this.analyzeContainer(
                            projectConfig,
                            env,
                            containerName
                        );
                        
                        discovery.environments[env].containers.push({
                            name: containerName,
                            ...analysis
                        });
                    }
                    
                } catch (error) {
                    OutputLogger.warning(`  ⚠️ Could not access ${env}: ${error.message}`);
                    discovery.environments[env] = {
                        error: error.message,
                        accessible: false
                    };
                }
            }
            
            // Save discovery report
            const reportPath = await this.saveDiscoveryReport(discovery);
            
            // Generate summary
            return this.generateDiscoverySummary(discovery, reportPath);
            
        } catch (error) {
            return ErrorHandler.handleError(error, 'container discovery');
        }
    }

    /**
     * Analyze a single container to determine its content type and characteristics
     */
    static async analyzeContainer(projectConfig, environment, containerName) {
        const analysis = {
            type: 'unknown',
            subtype: 'unknown',
            description: 'Unknown content',
            characteristics: {},
            sample: []
        };
        
        // Check against known patterns
        for (const [pattern, info] of Object.entries(this.KNOWN_PATTERNS)) {
            if (containerName.toLowerCase().includes(pattern.toLowerCase())) {
                analysis.type = info.type;
                analysis.subtype = info.subtype;
                analysis.description = info.description;
                break;
            }
        }
        
        // Detect type from name if not matched
        if (analysis.type === 'unknown') {
            if (containerName.includes('log')) {
                analysis.type = 'logs';
            } else if (containerName.includes('media') || containerName.includes('asset')) {
                analysis.type = 'media';
            } else if (containerName.includes('backup')) {
                analysis.type = 'backup';
            }
        }
        
        try {
            // Get a SAS link to peek at contents
            const sasResponse = await StorageTools.handleGenerateStorageSasLink({
                apiKey: projectConfig.apiKey,
                apiSecret: projectConfig.apiSecret,
                projectId: projectConfig.projectId,
                environment: environment,
                containerName: containerName,
                permissions: 'Read',
                expiryHours: 1
            });
            
            const sasUrl = this.extractSasUrl(sasResponse);
            if (sasUrl) {
                // Sample first few files to understand content
                const sample = await this.sampleContainerContents(sasUrl, 10);
                analysis.sample = sample.files;
                analysis.characteristics = {
                    totalFiles: sample.totalCount,
                    fileTypes: sample.fileTypes,
                    dateRange: sample.dateRange,
                    averageSize: sample.averageSize
                };
                
                // Refine type based on actual content
                if (analysis.type === 'unknown' && sample.fileTypes.length > 0) {
                    const extensions = sample.fileTypes.join(',');
                    if (extensions.includes('.log') || extensions.includes('.txt')) {
                        analysis.type = 'logs';
                    } else if (extensions.includes('.jpg') || extensions.includes('.png') || extensions.includes('.pdf')) {
                        analysis.type = 'media';
                    } else if (extensions.includes('.bak') || extensions.includes('.bacpac')) {
                        analysis.type = 'backup';
                    }
                }
            }
        } catch (error) {
            analysis.error = error.message;
        }
        
        return analysis;
    }

    /**
     * Sample container contents to understand what's inside
     */
    static async sampleContainerContents(sasUrl, maxSamples = 10) {
        return new Promise((resolve) => {
            const url = new URL(sasUrl);
            const listUrl = `${url.origin}${url.pathname}${url.search}&restype=container&comp=list&maxresults=${maxSamples}`;
            
            https.get(listUrl, (response) => {
                let data = '';
                
                response.on('data', chunk => {
                    data += chunk;
                });
                
                response.on('end', () => {
                    try {
                        const files = [];
                        const fileTypes = new Set();
                        let totalSize = 0;
                        let minDate = null;
                        let maxDate = null;
                        
                        // Parse XML response
                        const nameMatches = data.match(/<Name>([^<]+)<\/Name>/g) || [];
                        const sizeMatches = data.match(/<Content-Length>([^<]+)<\/Content-Length>/g) || [];
                        const dateMatches = data.match(/<Last-Modified>([^<]+)<\/Last-Modified>/g) || [];
                        
                        nameMatches.forEach((match, i) => {
                            const name = match.replace(/<\/?Name>/g, '');
                            const size = sizeMatches[i] ? parseInt(sizeMatches[i].replace(/<\/?Content-Length>/g, '')) : 0;
                            const date = dateMatches[i] ? dateMatches[i].replace(/<\/?Last-Modified>/g, '') : null;
                            
                            files.push({ name, size });
                            
                            // Extract file extension
                            const ext = path.extname(name).toLowerCase();
                            if (ext) fileTypes.add(ext);
                            
                            totalSize += size;
                            
                            // Track date range
                            if (date) {
                                const d = new Date(date);
                                if (!minDate || d < minDate) minDate = d;
                                if (!maxDate || d > maxDate) maxDate = d;
                            }
                        });
                        
                        // Count total files (approximation from first batch)
                        const totalCountMatch = data.match(/<Blob>/g);
                        const totalCount = totalCountMatch ? totalCountMatch.length : files.length;
                        
                        resolve({
                            files: files.slice(0, 5), // Return only first 5 as sample
                            totalCount,
                            fileTypes: Array.from(fileTypes),
                            dateRange: minDate && maxDate ? {
                                oldest: minDate.toISOString(),
                                newest: maxDate.toISOString()
                            } : null,
                            averageSize: files.length > 0 ? Math.round(totalSize / files.length) : 0
                        });
                    } catch (error) {
                        resolve({
                            files: [],
                            totalCount: 0,
                            fileTypes: [],
                            error: error.message
                        });
                    }
                });
                
                response.on('error', () => {
                    resolve({
                        files: [],
                        totalCount: 0,
                        fileTypes: [],
                        error: 'Failed to sample container'
                    });
                });
            });
        });
    }

    /**
     * Parse container list from StorageTools result
     */
    static parseContainerList(result) {
        if (!result || !result.result || !result.result.content) {
            return [];
        }
        
        const content = result.result.content.join('\n');
        const containers = [];
        
        // Parse the PowerShell output
        const lines = content.split('\n');
        lines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('Name') && !trimmed.includes('----')) {
                // Extract container name (first word in the line)
                const parts = trimmed.split(/\s+/);
                if (parts[0]) {
                    containers.push(parts[0]);
                }
            }
        });
        
        return containers;
    }

    /**
     * Extract SAS URL from StorageTools response
     */
    static extractSasUrl(result) {
        if (!result || !result.result || !result.result.content) {
            return null;
        }
        
        const content = result.result.content.join(' ');
        const urlMatch = content.match(/https:\/\/[^\s]+/);
        return urlMatch ? urlMatch[0] : null;
    }

    /**
     * Save discovery report to file
     */
    static async saveDiscoveryReport(discovery) {
        const reportsDir = path.join(process.cwd(), 'container-discovery');
        await fs.mkdir(reportsDir, { recursive: true });
        
        const filename = `discovery-${discovery.project}-${Date.now()}.json`;
        const filepath = path.join(reportsDir, filename);
        
        await fs.writeFile(filepath, JSON.stringify(discovery, null, 2));
        
        return filepath;
    }

    /**
     * Generate human-readable summary
     */
    static generateDiscoverySummary(discovery, reportPath) {
        let message = '📊 Container Discovery Report\n';
        message += '═'.repeat(50) + '\n\n';
        
        message += `Project: ${discovery.project}\n`;
        message += `Timestamp: ${discovery.timestamp}\n\n`;
        
        // Container type summary
        const typeSummary = {};
        
        for (const [env, data] of Object.entries(discovery.environments)) {
            message += `\n🌍 ${env} Environment\n`;
            message += '─'.repeat(30) + '\n';
            
            if (data.error) {
                message += `  ⚠️ Not accessible: ${data.error}\n`;
                continue;
            }
            
            message += `  Total containers: ${data.containerCount}\n\n`;
            
            // Group by type
            const byType = {};
            data.containers.forEach(container => {
                if (!byType[container.type]) {
                    byType[container.type] = [];
                }
                byType[container.type].push(container);
                
                // Track for overall summary
                if (!typeSummary[container.type]) {
                    typeSummary[container.type] = new Set();
                }
                typeSummary[container.type].add(container.name);
            });
            
            // Display by type
            for (const [type, containers] of Object.entries(byType)) {
                message += `  📁 ${type.toUpperCase()} (${containers.length})\n`;
                containers.forEach(c => {
                    message += `     • ${c.name}`;
                    if (c.characteristics && c.characteristics.totalFiles) {
                        message += ` (${c.characteristics.totalFiles} files)`;
                    }
                    message += '\n';
                });
            }
        }
        
        // Overall summary
        message += '\n\n📈 Overall Summary\n';
        message += '─'.repeat(30) + '\n';
        
        for (const [type, names] of Object.entries(typeSummary)) {
            message += `\n${type.toUpperCase()} Containers:\n`;
            Array.from(names).sort().forEach(name => {
                message += `  • ${name}\n`;
            });
        }
        
        message += `\n\n💾 Full report saved to:\n${reportPath}`;
        
        return ResponseBuilder.success(message);
    }
}

module.exports = ContainerDiscoveryTools;