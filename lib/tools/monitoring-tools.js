/**
 * Monitoring Tools Module
 * Real-time deployment monitoring and dashboard features
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const SmartExecutor = require('../smart-executor');
const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const { EventEmitter } = require('events');

class MonitoringTools {
    /**
     * Get deployment dashboard - comprehensive overview of all deployments
     * @param {Object} params - Dashboard parameters
     * @returns {Promise<Object>} Dashboard data
     */
    static async getDeploymentDashboard(params = {}) {
        const { 
            projectName, 
            projectId,
            apiKey,
            apiSecret,
            refreshInterval = 0, // 0 = one-time fetch
            limit = 20
        } = params;

        try {
            // Get credentials
            const ProjectTools = require('./project-tools');
            const credentials = ProjectTools.resolveCredentials({
                projectName,
                projectId,
                apiKey,
                apiSecret
            });

            if (!credentials.success) {
                return ResponseBuilder.error(
                    'CREDENTIAL_ERROR',
                    credentials.message,
                    { suggestion: credentials.suggestion }
                );
            }

            // Fetch deployment data
            const deploymentResult = await SmartExecutor.execute(
                `Get-EpiDeployment -Limit ${limit}`,
                credentials.credentials,
                {
                    operation: 'get_deployment_dashboard',
                    useCache: true,
                    cacheArgs: { limit }
                }
            );

            if (!deploymentResult.success) {
                return ResponseBuilder.error(
                    'FETCH_ERROR',
                    'Failed to fetch deployment data',
                    { 
                        error: deploymentResult.stderr,
                        suggestion: deploymentResult.suggestion 
                    }
                );
            }

            const deployments = Array.isArray(deploymentResult.parsedData) 
                ? deploymentResult.parsedData 
                : [deploymentResult.parsedData].filter(Boolean);

            // Analyze deployment data
            const dashboard = this.analyzeDeployments(deployments, credentials.project);

            // Format response
            let response = [];
            response.push('## 📊 Deployment Dashboard\n');
            response.push(`**Project:** ${credentials.project.name}`);
            response.push(`**Time:** ${new Date().toLocaleString()}\n`);

            // Summary section
            response.push('### 📈 Summary');
            response.push(`• **Total Deployments:** ${dashboard.summary.total}`);
            response.push(`• **In Progress:** ${dashboard.summary.inProgress}`);
            response.push(`• **Awaiting Verification:** ${dashboard.summary.awaitingVerification}`);
            response.push(`• **Completed (24h):** ${dashboard.summary.recentCompleted}`);
            response.push(`• **Failed (24h):** ${dashboard.summary.recentFailed}\n`);

            // Environment status
            response.push('### 🌍 Environment Status');
            for (const [env, status] of Object.entries(dashboard.environments)) {
                const icon = this.getEnvironmentIcon(status);
                response.push(`• **${env}:** ${icon} ${status.status}`);
                if (status.lastDeployment) {
                    response.push(`  Last: ${status.lastDeployment.created} (${status.lastDeployment.status})`);
                }
            }
            response.push('');

            // Active deployments
            if (dashboard.activeDeployments.length > 0) {
                response.push('### ⚡ Active Deployments');
                for (const dep of dashboard.activeDeployments) {
                    const progress = this.calculateProgress(dep);
                    response.push(`• **${dep.Id}**`);
                    response.push(`  ${dep.SourceEnvironment} → ${dep.TargetEnvironment}`);
                    response.push(`  Status: ${dep.Status} ${progress}`);
                    response.push(`  Started: ${this.formatTime(dep.Created)}`);
                    if (dep.Status === 'AwaitingVerification') {
                        response.push(`  🔗 [Verify](${this.getVerificationUrl(dep, credentials.project.projectId)})`);
                    }
                }
                response.push('');
            }

            // Recent deployments
            if (dashboard.recentDeployments.length > 0) {
                response.push('### 📜 Recent Deployments (Last 24h)');
                for (const dep of dashboard.recentDeployments.slice(0, 5)) {
                    const icon = this.getStatusIcon(dep.Status);
                    response.push(`• ${icon} **${dep.Id.substring(0, 8)}...** ${dep.SourceEnvironment}→${dep.TargetEnvironment}`);
                    response.push(`  ${dep.Status} - ${this.formatTime(dep.Created)}`);
                }
                response.push('');
            }

            // Deployment patterns
            if (dashboard.patterns.mostCommonRoute) {
                response.push('### 📊 Deployment Patterns');
                response.push(`• **Most Common Route:** ${dashboard.patterns.mostCommonRoute}`);
                response.push(`• **Average Duration:** ${dashboard.patterns.averageDuration}`);
                response.push(`• **Success Rate (7d):** ${dashboard.patterns.successRate}%`);
                response.push('');
            }

            // Recommendations
            if (dashboard.recommendations.length > 0) {
                response.push('### 💡 Recommendations');
                for (const rec of dashboard.recommendations) {
                    response.push(`• ${rec}`);
                }
                response.push('');
            }

            // Auto-refresh note
            if (refreshInterval > 0) {
                response.push(`\n*Dashboard will refresh every ${refreshInterval} seconds*`);
            }

            return ResponseBuilder.success(
                response.join('\n'),
                {
                    dashboard,
                    projectId: credentials.project.projectId,
                    timestamp: new Date().toISOString(),
                    refreshInterval
                }
            );

        } catch (error) {
            return ErrorHandler.handleError(error, { operation: 'get_deployment_dashboard' });
        }
    }

    /**
     * Monitor deployment progress in real-time
     * @param {Object} params - Monitoring parameters
     * @returns {Promise<Object>} Monitoring stream
     */
    static async monitorDeployment(params = {}) {
        const { 
            deploymentId,
            projectName,
            projectId,
            apiKey,
            apiSecret,
            pollInterval = 30000, // 30 seconds
            maxDuration = 3600000 // 1 hour max
        } = params;

        if (!deploymentId) {
            return ResponseBuilder.error(
                'MISSING_PARAMETER',
                'deploymentId is required'
            );
        }

        try {
            // Get credentials
            const ProjectTools = require('./project-tools');
            const credentials = ProjectTools.resolveCredentials({
                projectName,
                projectId,
                apiKey,
                apiSecret
            });

            if (!credentials.success) {
                return ResponseBuilder.error(
                    'CREDENTIAL_ERROR',
                    credentials.message,
                    { suggestion: credentials.suggestion }
                );
            }

            // Create event emitter for progress updates
            const monitor = new EventEmitter();
            let isMonitoring = true;
            const startTime = Date.now();
            
            // Start monitoring loop
            const monitorLoop = async () => {
                while (isMonitoring) {
                    // Check deployment status
                    const result = await SmartExecutor.execute(
                        `Get-EpiDeployment -Id '${deploymentId}'`,
                        credentials.credentials,
                        {
                            operation: 'monitor_deployment',
                            useCache: false, // Always get fresh data
                            useRetry: true
                        }
                    );

                    if (result.success && result.parsedData) {
                        const deployment = Array.isArray(result.parsedData) 
                            ? result.parsedData[0] 
                            : result.parsedData;

                        // Emit update event
                        monitor.emit('update', {
                            deployment,
                            elapsed: Date.now() - startTime,
                            progress: this.calculateProgress(deployment)
                        });

                        // Check if deployment is complete
                        if (this.isDeploymentComplete(deployment.Status)) {
                            monitor.emit('complete', deployment);
                            isMonitoring = false;
                            break;
                        }
                    } else {
                        monitor.emit('error', {
                            message: 'Failed to fetch deployment status',
                            error: result.stderr
                        });
                    }

                    // Check max duration
                    if (Date.now() - startTime > maxDuration) {
                        monitor.emit('timeout', {
                            message: 'Monitoring timed out',
                            elapsed: maxDuration
                        });
                        isMonitoring = false;
                        break;
                    }

                    // Wait for next poll
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                }
            };

            // Start monitoring in background
            monitorLoop().catch(error => {
                monitor.emit('error', { message: error.message });
            });

            // Return monitor control object
            return ResponseBuilder.success(
                `Started monitoring deployment ${deploymentId}`,
                {
                    deploymentId,
                    monitor,
                    stop: () => { isMonitoring = false; },
                    pollInterval,
                    maxDuration
                }
            );

        } catch (error) {
            return ErrorHandler.handleError(error, { operation: 'monitor_deployment' });
        }
    }

    /**
     * Analyze deployments and generate insights
     */
    static analyzeDeployments(deployments, project) {
        const now = new Date();
        const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

        const analysis = {
            summary: {
                total: deployments.length,
                inProgress: 0,
                awaitingVerification: 0,
                recentCompleted: 0,
                recentFailed: 0
            },
            environments: {
                Integration: { status: 'idle', lastDeployment: null },
                Preproduction: { status: 'idle', lastDeployment: null },
                Production: { status: 'idle', lastDeployment: null }
            },
            activeDeployments: [],
            recentDeployments: [],
            patterns: {
                mostCommonRoute: null,
                averageDuration: null,
                successRate: 0
            },
            recommendations: []
        };

        // Route frequency counter
        const routeFrequency = {};
        let totalDuration = 0;
        let completedCount = 0;
        let weeklySuccess = 0;
        let weeklyTotal = 0;

        for (const dep of deployments) {
            const created = new Date(dep.Created);
            const isRecent = created > oneDayAgo;
            const isThisWeek = created > oneWeekAgo;

            // Update summary
            if (dep.Status === 'InProgress') {
                analysis.summary.inProgress++;
                analysis.activeDeployments.push(dep);
            } else if (dep.Status === 'AwaitingVerification') {
                analysis.summary.awaitingVerification++;
                analysis.activeDeployments.push(dep);
            } else if (isRecent) {
                if (dep.Status === 'Succeeded') {
                    analysis.summary.recentCompleted++;
                } else if (dep.Status === 'Failed') {
                    analysis.summary.recentFailed++;
                }
            }

            // Track recent deployments
            if (isRecent) {
                analysis.recentDeployments.push(dep);
            }

            // Update environment status
            if (dep.TargetEnvironment && analysis.environments[dep.TargetEnvironment]) {
                if (dep.Status === 'InProgress' || dep.Status === 'AwaitingVerification') {
                    analysis.environments[dep.TargetEnvironment].status = dep.Status.toLowerCase();
                }
                
                // Track last deployment
                if (!analysis.environments[dep.TargetEnvironment].lastDeployment ||
                    created > new Date(analysis.environments[dep.TargetEnvironment].lastDeployment.created)) {
                    analysis.environments[dep.TargetEnvironment].lastDeployment = {
                        id: dep.Id,
                        status: dep.Status,
                        created: created.toISOString()
                    };
                }
            }

            // Track patterns
            const route = `${dep.SourceEnvironment}→${dep.TargetEnvironment}`;
            routeFrequency[route] = (routeFrequency[route] || 0) + 1;

            if (dep.Status === 'Succeeded' && dep.CompletedTime) {
                const duration = new Date(dep.CompletedTime) - created;
                totalDuration += duration;
                completedCount++;
            }

            if (isThisWeek) {
                weeklyTotal++;
                if (dep.Status === 'Succeeded') {
                    weeklySuccess++;
                }
            }
        }

        // Calculate patterns
        if (Object.keys(routeFrequency).length > 0) {
            analysis.patterns.mostCommonRoute = Object.entries(routeFrequency)
                .sort((a, b) => b[1] - a[1])[0][0];
        }

        if (completedCount > 0) {
            const avgMs = totalDuration / completedCount;
            const avgMinutes = Math.round(avgMs / 60000);
            analysis.patterns.averageDuration = `${avgMinutes} minutes`;
        }

        if (weeklyTotal > 0) {
            analysis.patterns.successRate = Math.round((weeklySuccess / weeklyTotal) * 100);
        }

        // Generate recommendations
        if (analysis.summary.awaitingVerification > 0) {
            analysis.recommendations.push(
                `⚠️ ${analysis.summary.awaitingVerification} deployment(s) awaiting verification`
            );
        }

        if (analysis.summary.recentFailed > 2) {
            analysis.recommendations.push(
                '⚠️ Multiple failed deployments in last 24h - review logs'
            );
        }

        if (analysis.patterns.successRate < 80 && weeklyTotal > 5) {
            analysis.recommendations.push(
                `⚠️ Low success rate (${analysis.patterns.successRate}%) - consider reviewing deployment process`
            );
        }

        return analysis;
    }

    /**
     * Helper methods
     */
    static getStatusIcon(status) {
        const icons = {
            'Succeeded': '✅',
            'Failed': '❌',
            'InProgress': '⏳',
            'AwaitingVerification': '🔍',
            'Resetting': '🔄',
            'Reset': '↩️'
        };
        return icons[status] || '❓';
    }

    static getEnvironmentIcon(status) {
        if (status.status === 'inprogress') return '⏳';
        if (status.status === 'awaitingverification') return '🔍';
        return '✅';
    }

    static calculateProgress(deployment) {
        if (!deployment) return '';
        
        if (deployment.Status === 'Succeeded') return '(100%)';
        if (deployment.Status === 'Failed') return '(Failed)';
        if (deployment.Status === 'AwaitingVerification') return '(90% - Needs verification)';
        if (deployment.Status === 'InProgress') {
            // Estimate based on time elapsed
            const created = new Date(deployment.Created);
            const elapsed = Date.now() - created;
            const estimatedDuration = 10 * 60 * 1000; // 10 minutes average
            const progress = Math.min(85, Math.round((elapsed / estimatedDuration) * 85));
            return `(~${progress}%)`;
        }
        return '';
    }

    static isDeploymentComplete(status) {
        return ['Succeeded', 'Failed', 'Reset'].includes(status);
    }

    static formatTime(timestamp) {
        if (!timestamp) return 'Unknown';
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`;
        if (diff < 86400000) return `${Math.round(diff / 3600000)} hours ago`;
        return date.toLocaleDateString();
    }

    static getVerificationUrl(deployment, projectId) {
        const baseUrl = 'https://dxp.episerver.com';
        return `${baseUrl}/projects/${projectId}/deployments/${deployment.Id}/verify`;
    }

    /**
     * Get monitoring statistics
     * @param {Object} params - Parameters  
     * @returns {Promise<Object>} Monitoring statistics
     */
    static async getMonitoringStats(params = {}) {
        try {
            // Check for active database export monitors
            const DatabaseSimpleTools = require('./database-simple-tools');
            const activeMonitors = DatabaseSimpleTools.backgroundMonitors;
            
            const response = [];
            response.push('## 📊 Monitoring Statistics\n');
            
            if (activeMonitors && activeMonitors.size > 0) {
                response.push(`**Active Database Export Monitors:** ${activeMonitors.size}`);
                for (const [exportId, monitor] of activeMonitors) {
                    const runtime = Math.round((Date.now() - monitor.startTime) / 60000);
                    response.push(`• Export ${exportId.substring(0, 8)}... (${monitor.environment}/${monitor.databaseName}) - Running ${runtime}m`);
                }
            } else {
                response.push('**Active Database Export Monitors:** 0');
            }
            
            response.push('\n**System Status:**');
            response.push('• Background monitoring: ✅ Available');
            response.push('• Auto-download: ✅ Available');
            response.push('• Progress tracking: ✅ Available');
            
            return ResponseBuilder.success(response.join('\n'));
            
        } catch (error) {
            return ResponseBuilder.error('MONITORING_ERROR', error.message);
        }
    }

    /**
     * List active deployment monitors and monitoring statistics
     * @param {Object} params - Monitoring parameters
     * @returns {Promise<Object>} Monitor information
     */
    static async listMonitors(params = {}) {
        try {
            // Check for active database export monitors  
            const DatabaseSimpleTools = require('./database-simple-tools');
            const activeMonitors = DatabaseSimpleTools.backgroundMonitors;
            
            const response = [];
            response.push('## 📡 Deployment Monitoring Status\n');
            
            if (activeMonitors && activeMonitors.size > 0) {
                response.push(`**Active Monitors:** ${activeMonitors.size} background monitor(s) running`);
                for (const [exportId, monitor] of activeMonitors) {
                    const runtime = Math.round((Date.now() - monitor.startTime) / 60000);
                    response.push(`• Database Export: ${exportId.substring(0, 8)}... (${monitor.environment}/${monitor.databaseName}) - ${runtime}m`);
                }
            } else {
                response.push('**Active Monitors:** Currently no background monitors running');
            }
            response.push('**Monitoring Features:**');
            response.push('• Real-time deployment tracking');
            response.push('• Progress monitoring with ETA calculation');
            response.push('• Automatic completion detection');
            response.push('• Background monitoring support\n');
            
            response.push('**Available Commands:**');
            response.push('• `update_monitoring_interval` - Change monitoring frequency');
            response.push('• `stop_monitoring` - Stop active monitors');
            response.push('• `get_monitoring_stats` - View detailed statistics\n');
            
            response.push('💡 **Tip:** Monitoring is automatically started when using deployment tools');

            return ResponseBuilder.success(
                response.join('\n'),
                {
                    activeMonitors: 0,
                    features: ['real-time tracking', 'progress monitoring', 'completion detection'],
                    timestamp: new Date().toISOString()
                }
            );

        } catch (error) {
            return ErrorHandler.handleError(error, { operation: 'list_monitors' });
        }
    }
}

module.exports = MonitoringTools;