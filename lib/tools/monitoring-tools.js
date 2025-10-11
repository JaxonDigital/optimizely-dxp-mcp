/**
 * Monitoring Tools Module
 * Real-time deployment monitoring and dashboard features
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const ResponseBuilder = require('../response-builder');
const ErrorHandler = require('../error-handler');
const { EventEmitter } = require('events');

class MonitoringTools {
    /**
     * NOTE: getDeploymentDashboard and monitorDeployment methods have been removed
     * as part of DXP-101 (PowerShell to REST API migration).
     *
     * Use these alternatives instead:
     * - list_deployments tool for deployment listing
     * - DeploymentTools.handleMonitorDeployment() for real-time monitoring
     */

    /* REMOVED METHODS (DXP-101 - PowerShell to REST API migration):
     * - getDeploymentDashboard() - Replaced by list_deployments tool
     * - monitorDeployment() - Replaced by DeploymentTools.handleMonitorDeployment()
     */

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
                    // Show 13 chars to get past first dash (e.g., "c88fa98f-9d3c...")
                    response.push(`• Export ${exportId.substring(0, 13)}... (${monitor.environment}/${monitor.databaseName}) - Running ${runtime}m`);
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
                    // Show 13 chars to get past first dash (e.g., "c88fa98f-9d3c...")
                    response.push(`• Database Export: ${exportId.substring(0, 13)}... (${monitor.environment}/${monitor.databaseName}) - ${runtime}m`);
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