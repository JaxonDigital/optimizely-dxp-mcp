/**
 * Deployment Monitoring Module
 * Background monitoring for active deployments with real-time progress updates
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

const EventEmitter = require('events');
const PowerShellHelper = require('./powershell-helper');
const ResponseBuilder = require('./response-builder');
const Config = require('./config');

class DeploymentMonitor extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            // Default monitoring interval in milliseconds
            defaultInterval: options.defaultInterval || 60 * 1000, // 1 minute
            minInterval: options.minInterval || 10 * 1000,         // 10 seconds minimum
            maxInterval: options.maxInterval || 10 * 60 * 1000,   // 10 minutes maximum
            // Auto-stop monitoring when deployment completes
            autoStop: options.autoStop !== false,
            // Max monitoring duration (2 hours)
            maxDuration: options.maxDuration || 2 * 60 * 60 * 1000,
            debug: options.debug || process.env.DEBUG === 'true'
        };
        
        // Active monitoring sessions
        this.monitors = new Map();
        
        // Global stats
        this.stats = {
            totalMonitors: 0,
            activeMonitors: 0,
            completedMonitors: 0,
            totalUpdates: 0
        };
    }
    
    /**
     * Start monitoring a deployment
     * @param {Object} params - Monitoring parameters
     * @param {string} params.deploymentId - Deployment ID to monitor
     * @param {string} params.projectId - Project ID
     * @param {string} params.apiKey - API key
     * @param {string} params.apiSecret - API secret
     * @param {number} params.interval - Update interval in milliseconds (optional)
     * @param {Function} params.callback - Callback for updates (optional)
     * @returns {string} Monitor ID
     */
    startMonitoring(params) {
        const {
            deploymentId,
            projectId,
            apiKey,
            apiSecret,
            interval = this.options.defaultInterval,
            callback
        } = params;
        
        if (!deploymentId || !projectId || !apiKey || !apiSecret) {
            throw new Error('Missing required parameters for deployment monitoring');
        }
        
        // Validate interval
        const monitorInterval = Math.max(
            this.options.minInterval,
            Math.min(this.options.maxInterval, interval)
        );
        
        // Generate monitor ID
        const monitorId = `${deploymentId}-${Date.now()}`;
        
        // Create monitor session
        const monitor = {
            id: monitorId,
            deploymentId,
            projectId,
            apiKey,
            apiSecret,
            interval: monitorInterval,
            callback,
            startTime: Date.now(),
            lastUpdate: null,
            lastStatus: null,
            lastPercentage: null,
            updateCount: 0,
            isActive: true,
            timer: null
        };
        
        // Store monitor
        this.monitors.set(monitorId, monitor);
        this.stats.totalMonitors++;
        this.stats.activeMonitors++;
        
        // Start monitoring with initial delay
        // Add a 5-second delay before first check to allow deployment to register
        const initialDelay = 5000;
        setTimeout(() => {
            if (monitor.isActive) {
                this._scheduleNextCheck(monitor);
            }
        }, initialDelay);
        
        if (this.options.debug) {
            console.error(`Started monitoring deployment ${deploymentId} (initial delay: ${initialDelay}ms, interval: ${monitorInterval}ms)`);
        }
        
        // Emit start event
        this.emit('monitorStarted', {
            monitorId,
            deploymentId,
            projectId,
            interval: monitorInterval
        });
        
        return monitorId;
    }
    
    /**
     * Stop monitoring a deployment
     * @param {string} monitorId - Monitor ID to stop
     * @returns {boolean} Success
     */
    stopMonitoring(monitorId) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor) {
            return false;
        }
        
        // Clear timer
        if (monitor.timer) {
            clearTimeout(monitor.timer);
            monitor.timer = null;
        }
        
        // Mark as inactive
        monitor.isActive = false;
        this.stats.activeMonitors--;
        this.stats.completedMonitors++;
        
        if (this.options.debug) {
            console.error(`Stopped monitoring deployment ${monitor.deploymentId}`);
        }
        
        // Emit stop event
        this.emit('monitorStopped', {
            monitorId,
            deploymentId: monitor.deploymentId,
            projectId: monitor.projectId,
            duration: Date.now() - monitor.startTime,
            updateCount: monitor.updateCount
        });
        
        // Remove from active monitors after a delay (keep for stats)
        setTimeout(() => {
            this.monitors.delete(monitorId);
        }, 60000); // Keep for 1 minute
        
        return true;
    }
    
    /**
     * Update monitoring interval for a specific deployment
     * @param {string} monitorId - Monitor ID
     * @param {number} newInterval - New interval in milliseconds
     * @returns {boolean} Success
     */
    updateInterval(monitorId, newInterval) {
        const monitor = this.monitors.get(monitorId);
        if (!monitor || !monitor.isActive) {
            return false;
        }
        
        // Validate new interval
        const validatedInterval = Math.max(
            this.options.minInterval,
            Math.min(this.options.maxInterval, newInterval)
        );
        
        monitor.interval = validatedInterval;
        
        // Reschedule next check
        if (monitor.timer) {
            clearTimeout(monitor.timer);
        }
        this._scheduleNextCheck(monitor);
        
        if (this.options.debug) {
            console.error(`Updated monitoring interval for ${monitor.deploymentId} to ${validatedInterval}ms`);
        }
        
        this.emit('intervalUpdated', {
            monitorId,
            deploymentId: monitor.deploymentId,
            oldInterval: monitor.interval,
            newInterval: validatedInterval
        });
        
        return true;
    }
    
    /**
     * Schedule next deployment status check
     * @private
     */
    _scheduleNextCheck(monitor) {
        if (!monitor.isActive) {
            return;
        }
        
        monitor.timer = setTimeout(async () => {
            try {
                await this._checkDeploymentStatus(monitor);
            } catch (error) {
                if (this.options.debug) {
                    console.error(`Monitor error for ${monitor.deploymentId}:`, error.message);
                }
                
                this.emit('monitorError', {
                    monitorId: monitor.id,
                    deploymentId: monitor.deploymentId,
                    error: error.message
                });
            }
            
            // Schedule next check if still active
            if (monitor.isActive) {
                this._scheduleNextCheck(monitor);
            }
        }, monitor.interval);
    }
    
    /**
     * Check deployment status and emit updates
     * @private
     */
    async _checkDeploymentStatus(monitor) {
        const { deploymentId, projectId, apiKey, apiSecret } = monitor;
        
        try {
            // Check if we've exceeded max duration
            if (Date.now() - monitor.startTime > this.options.maxDuration) {
                this.stopMonitoring(monitor.id);
                this.emit('monitorTimeout', {
                    monitorId: monitor.id,
                    deploymentId,
                    duration: this.options.maxDuration
                });
                return;
            }
            
            // Get deployment status using PowerShell directly
            const PowerShellCommandBuilder = require('./powershell-command-builder');
            const PowerShellHelper = require('./powershell-helper');
            
            // Mark as new deployment if this is the first check (no previous status)
            const isNewDeployment = monitor.lastStatus === null && monitor.updateCount === 0;
            
            // Add delay for new deployments
            if (isNewDeployment) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
            
            const command = PowerShellCommandBuilder.create('Get-EpiDeployment')
                .addParam('ProjectId', projectId)
                .addParam('Id', deploymentId)
                .build();
            
            const psResult = await PowerShellHelper.executeWithRetry(
                command,
                { apiKey, apiSecret, projectId },
                { 
                    parseJson: true,
                    operation: 'Get Deployment Status'
                },
                isNewDeployment ? { maxAttempts: 3, initialDelay: 3000 } : { maxAttempts: 3 }
            );
            
            // Format the result to match expected structure
            if (!psResult.parsedData) {
                throw new Error(psResult.stderr || 'Failed to get deployment status');
            }
            
            // Extract status and percentage directly from PowerShell result
            const statusData = {
                status: psResult.parsedData.status || psResult.parsedData.Status || 'Unknown',
                percentage: psResult.parsedData.percentComplete || psResult.parsedData.PercentComplete || 0
            };
            
            // Check if there's been a change
            const hasStatusChanged = statusData.status !== monitor.lastStatus;
            const hasPercentageChanged = statusData.percentage !== monitor.lastPercentage;
            
            if (hasStatusChanged || hasPercentageChanged) {
                monitor.lastUpdate = Date.now();
                monitor.lastStatus = statusData.status;
                monitor.lastPercentage = statusData.percentage;
                monitor.updateCount++;
                this.stats.totalUpdates++;
                
                // Emit progress update
                this.emit('progressUpdate', {
                    monitorId: monitor.id,
                    deploymentId,
                    projectId,
                    status: statusData.status,
                    percentage: statusData.percentage,
                    previousStatus: monitor.lastStatus,
                    previousPercentage: monitor.lastPercentage,
                    timestamp: monitor.lastUpdate,
                    duration: monitor.lastUpdate - monitor.startTime
                });
                
                // Call custom callback if provided
                if (monitor.callback && typeof monitor.callback === 'function') {
                    try {
                        monitor.callback(statusData);
                    } catch (callbackError) {
                        if (this.options.debug) {
                            console.error('Monitor callback error:', callbackError.message);
                        }
                    }
                }
                
                // Auto-stop if deployment completed
                if (this.options.autoStop && this._isDeploymentComplete(statusData.status)) {
                    this.stopMonitoring(monitor.id);
                    this.emit('deploymentCompleted', {
                        monitorId: monitor.id,
                        deploymentId,
                        finalStatus: statusData.status,
                        totalDuration: monitor.lastUpdate - monitor.startTime,
                        totalUpdates: monitor.updateCount
                    });
                }
            }
            
        } catch (error) {
            throw error;
        }
    }
    
    /**
     * Parse deployment status result
     * @private
     */
    _parseStatusResult(result) {
        // Default values
        let status = 'Unknown';
        let percentage = 0;
        
        try {
            if (result.result && result.result.content && result.result.content[0]) {
                const text = result.result.content[0].text;
                
                // Extract status using regex
                const statusMatch = text.match(/Status:\s*\*\*([^*]+)\*\*/);
                if (statusMatch) {
                    status = statusMatch[1].trim();
                }
                
                // Extract percentage using regex
                const percentageMatch = text.match(/(\d+)%/);
                if (percentageMatch) {
                    percentage = parseInt(percentageMatch[1]);
                }
                
                // Extract from progress indicators
                const progressMatch = text.match(/\((\d+)%\)/);
                if (progressMatch) {
                    percentage = parseInt(progressMatch[1]);
                }
            }
        } catch (parseError) {
            if (this.options.debug) {
                console.error('Error parsing status result:', parseError.message);
            }
        }
        
        return { status, percentage };
    }
    
    /**
     * Check if deployment status indicates completion
     * @private
     */
    _isDeploymentComplete(status) {
        const completedStatuses = [
            'Succeeded', 'Failed', 'Canceled', 'Cancelled',
            'CompletedSuccessfully', 'CompletedWithErrors', 'Reset'
        ];
        
        // AwaitingVerification is NOT a completed state - monitoring should continue
        // The deployment needs manual completion or will auto-complete eventually
        
        return completedStatuses.some(completed => 
            status.toLowerCase().includes(completed.toLowerCase())
        );
    }
    
    /**
     * Get list of active monitors
     * @returns {Array} Active monitors
     */
    getActiveMonitors() {
        return Array.from(this.monitors.values()).filter(m => m.isActive);
    }
    
    /**
     * Get monitor by ID
     * @param {string} monitorId - Monitor ID
     * @returns {Object|null} Monitor data
     */
    getMonitor(monitorId) {
        return this.monitors.get(monitorId) || null;
    }
    
    /**
     * Get monitoring statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            ...this.stats,
            activeMonitors: this.stats.activeMonitors,
            avgUpdatesPerMonitor: this.stats.totalMonitors > 0 
                ? Math.round(this.stats.totalUpdates / this.stats.totalMonitors)
                : 0
        };
    }
    
    /**
     * Stop all active monitors
     */
    stopAllMonitors() {
        const activeMonitors = this.getActiveMonitors();
        activeMonitors.forEach(monitor => {
            this.stopMonitoring(monitor.id);
        });
        
        return activeMonitors.length;
    }
    
    /**
     * Cleanup and destroy monitor
     */
    destroy() {
        this.stopAllMonitors();
        this.removeAllListeners();
        this.monitors.clear();
    }
}

// Global instance
let globalMonitor = null;

/**
 * Get global deployment monitor instance
 * @returns {DeploymentMonitor} Global monitor
 */
function getGlobalMonitor() {
    if (!globalMonitor) {
        globalMonitor = new DeploymentMonitor();
        
        // Set up global event handlers for user feedback
        globalMonitor.on('progressUpdate', (data) => {
            const { STATUS_ICONS } = Config.FORMATTING;
            const icon = data.status === 'InProgress' ? '🔄' : 
                        data.status === 'Succeeded' ? '✅' : 
                        data.status === 'Failed' ? '❌' : '📊';
            
            console.error(`${icon} Deployment ${data.deploymentId}: ${data.status} (${data.percentage}%)`);
        });
        
        globalMonitor.on('deploymentCompleted', (data) => {
            const icon = data.finalStatus === 'Succeeded' ? '✅' : 
                        data.finalStatus === 'Failed' ? '❌' : '🏁';
            
            console.error(`${icon} Deployment ${data.deploymentId} completed: ${data.finalStatus}`);
        });
    }
    
    return globalMonitor;
}

module.exports = {
    DeploymentMonitor,
    getGlobalMonitor
};