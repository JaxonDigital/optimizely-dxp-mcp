/**
 * Deployment Monitoring Module
 * Background monitoring for active deployments with real-time progress updates
 * Part of Jaxon Digital Optimizely DXP MCP Server
 */

import { EventEmitter } from 'events';
import DXPRestClient from './dxp-rest-client';
// import ResponseBuilder - unused
// import Config - unused
import DeploymentResourceHandler from './resources/deployment-resource';

// Type definitions
interface DeploymentMonitorOptions {
    defaultInterval?: number;
    minInterval?: number;
    maxInterval?: number;
    autoStop?: boolean;
    maxDuration?: number;
    debug?: boolean;
}

interface MonitorParams {
    deploymentId: string;
    projectId: string;
    apiKey: string;
    apiSecret: string;
    interval?: number;
    callback?: (statusData: StatusData) => void;
    apiUrl?: string;
}

interface MonitorSession {
    id: string;
    deploymentId: string;
    projectId: string;
    apiKey: string;
    apiSecret: string;
    interval: number;
    callback?: (statusData: StatusData) => void;
    startTime: number;
    lastUpdate: number | null;
    lastStatus: string | null;
    lastPercentage: number | null;
    updateCount: number;
    isActive: boolean;
    timer: NodeJS.Timeout | null;
    apiUrl?: string;
}

interface MonitorStats {
    totalMonitors: number;
    activeMonitors: number;
    completedMonitors: number;
    totalUpdates: number;
}

interface StatusData {
    status: string;
    percentage: number;
}

interface DeploymentResult {
    status?: string;
    Status?: string;
    percentComplete?: number;
    PercentComplete?: number;
    deploymentSlotUrl?: string;
    DeploymentSlotUrl?: string;
    errorMessage?: string;
    ErrorMessage?: string;
    [key: string]: any;
}

// interface MonitorEvent {
//     monitorId: string;
//     deploymentId: string;
//     projectId?: string;
//     [key: string]: any;
// }

class DeploymentMonitor extends EventEmitter {
    private options: Required<DeploymentMonitorOptions>;
    private monitors: Map<string, MonitorSession>;
    private stats: MonitorStats;

    constructor(options: DeploymentMonitorOptions = {}) {
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
     * @param params - Monitoring parameters
     * @returns Monitor ID
     */
    startMonitoring(params: MonitorParams): string {
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
        const monitor: MonitorSession = {
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
     * @param monitorId - Monitor ID to stop
     * @returns Success
     */
    stopMonitoring(monitorId: string): boolean {
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
     * @param monitorId - Monitor ID
     * @param newInterval - New interval in milliseconds
     * @returns Success
     */
    updateInterval(monitorId: string, newInterval: number): boolean {
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
    private _scheduleNextCheck(monitor: MonitorSession): void {
        if (!monitor.isActive) {
            return;
        }

        monitor.timer = setTimeout(async () => {
            try {
                await this._checkDeploymentStatus(monitor);
            } catch (error) {
                if (this.options.debug) {
                    console.error(`Monitor error for ${monitor.deploymentId}:`, (error as Error).message);
                }

                this.emit('monitorError', {
                    monitorId: monitor.id,
                    deploymentId: monitor.deploymentId,
                    error: (error as Error).message
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
    private async _checkDeploymentStatus(monitor: MonitorSession): Promise<void> {
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

            // DXP-101: Get deployment status using REST API instead of PowerShell
            // Mark as new deployment if this is the first check (no previous status)
            const isNewDeployment = monitor.lastStatus === null && monitor.updateCount === 0;

            // Add delay for new deployments
            if (isNewDeployment) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // Use REST API to get deployment status
            const result: DeploymentResult = await DXPRestClient.getDeployments(
                projectId,
                apiKey,
                apiSecret,
                deploymentId,
                { apiUrl: monitor.apiUrl } // Support custom API URLs
            );

            // Format the result to match expected structure
            if (!result) {
                throw new Error('Failed to get deployment status');
            }

            // Extract status and percentage from REST API result
            const statusData: StatusData = {
                status: result.status || result.Status || 'Unknown',
                percentage: result.percentComplete || result.PercentComplete || 0
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

                // DXP-136: Emit deployment resource event based on status
                try {
                    if (statusData.status === 'InProgress') {
                        DeploymentResourceHandler.emitInProgress(deploymentId, {
                            progress: statusData.percentage,
                            status: statusData.status
                        });
                    } else if (statusData.status === 'AwaitingVerification') {
                        DeploymentResourceHandler.emitAwaitingVerification(deploymentId, {
                            progress: statusData.percentage,
                            status: statusData.status,
                            slotUrl: result.deploymentSlotUrl || result.DeploymentSlotUrl
                        });
                    } else if (statusData.status === 'Succeeded') {
                        DeploymentResourceHandler.emitSucceeded(deploymentId, {
                            status: statusData.status,
                            slotUrl: result.deploymentSlotUrl || result.DeploymentSlotUrl
                        });
                    } else if (statusData.status === 'Failed') {
                        DeploymentResourceHandler.emitFailed(deploymentId, {
                            status: statusData.status,
                            error: result.errorMessage || result.ErrorMessage || 'Deployment failed'
                        });
                    }
                } catch (eventError) {
                    console.error(`Failed to emit deployment progress event: ${(eventError as Error).message}`);
                    // Don't fail monitoring if event emission fails
                }

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
                            console.error('Monitor callback error:', (callbackError as Error).message);
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
     * Check if deployment status indicates completion
     * @private
     */
    private _isDeploymentComplete(status: string): boolean {
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
     * @returns Active monitors
     */
    getActiveMonitors(): MonitorSession[] {
        return Array.from(this.monitors.values()).filter(m => m.isActive);
    }

    /**
     * Get monitor by ID
     * @param monitorId - Monitor ID
     * @returns Monitor data
     */
    getMonitor(monitorId: string): MonitorSession | null {
        return this.monitors.get(monitorId) || null;
    }

    /**
     * Get monitoring statistics
     * @returns Statistics
     */
    getStats(): MonitorStats & { avgUpdatesPerMonitor: number } {
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
    stopAllMonitors(): number {
        const activeMonitors = this.getActiveMonitors();
        activeMonitors.forEach(monitor => {
            this.stopMonitoring(monitor.id);
        });

        return activeMonitors.length;
    }

    /**
     * Cleanup and destroy monitor
     */
    destroy(): void {
        this.stopAllMonitors();
        this.removeAllListeners();
        this.monitors.clear();
    }
}

// Global instance
let globalMonitor: DeploymentMonitor | null = null;

/**
 * Get global deployment monitor instance
 * @returns Global monitor
 */
function getGlobalMonitor(): DeploymentMonitor {
    if (!globalMonitor) {
        globalMonitor = new DeploymentMonitor();

        // Set up global event handlers for user feedback
        globalMonitor.on('progressUpdate', (data: any) => {
            const icon = data.status === 'InProgress' ? '🔄' :
                        data.status === 'Succeeded' ? '✅' :
                        data.status === 'Failed' ? '❌' : '📊';

            console.error(`${icon} Deployment ${data.deploymentId}: ${data.status} (${data.percentage}%)`);
        });

        globalMonitor.on('deploymentCompleted', (data: any) => {
            const icon = data.finalStatus === 'Succeeded' ? '✅' :
                        data.finalStatus === 'Failed' ? '❌' : '🏁';

            console.error(`${icon} Deployment ${data.deploymentId} completed: ${data.finalStatus}`);
        });
    }

    return globalMonitor;
}

export { DeploymentMonitor, getGlobalMonitor };
