/**
 * Deployment Monitoring Management Tools
 * Tools for managing background deployment monitoring
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const ResponseBuilder = require('../response-builder');
const { getGlobalMonitor } = require('../deployment-monitor');
const Config = require('../config');

class MonitoringTools {
    
    /**
     * List active deployment monitors
     */
    static async listMonitors(args) {
        try {
            const monitor = getGlobalMonitor();
            const activeMonitors = monitor.getActiveMonitors();
            const stats = monitor.getStats();
            
            let response = `📊 **Active Deployment Monitors**\n\n`;
            
            if (activeMonitors.length === 0) {
                response += `No active monitors running.\n\n`;
                response += `✨ **Auto-Monitoring**: New deployments are automatically monitored!\n`;
                response += `• Checks every 60 seconds by default\n`;
                response += `• Reports progress changes automatically\n`;
                response += `• Stops when deployment completes\n\n`;
            } else {
                response += `**${activeMonitors.length} Active Monitor${activeMonitors.length > 1 ? 's' : ''}**\n\n`;
                
                activeMonitors.forEach((mon, index) => {
                    const runtime = Math.round((Date.now() - mon.startTime) / 1000 / 60);
                    const intervalSec = Math.round(mon.interval / 1000);
                    
                    response += `${index + 1}. **Deployment ${mon.deploymentId}**\n`;
                    response += `   • Runtime: ${runtime} minute${runtime !== 1 ? 's' : ''}\n`;
                    response += `   • Check interval: ${intervalSec} second${intervalSec !== 1 ? 's' : ''}\n`;
                    response += `   • Updates: ${mon.updateCount}\n`;
                    
                    if (mon.lastStatus) {
                        response += `   • Last status: ${mon.lastStatus}`;
                        if (mon.lastPercentage !== null) {
                            response += ` (${mon.lastPercentage}%)`;
                        }
                        response += `\n`;
                    }
                    
                    response += `\n`;
                });
            }
            
            // Overall stats
            response += `📈 **Monitoring Statistics**\n`;
            response += `• Total monitors created: ${stats.totalMonitors}\n`;
            response += `• Currently active: ${stats.activeMonitors}\n`;
            response += `• Completed: ${stats.completedMonitors}\n`;
            response += `• Total updates sent: ${stats.totalUpdates}\n`;
            response += `• Avg updates per monitor: ${stats.avgUpdatesPerMonitor}\n\n`;
            
            // Usage tips
            response += `💡 **Monitor Management**\n`;
            response += `• "Update monitoring interval to 30 seconds" - Change frequency\n`;
            response += `• "Stop monitoring deployment abc-123" - Stop specific monitor\n`;
            response += `• "Stop all monitoring" - Stop all active monitors\n`;
            
            return ResponseBuilder.success(ResponseBuilder.addFooter(response));
            
        } catch (error) {
            return ResponseBuilder.internalError('Failed to list monitors', error.message);
        }
    }
    
    /**
     * Update monitoring interval for active deployments
     */
    static async updateMonitoringInterval(args) {
        try {
            const { deploymentId, interval } = args;
            
            if (!interval || interval < 10 || interval > 600) {
                return ResponseBuilder.error(
                    '❌ **Invalid Interval**\n\n' +
                    'Interval must be between 10 and 600 seconds.\n\n' +
                    '💡 **Suggested intervals:**\n' +
                    '• 10-30 seconds: Active monitoring\n' +
                    '• 60 seconds: Normal monitoring (default)\n' +
                    '• 300 seconds: Background monitoring\n\n' +
                    '📧 Need help? Contact us at support@jaxondigital.com'
                );
            }
            
            const monitor = getGlobalMonitor();
            const activeMonitors = monitor.getActiveMonitors();
            
            if (deploymentId) {
                // Update specific deployment
                const targetMonitor = activeMonitors.find(m => 
                    m.deploymentId === deploymentId || 
                    m.deploymentId.startsWith(deploymentId)
                );
                
                if (!targetMonitor) {
                    return ResponseBuilder.error(
                        `❌ **Monitor Not Found**\n\n` +
                        `No active monitor found for deployment "${deploymentId}".\n\n` +
                        `💡 Use "list monitors" to see active monitors.\n\n` +
                        `📧 Need help? Contact us at support@jaxondigital.com`
                    );
                }
                
                const success = monitor.updateInterval(targetMonitor.id, interval * 1000);
                if (success) {
                    return ResponseBuilder.success(
                        `✅ **Monitoring Interval Updated**\n\n` +
                        `**Deployment**: ${targetMonitor.deploymentId}\n` +
                        `**New Interval**: ${interval} seconds\n\n` +
                        `The monitor will now check for updates every ${interval} seconds.\n\n` +
                        ResponseBuilder.addFooter('')
                    );
                } else {
                    return ResponseBuilder.error('Failed to update monitoring interval');
                }
                
            } else {
                // Update all active monitors
                if (activeMonitors.length === 0) {
                    return ResponseBuilder.error(
                        `ℹ️  **No Active Monitors**\n\n` +
                        `There are no active monitors to update.\n\n` +
                        `New deployments will automatically use the default 60-second interval.\n\n` +
                        `📧 Need help? Contact us at support@jaxondigital.com`
                    );
                }
                
                let updatedCount = 0;
                activeMonitors.forEach(mon => {
                    if (monitor.updateInterval(mon.id, interval * 1000)) {
                        updatedCount++;
                    }
                });
                
                return ResponseBuilder.success(
                    `✅ **Monitoring Intervals Updated**\n\n` +
                    `**Updated**: ${updatedCount} of ${activeMonitors.length} monitor${activeMonitors.length > 1 ? 's' : ''}\n` +
                    `**New Interval**: ${interval} seconds\n\n` +
                    `All active monitors will now check for updates every ${interval} seconds.\n\n` +
                    ResponseBuilder.addFooter('')
                );
            }
            
        } catch (error) {
            return ResponseBuilder.internalError('Failed to update monitoring interval', error.message);
        }
    }
    
    /**
     * Stop monitoring for specific deployment or all deployments
     */
    static async stopMonitoring(args) {
        try {
            const { deploymentId, all } = args;
            const monitor = getGlobalMonitor();
            
            if (all) {
                // Stop all monitors
                const stoppedCount = monitor.stopAllMonitors();
                
                if (stoppedCount === 0) {
                    return ResponseBuilder.success(
                        `ℹ️  **No Active Monitors**\n\n` +
                        `There were no active monitors to stop.\n\n` +
                        ResponseBuilder.addFooter('')
                    );
                }
                
                return ResponseBuilder.success(
                    `✅ **All Monitoring Stopped**\n\n` +
                    `**Stopped**: ${stoppedCount} monitor${stoppedCount > 1 ? 's' : ''}\n\n` +
                    `All background monitoring has been stopped. New deployments will still be automatically monitored.\n\n` +
                    ResponseBuilder.addFooter('')
                );
                
            } else if (deploymentId) {
                // Stop specific monitor
                const activeMonitors = monitor.getActiveMonitors();
                const targetMonitor = activeMonitors.find(m => 
                    m.deploymentId === deploymentId || 
                    m.deploymentId.startsWith(deploymentId)
                );
                
                if (!targetMonitor) {
                    return ResponseBuilder.error(
                        `❌ **Monitor Not Found**\n\n` +
                        `No active monitor found for deployment "${deploymentId}".\n\n` +
                        `💡 Use "list monitors" to see active monitors.\n\n` +
                        `📧 Need help? Contact us at support@jaxondigital.com`
                    );
                }
                
                const success = monitor.stopMonitoring(targetMonitor.id);
                if (success) {
                    return ResponseBuilder.success(
                        `✅ **Monitoring Stopped**\n\n` +
                        `**Deployment**: ${targetMonitor.deploymentId}\n\n` +
                        `Background monitoring for this deployment has been stopped.\n\n` +
                        ResponseBuilder.addFooter('')
                    );
                } else {
                    return ResponseBuilder.error('Failed to stop monitoring');
                }
                
            } else {
                return ResponseBuilder.error(
                    '❌ **Missing Parameters**\n\n' +
                    'Please specify either:\n' +
                    '• `deploymentId`: Stop monitoring specific deployment\n' +
                    '• `all: true`: Stop all active monitoring\n\n' +
                    '📧 Need help? Contact us at support@jaxondigital.com'
                );
            }
            
        } catch (error) {
            return ResponseBuilder.internalError('Failed to stop monitoring', error.message);
        }
    }
    
    /**
     * Get monitoring statistics
     */
    static async getMonitoringStats(args) {
        try {
            const monitor = getGlobalMonitor();
            const stats = monitor.getStats();
            const activeMonitors = monitor.getActiveMonitors();
            
            let response = `📊 **Deployment Monitoring Statistics**\n\n`;
            
            // Current status
            response += `**Current Status**\n`;
            response += `• Active monitors: ${stats.activeMonitors}\n`;
            response += `• Monitoring sessions: ${activeMonitors.length > 0 ? activeMonitors.map(m => m.deploymentId.slice(-8)).join(', ') : 'None'}\n\n`;
            
            // Historical stats
            response += `**Historical Data**\n`;
            response += `• Total monitors created: ${stats.totalMonitors}\n`;
            response += `• Successfully completed: ${stats.completedMonitors}\n`;
            response += `• Total progress updates: ${stats.totalUpdates}\n`;
            response += `• Average updates per monitor: ${stats.avgUpdatesPerMonitor}\n\n`;
            
            // Performance metrics
            if (activeMonitors.length > 0) {
                response += `**Active Monitor Details**\n`;
                activeMonitors.forEach((mon, index) => {
                    const runtime = Math.round((Date.now() - mon.startTime) / 1000 / 60);
                    const updateRate = runtime > 0 ? Math.round(mon.updateCount / runtime * 10) / 10 : 0;
                    
                    response += `${index + 1}. **${mon.deploymentId.slice(-8)}** (${runtime}m runtime, ${updateRate} updates/min)\n`;
                });
                response += `\n`;
            }
            
            // System info
            response += `**System Information**\n`;
            response += `• Default interval: 60 seconds\n`;
            response += `• Min interval: 10 seconds\n`;
            response += `• Max interval: 600 seconds\n`;
            response += `• Auto-stop on completion: Yes\n`;
            response += `• Max monitor duration: 2 hours\n\n`;
            
            response += `💡 **Features**\n`;
            response += `• Real-time progress tracking\n`;
            response += `• Automatic completion detection\n`;
            response += `• Configurable update intervals\n`;
            response += `• Background operation (non-blocking)\n`;
            
            return ResponseBuilder.success(ResponseBuilder.addFooter(response));
            
        } catch (error) {
            return ResponseBuilder.internalError('Failed to get monitoring statistics', error.message);
        }
    }
}

module.exports = MonitoringTools;